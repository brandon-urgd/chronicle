//! Project routes: full CRUD plus progress log and accomplishment toggle.
//!
//! Implements ~10 routes matching the Python FastAPI backend exactly.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::entry::{AttachmentResponse, EntryResponse, LinkResponse, TagResponse};
use crate::models::project::{
    CreateProject, LessonResponse, ProjectProgressLogCreate, ProjectProgressLogResponse,
    ProjectResponse, StakeholderResponse, UpdateProject,
};

/// Query parameters for the list projects endpoint.
#[derive(Debug, Deserialize)]
pub struct ProjectFilters {
    pub program_id: Option<i64>,
    pub status: Option<String>,
    pub goal_id: Option<i64>,
    pub search: Option<String>,
}

/// Build the projects sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/projects", post(create_project))
        .route("/api/projects", get(list_projects))
        .route("/api/projects/:id", get(get_project))
        .route("/api/projects/:id", put(update_project))
        .route("/api/projects/:id", delete(delete_project))
        .route("/api/projects/:id/progress", post(create_progress_log))
        .route(
            "/api/projects/progress/:log_id",
            delete(delete_progress_log),
        )
        .route(
            "/api/projects/:id/accomplishment",
            patch(toggle_accomplishment),
        )
        .with_state(state)
}

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/projects â€” create a new project.
async fn create_project(
    State(state): State<SharedState>,
    Json(body): Json<CreateProject>,
) -> Result<(StatusCode, Json<ProjectResponse>), AppError> {
    let conn = state.pool.get()?;

    // v3.0: Inherit program_id from goal if not explicitly set
    let effective_program_id = if body.program_id.is_some() {
        body.program_id
    } else if let Some(goal_id) = body.goal_id {
        conn.query_row(
            "SELECT program_id FROM goals WHERE id = ?1",
            rusqlite::params![goal_id],
            |row| row.get::<_, Option<i64>>(0),
        ).unwrap_or(None)
    } else {
        None
    };

    let project_id = conn.query_row(
        "INSERT INTO projects (name, description, metrics, start_date, target_end_date,
         status, goal_id, is_accomplishment, program_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         RETURNING id",
        rusqlite::params![
            body.name,
            body.description,
            body.metrics,
            body.start_date,
            body.target_end_date,
            body.status,
            body.goal_id,
            body.is_accomplishment,
            effective_program_id,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_project_response_basic(&conn, project_id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/projects â€” list all projects with optional filters.
async fn list_projects(
    State(state): State<SharedState>,
    Query(filters): Query<ProjectFilters>,
) -> Result<Json<Vec<ProjectResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT p.id, p.created_at, p.updated_at, p.name, p.description, \
                   p.metrics, p.start_date, p.target_end_date, p.actual_end_date, \
                   p.status, p.goal_id, g.title, p.is_accomplishment, p.program_id, \
                   prog.name as program_name \
                   FROM projects p \
                   LEFT JOIN goals g ON p.goal_id = g.id \
                   LEFT JOIN programs prog ON p.program_id = prog.id \
                   WHERE 1=1"
        .to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref program_id) = filters.program_id {
        sql.push_str(" AND p.program_id = ?");
        params.push(Box::new(*program_id));
    }

    if let Some(ref status) = filters.status {
        sql.push_str(" AND p.status = ?");
        params.push(Box::new(status.clone()));
    }

    if let Some(ref goal_id) = filters.goal_id {
        sql.push_str(" AND p.goal_id = ?");
        params.push(Box::new(*goal_id));
    }

    if let Some(ref search) = filters.search {
        if !search.is_empty() {
            sql.push_str(" AND (LOWER(p.name) LIKE ? OR LOWER(COALESCE(p.description,'')) LIKE ?)");
            let pattern = format!("%{}%", search.to_lowercase());
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY p.created_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| Ok(project_row_to_response(row)))?;

    let mut projects: Vec<ProjectResponse> = Vec::new();
    for row_result in rows {
        projects.push(row_result?);
    }

    Ok(Json(projects))
}

/// GET /api/projects/:id â€” get a single project with entries, progress_log, stakeholders, lessons, links, attachments.
async fn get_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<ProjectResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut project = conn
        .query_row(
            "SELECT p.id, p.created_at, p.updated_at, p.name, p.description, \
             p.metrics, p.start_date, p.target_end_date, p.actual_end_date, \
             p.status, p.goal_id, g.title, p.is_accomplishment, p.program_id, \
             prog.name as program_name \
             FROM projects p \
             LEFT JOIN goals g ON p.goal_id = g.id \
             LEFT JOIN programs prog ON p.program_id = prog.id \
             WHERE p.id = ?1",
            rusqlite::params![id],
            |row| Ok(project_row_to_response(row)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Project not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // Linked entries (where project_id matches) with their tags
    project.entries = fetch_project_entries(&conn, id, &project.name)?;

    // Links where parent_type='project'
    project.links = fetch_links(&conn, "project", id)?;

    // Attachments where parent_type='project'
    project.attachments = fetch_attachments(&conn, "project", id)?;

    // Stakeholders linked via project_stakeholders junction
    project.stakeholders = fetch_project_stakeholders(&conn, id)?;

    // Progress log â€” chronological (oldest first)
    project.progress_log = fetch_project_progress_log(&conn, id)?;

    // Lessons learned linked to this project
    project.lessons = fetch_project_lessons(&conn, id)?;

    Ok(Json(project))
}

/// PUT /api/projects/:id â€” update project fields (dynamic partial update).
async fn update_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateProject>,
) -> Result<Json<ProjectResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify project exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Project not found".to_string()));
    }

    // Build dynamic UPDATE
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    macro_rules! add_field {
        ($field:expr, $name:literal) => {
            if let Some(ref val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                values.push(Box::new(val.clone()));
            }
        };
    }

    macro_rules! add_nullable_field {
        ($field:expr, $name:literal) => {
            if let Some(ref val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                if val.is_empty() {
                    values.push(Box::new(rusqlite::types::Null));
                } else {
                    values.push(Box::new(val.clone()));
                }
            }
        };
    }

    macro_rules! add_field_i64 {
        ($field:expr, $name:literal) => {
            if let Some(val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                values.push(Box::new(val));
            }
        };
    }

    macro_rules! add_fk_field {
        ($field:expr, $name:literal) => {
            if let Some(val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                if val == 0 {
                    values.push(Box::new(rusqlite::types::Null));
                } else {
                    values.push(Box::new(val));
                }
            }
        };
    }

    add_field!(body.name, "name");
    add_nullable_field!(body.description, "description");
    add_nullable_field!(body.metrics, "metrics");
    add_field!(body.start_date, "start_date");
    add_field!(body.target_end_date, "target_end_date");
    add_field!(body.actual_end_date, "actual_end_date");
    add_field!(body.status, "status");
    add_fk_field!(body.goal_id, "goal_id");
    add_field_i64!(body.is_accomplishment, "is_accomplishment");
    add_fk_field!(body.program_id, "program_id");

    // Auto-set actual_end_date when completing a project (if not explicitly provided)
    if body.status.as_deref() == Some("completed") && body.actual_end_date.is_none() {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        set_clauses.push("actual_end_date = ?".to_string());
        values.push(Box::new(today));
    }

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE projects SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_project_response_basic(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/projects/:id â€” delete a project (SET NULL on entries.project_id via FK).
async fn delete_project(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify project exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Project not found".to_string()));
    }

    // project_progress_log has ON DELETE CASCADE â€” handled by FK
    // project_stakeholders has ON DELETE CASCADE â€” handled by FK
    // entries have ON DELETE SET NULL on project_id â€” handled by FK
    // links and attachments need manual cleanup (no FK on parent_id)
    conn.execute(
        "DELETE FROM links WHERE parent_type = 'project' AND parent_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM attachments WHERE parent_type = 'project' AND parent_id = ?1",
        rusqlite::params![id],
    )?;

    conn.execute("DELETE FROM projects WHERE id = ?1", rusqlite::params![id])?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/projects/:id/progress â€” add a progress log entry.
async fn create_progress_log(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<ProjectProgressLogCreate>,
) -> Result<(StatusCode, Json<ProjectProgressLogResponse>), AppError> {
    let conn = state.pool.get()?;

    // Get project's current status for status_at_time
    let status_at_time: String = conn
        .query_row(
            "SELECT status FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Project not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let log_id = conn.query_row(
        "INSERT INTO project_progress_log (project_id, note, status_at_time)
         VALUES (?1, ?2, ?3)
         RETURNING id",
        rusqlite::params![id, body.note, status_at_time],
        |row| row.get::<_, i64>(0),
    )?;

    let log = conn.query_row(
        "SELECT id, project_id, created_at, note, status_at_time
         FROM project_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
        |row| {
            Ok(ProjectProgressLogResponse {
                id: row.get(0)?,
                project_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(log)))
}

/// DELETE /api/projects/progress/:log_id â€” delete a progress log entry.
async fn delete_progress_log(
    State(state): State<SharedState>,
    Path(log_id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify log entry exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM project_progress_log WHERE id = ?1",
            rusqlite::params![log_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound(
            "Progress log entry not found".to_string(),
        ));
    }

    conn.execute(
        "DELETE FROM project_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/projects/:id/accomplishment â€” toggle is_accomplishment (0â†”1).
async fn toggle_accomplishment(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<ProjectResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify project exists and get current value
    let current: i64 = conn
        .query_row(
            "SELECT is_accomplishment FROM projects WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Project not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let new_value = if current == 0 { 1 } else { 0 };

    conn.execute(
        "UPDATE projects SET is_accomplishment = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_value, id],
    )?;

    let response = fetch_project_response_basic(&conn, id)?;
    Ok(Json(response))
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Convert a row from the projects SELECT (with LEFT JOIN goals, programs) into a ProjectResponse.
fn project_row_to_response(row: &rusqlite::Row) -> ProjectResponse {
    ProjectResponse {
        id: row.get(0).unwrap_or(0),
        created_at: row.get(1).unwrap_or_default(),
        updated_at: row.get(2).unwrap_or_default(),
        name: row.get(3).unwrap_or_default(),
        description: row.get(4).unwrap_or(None),
        metrics: row.get(5).unwrap_or(None),
        start_date: row.get(6).unwrap_or(None),
        target_end_date: row.get(7).unwrap_or(None),
        actual_end_date: row.get(8).unwrap_or(None),
        status: row.get(9).unwrap_or_default(),
        goal_id: row.get(10).unwrap_or(None),
        goal_title: row.get(11).unwrap_or(None),
        is_accomplishment: row.get(12).unwrap_or(0),
        program_id: row.get(13).unwrap_or(None),
        program_name: row.get(14).unwrap_or(None),
        entries: vec![],
        links: vec![],
        attachments: vec![],
        stakeholders: vec![],
        progress_log: vec![],
        lessons: vec![],
    }
}

/// Fetch a basic project response by ID (with goal_title and program_name via LEFT JOINs).
fn fetch_project_response_basic(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<ProjectResponse, AppError> {
    conn.query_row(
        "SELECT p.id, p.created_at, p.updated_at, p.name, p.description, \
         p.metrics, p.start_date, p.target_end_date, p.actual_end_date, \
         p.status, p.goal_id, g.title, p.is_accomplishment, p.program_id, \
         prog.name as program_name \
         FROM projects p \
         LEFT JOIN goals g ON p.goal_id = g.id \
         LEFT JOIN programs prog ON p.program_id = prog.id \
         WHERE p.id = ?1",
        rusqlite::params![project_id],
        |row| Ok(project_row_to_response(row)),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Project not found".to_string())
        }
        other => AppError::Database(other),
    })
}

/// Fetch entries linked to a project (with tags batch-loaded).
fn fetch_project_entries(
    conn: &rusqlite::Connection,
    project_id: i64,
    project_name: &str,
) -> Result<Vec<EntryResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.created_at, e.updated_at, e.entry_date, e.entry_type, \
         e.work_type, e.title, e.description, e.impact, e.metrics, \
         e.project_id, e.status, e.visibility, \
         e.is_accomplishment, e.is_lesson_learned, e.is_weekly_highlight, \
         e.is_pinned, e.outcome, e.program_id, e.scheduled_item_id \
         FROM entries e WHERE e.project_id = ?1 \
         ORDER BY e.entry_date DESC",
    )?;

    let entry_rows: Vec<EntryRow> = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(EntryRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                entry_date: row.get(3)?,
                entry_type: row.get(4)?,
                work_type: row.get(5)?,
                title: row.get(6)?,
                description: row.get(7)?,
                impact: row.get(8)?,
                metrics: row.get(9)?,
                project_id: row.get(10)?,
                status: row.get(11)?,
                visibility: row.get(12)?,
                is_accomplishment: row.get(13)?,
                is_lesson_learned: row.get(14)?,
                is_weekly_highlight: row.get(15)?,
                is_pinned: row.get(16)?,
                outcome: row.get(17)?,
                program_id: row.get(18)?,
                scheduled_item_id: row.get(19)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Batch-fetch tags for all entries
    let entry_ids: Vec<i64> = entry_rows.iter().map(|e| e.id).collect();
    let tags_by_entry = batch_fetch_entry_tags(conn, &entry_ids)?;

    let entries = entry_rows
        .into_iter()
        .map(|er| EntryResponse {
            id: er.id,
            created_at: er.created_at,
            updated_at: er.updated_at,
            entry_date: er.entry_date,
            entry_type: er.entry_type,
            work_type: er.work_type,
            title: er.title,
            description: er.description,
            impact: er.impact,
            metrics: er.metrics,
            project_id: er.project_id,
            project_name: Some(project_name.to_string()),
            program_id: er.program_id,
            program_name: None,
            scheduled_item_id: er.scheduled_item_id,
            status: er.status,
            visibility: er.visibility,
            is_accomplishment: er.is_accomplishment,
            is_lesson_learned: er.is_lesson_learned,
            is_weekly_highlight: er.is_weekly_highlight,
            is_pinned: er.is_pinned,
            outcome: er.outcome,
            tags: tags_by_entry.get(&er.id).cloned().unwrap_or_default(),
            links: vec![],
            attachments: vec![],
        })
        .collect();

    Ok(entries)
}

/// Temporary struct for holding entry row data during batch processing.
struct EntryRow {
    id: i64,
    created_at: String,
    updated_at: String,
    entry_date: String,
    entry_type: String,
    work_type: String,
    title: String,
    description: Option<String>,
    impact: Option<String>,
    metrics: Option<String>,
    project_id: Option<i64>,
    status: String,
    visibility: String,
    is_accomplishment: i64,
    is_lesson_learned: i64,
    is_weekly_highlight: i64,
    is_pinned: i64,
    outcome: Option<String>,
    program_id: Option<i64>,
    scheduled_item_id: Option<i64>,
}

/// Batch-fetch tags for a set of entry IDs.
fn batch_fetch_entry_tags(
    conn: &rusqlite::Connection,
    entry_ids: &[i64],
) -> Result<std::collections::HashMap<i64, Vec<TagResponse>>, AppError> {
    let mut tags_map: std::collections::HashMap<i64, Vec<TagResponse>> =
        std::collections::HashMap::new();

    if entry_ids.is_empty() {
        return Ok(tags_map);
    }

    let placeholders: String = entry_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT et.entry_id, t.id, t.name, t.created_at \
         FROM tags t \
         JOIN entry_tags et ON t.id = et.tag_id \
         WHERE et.entry_id IN ({}) \
         ORDER BY t.name",
        placeholders
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::types::ToSql> =
        entry_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();

    let rows = stmt.query_map(params.as_slice(), |row| {
        Ok((
            row.get::<_, i64>(0)?,
            TagResponse {
                id: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
            },
        ))
    })?;

    for row_result in rows {
        if let Ok((entry_id, tag)) = row_result {
            tags_map.entry(entry_id).or_default().push(tag);
        }
    }

    Ok(tags_map)
}

/// Fetch stakeholders linked to a project via project_stakeholders junction.
fn fetch_project_stakeholders(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<Vec<StakeholderResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.email, s.role, s.notes, s.created_at \
         FROM stakeholders s \
         JOIN project_stakeholders ps ON s.id = ps.stakeholder_id \
         WHERE ps.project_id = ?1 \
         ORDER BY s.name",
    )?;

    let stakeholders = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(StakeholderResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                role: row.get(3)?,
                notes: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(stakeholders)
}

/// Fetch progress log entries for a project (oldest first).
fn fetch_project_progress_log(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<Vec<ProjectProgressLogResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, created_at, note, status_at_time \
         FROM project_progress_log WHERE project_id = ?1 \
         ORDER BY created_at ASC",
    )?;

    let logs = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(ProjectProgressLogResponse {
                id: row.get(0)?,
                project_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(logs)
}

/// Fetch lessons learned linked to a project.
fn fetch_project_lessons(
    conn: &rusqlite::Connection,
    project_id: i64,
) -> Result<Vec<LessonResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT l.id, l.created_at, l.updated_at, l.title, l.context, l.lesson, \
         l.application, l.source_entry_id, l.source_project_id, \
         l.date_range_start, l.date_range_end, l.date_range_label \
         FROM lessons_learned l \
         WHERE l.source_project_id = ?1 \
         ORDER BY l.created_at DESC",
    )?;

    let lesson_rows: Vec<LessonRow> = stmt
        .query_map(rusqlite::params![project_id], |row| {
            Ok(LessonRow {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                title: row.get(3)?,
                context: row.get(4)?,
                lesson: row.get(5)?,
                application: row.get(6)?,
                source_entry_id: row.get(7)?,
                source_project_id: row.get(8)?,
                date_range_start: row.get(9)?,
                date_range_end: row.get(10)?,
                date_range_label: row.get(11)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut lessons = Vec::new();
    for lr in lesson_rows {
        // Fetch source_entry_title if source_entry_id is set
        let source_entry_title = if let Some(entry_id) = lr.source_entry_id {
            conn.query_row(
                "SELECT title FROM entries WHERE id = ?1",
                rusqlite::params![entry_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        } else {
            None
        };

        // Fetch source_project_name if source_project_id is set
        let source_project_name = if let Some(proj_id) = lr.source_project_id {
            conn.query_row(
                "SELECT name FROM projects WHERE id = ?1",
                rusqlite::params![proj_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        } else {
            None
        };

        // Fetch tags for this lesson
        let tags = fetch_lesson_tags(conn, lr.id)?;

        // Fetch links for this lesson
        let links = fetch_links(conn, "lesson", lr.id)?;

        // Fetch attachments for this lesson
        let attachments = fetch_attachments(conn, "lesson", lr.id)?;

        lessons.push(LessonResponse {
            id: lr.id,
            created_at: lr.created_at,
            updated_at: lr.updated_at,
            title: lr.title,
            context: lr.context,
            lesson: lr.lesson,
            application: lr.application,
            source_entry_id: lr.source_entry_id,
            source_project_id: lr.source_project_id,
            source_entry_title,
            source_project_name,
            date_range_start: lr.date_range_start,
            date_range_end: lr.date_range_end,
            date_range_label: lr.date_range_label,
            tags,
            links,
            attachments,
        });
    }

    Ok(lessons)
}

/// Temporary struct for holding lesson row data.
struct LessonRow {
    id: i64,
    created_at: String,
    updated_at: String,
    title: String,
    context: Option<String>,
    lesson: Option<String>,
    application: Option<String>,
    source_entry_id: Option<i64>,
    source_project_id: Option<i64>,
    date_range_start: Option<String>,
    date_range_end: Option<String>,
    date_range_label: Option<String>,
}

/// Fetch tags for a lesson.
fn fetch_lesson_tags(
    conn: &rusqlite::Connection,
    lesson_id: i64,
) -> Result<Vec<TagResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.created_at \
         FROM tags t \
         JOIN lesson_tags lt ON t.id = lt.tag_id \
         WHERE lt.lesson_id = ?1 \
         ORDER BY t.name",
    )?;

    let tags = stmt
        .query_map(rusqlite::params![lesson_id], |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}

/// Fetch links for a given parent type and ID.
fn fetch_links(
    conn: &rusqlite::Connection,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<LinkResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, url, label, created_at \
         FROM links WHERE parent_type = ?1 AND parent_id = ?2 \
         ORDER BY created_at ASC",
    )?;

    let links = stmt
        .query_map(rusqlite::params![parent_type, parent_id], |row| {
            Ok(LinkResponse {
                id: row.get(0)?,
                parent_type: row.get(1)?,
                parent_id: row.get(2)?,
                url: row.get(3)?,
                label: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(links)
}

/// Fetch attachments for a given parent type and ID.
fn fetch_attachments(
    conn: &rusqlite::Connection,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<AttachmentResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at \
         FROM attachments WHERE parent_type = ?1 AND parent_id = ?2 \
         ORDER BY created_at ASC",
    )?;

    let attachments = stmt
        .query_map(rusqlite::params![parent_type, parent_id], |row| {
            Ok(AttachmentResponse {
                id: row.get(0)?,
                parent_type: row.get(1)?,
                parent_id: row.get(2)?,
                filename: row.get(3)?,
                original_name: row.get(4)?,
                file_size: row.get(5)?,
                mime_type: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(attachments)
}
