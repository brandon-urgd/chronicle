//! Program routes: full CRUD plus progress log operations.
//!
//! Implements ~8 routes matching the Python FastAPI backend exactly.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::entry::{AttachmentResponse, LinkResponse};
use crate::models::goal::GoalResponse;
use crate::models::program::{
    CreateProgram, ProgramMetrics, ProgramProgressLogResponse, ProgramResponse, ProgressLogCreate,
    UpdateProgram,
};

/// Query parameters for the list programs endpoint.
#[derive(Debug, Deserialize)]
pub struct ProgramFilters {
    pub status: Option<String>,
    pub search: Option<String>,
}

/// Build the programs sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/programs", post(create_program))
        .route("/api/programs", get(list_programs))
        .route("/api/programs/:id", get(get_program))
        .route("/api/programs/:id", put(update_program))
        .route("/api/programs/:id", delete(delete_program))
        .route("/api/programs/:id/progress", post(create_progress_log))
        .route(
            "/api/programs/progress/:log_id",
            delete(delete_progress_log),
        )
        .with_state(state)
}

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/programs â€” create a new program.
async fn create_program(
    State(state): State<SharedState>,
    Json(body): Json<CreateProgram>,
) -> Result<(StatusCode, Json<ProgramResponse>), AppError> {
    let conn = state.pool.get()?;

    let program_id = conn.query_row(
        "INSERT INTO programs (name, description, program_type, status, owner, color, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         RETURNING id",
        rusqlite::params![
            body.name,
            body.description,
            body.program_type,
            body.status,
            body.owner,
            body.color,
            body.sort_order,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_program_response_basic(&conn, program_id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/programs â€” list all programs with optional status filter and basic metrics.
async fn list_programs(
    State(state): State<SharedState>,
    Query(filters): Query<ProgramFilters>,
) -> Result<Json<Vec<ProgramResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT id, created_at, updated_at, name, description, program_type, status, owner, color, sort_order FROM programs WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = filters.status {
        sql.push_str(" AND status = ?");
        params.push(Box::new(status.clone()));
    }

    if let Some(ref search) = filters.search {
        if !search.is_empty() {
            sql.push_str(" AND (LOWER(name) LIKE ? OR LOWER(COALESCE(description,'')) LIKE ?)");
            let pattern = format!("%{}%", search.to_lowercase());
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY sort_order ASC, created_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(program_row_to_response_basic(row))
    })?;

    let mut programs: Vec<ProgramResponse> = Vec::new();
    for row_result in rows {
        programs.push(row_result?);
    }

    if programs.is_empty() {
        return Ok(Json(programs));
    }

    // Batch-compute metrics for all programs
    // Goal metrics
    let mut goal_stmt = conn.prepare(
        "SELECT program_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('on_track','at_risk','behind') THEN 1 ELSE 0 END) AS active
         FROM goals WHERE program_id IS NOT NULL
         GROUP BY program_id",
    )?;
    let goal_metrics: std::collections::HashMap<i64, (i64, i64)> = goal_stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?
        .filter_map(|r| r.ok())
        .map(|(pid, total, active)| (pid, (total, active)))
        .collect();

    // Entry counts
    let mut entry_stmt = conn.prepare(
        "SELECT program_id, COUNT(*) FROM entries
         WHERE program_id IS NOT NULL
         GROUP BY program_id",
    )?;
    let entry_counts: std::collections::HashMap<i64, i64> = entry_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    // Project metrics (direct program_id)
    let mut project_stmt = conn.prepare(
        "SELECT program_id,
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('planning', 'active') THEN 1 ELSE 0 END) AS active
         FROM projects WHERE program_id IS NOT NULL
         GROUP BY program_id",
    )?;
    let project_metrics: std::collections::HashMap<i64, (i64, i64)> = project_stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?
        .filter_map(|r| r.ok())
        .map(|(pid, total, active)| (pid, (total, active)))
        .collect();

    // Projects linked via goals (goal.program_id â†’ project.goal_id)
    let mut pvg_stmt = conn.prepare(
        "SELECT g.program_id,
                COUNT(*) AS total,
                SUM(CASE WHEN p.status IN ('planning', 'active') THEN 1 ELSE 0 END) AS active
         FROM projects p
         JOIN goals g ON p.goal_id = g.id
         WHERE g.program_id IS NOT NULL AND p.program_id IS NULL
         GROUP BY g.program_id",
    )?;
    let project_via_goal: std::collections::HashMap<i64, (i64, i64)> = pvg_stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
        })?
        .filter_map(|r| r.ok())
        .map(|(pid, total, active)| (pid, (total, active)))
        .collect();

    // Scheduled items count
    let mut sched_stmt = conn.prepare(
        "SELECT program_id, COUNT(*) FROM scheduled_items
         WHERE program_id IS NOT NULL
         GROUP BY program_id",
    )?;
    let scheduled_counts: std::collections::HashMap<i64, i64> = sched_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    // Apply metrics to each program
    for prog in &mut programs {
        let pid = prog.id;
        let (total_goals, active_goals) = goal_metrics.get(&pid).copied().unwrap_or((0, 0));
        let (proj_total, proj_active) = project_metrics.get(&pid).copied().unwrap_or((0, 0));
        let (pvg_total, pvg_active) = project_via_goal.get(&pid).copied().unwrap_or((0, 0));

        prog.metrics = ProgramMetrics {
            total_goals,
            active_goals,
            total_entries: *entry_counts.get(&pid).unwrap_or(&0),
            total_projects: proj_total + pvg_total,
            active_projects: proj_active + pvg_active,
            scheduled_items_count: *scheduled_counts.get(&pid).unwrap_or(&0),
            ..Default::default()
        };
    }

    Ok(Json(programs))
}

/// GET /api/programs/:id â€” get a single program with goals, metrics, progress log, links, attachments.
async fn get_program(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<ProgramResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut program = conn
        .query_row(
            "SELECT id, created_at, updated_at, name, description, program_type, status, owner, color, sort_order
             FROM programs WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok(program_row_to_response_basic(row)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Program not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // --- Computed metrics ---
    // Entry count (direct program_id OR via projectâ†’goalâ†’program chain)
    let total_entries: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE
         program_id = ?1
         OR project_id IN (
           SELECT id FROM projects WHERE program_id = ?1
           OR goal_id IN (SELECT id FROM goals WHERE program_id = ?1)
         )",
        rusqlite::params![id],
        |row| row.get(0),
    )?;

    // Goal counts
    let mut goal_stmt = conn.prepare(
        "SELECT status FROM goals WHERE program_id = ?1",
    )?;
    let goal_statuses: Vec<String> = goal_stmt
        .query_map(rusqlite::params![id], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let total_goals = goal_statuses.len() as i64;
    let active_goals = goal_statuses
        .iter()
        .filter(|s| matches!(s.as_str(), "on_track" | "at_risk" | "behind"))
        .count() as i64;
    let goals_on_track = goal_statuses
        .iter()
        .filter(|s| s.as_str() == "on_track")
        .count() as i64;
    let goals_at_risk = goal_statuses
        .iter()
        .filter(|s| s.as_str() == "at_risk")
        .count() as i64;

    // Project counts (direct program_id OR via goals linked to this program)
    let mut proj_stmt = conn.prepare(
        "SELECT p.status FROM projects p
         WHERE p.program_id = ?1
         OR (p.goal_id IN (SELECT id FROM goals WHERE program_id = ?1))",
    )?;
    let project_statuses: Vec<String> = proj_stmt
        .query_map(rusqlite::params![id], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let total_projects = project_statuses.len() as i64;
    let active_projects = project_statuses
        .iter()
        .filter(|s| matches!(s.as_str(), "planning" | "active"))
        .count() as i64;

    // Scheduled items count
    let scheduled_items_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scheduled_items WHERE program_id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    )?;

    // Scheduled completion rate
    let scheduled_completion_rate = compute_scheduled_completion_rate(&conn, id)?;

    program.metrics = ProgramMetrics {
        total_entries,
        active_goals,
        total_goals,
        active_projects,
        total_projects,
        goals_on_track,
        goals_at_risk,
        scheduled_items_count,
        scheduled_completion_rate,
    };

    // Goals associated with this program
    program.goals = fetch_program_goals(&conn, id)?;

    // Progress log â€” chronological (oldest first)
    program.progress_log = fetch_program_progress_log(&conn, id)?;

    // Links where parent_type='program'
    program.links = fetch_links(&conn, "program", id)?;

    // Attachments where parent_type='program'
    program.attachments = fetch_attachments(&conn, "program", id)?;

    Ok(Json(program))
}

/// PUT /api/programs/:id â€” update program fields.
async fn update_program(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateProgram>,
) -> Result<Json<ProgramResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify program exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM programs WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Program not found".to_string()));
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

    add_field!(body.name, "name");
    add_nullable_field!(body.description, "description");
    add_field!(body.program_type, "program_type");
    add_field!(body.status, "status");
    add_nullable_field!(body.owner, "owner");
    add_field!(body.color, "color");
    add_field_i64!(body.sort_order, "sort_order");

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE programs SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_program_response_basic(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/programs/:id â€” delete a program (SET NULL on referencing entities).
async fn delete_program(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify program exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM programs WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Program not found".to_string()));
    }

    // program_progress_log has ON DELETE CASCADE â€” handled by FK
    // goals have ON DELETE SET NULL on program_id â€” handled by FK
    // entries have ON DELETE SET NULL on program_id â€” handled by FK
    // projects have ON DELETE SET NULL on program_id â€” handled by FK
    // scheduled_items have ON DELETE SET NULL on program_id â€” handled by FK
    // links and attachments need manual cleanup (no FK on parent_id)
    conn.execute(
        "DELETE FROM links WHERE parent_type = 'program' AND parent_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM attachments WHERE parent_type = 'program' AND parent_id = ?1",
        rusqlite::params![id],
    )?;

    conn.execute("DELETE FROM programs WHERE id = ?1", rusqlite::params![id])?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/programs/:id/progress â€” add a progress log entry.
async fn create_progress_log(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<ProgressLogCreate>,
) -> Result<(StatusCode, Json<ProgramProgressLogResponse>), AppError> {
    let conn = state.pool.get()?;

    // Get program's current status for status_at_time
    let status_at_time: String = conn
        .query_row(
            "SELECT status FROM programs WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Program not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let log_id = conn.query_row(
        "INSERT INTO program_progress_log (program_id, note, status_at_time)
         VALUES (?1, ?2, ?3)
         RETURNING id",
        rusqlite::params![id, body.note, status_at_time],
        |row| row.get::<_, i64>(0),
    )?;

    let log = conn.query_row(
        "SELECT id, program_id, created_at, note, status_at_time
         FROM program_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
        |row| {
            Ok(ProgramProgressLogResponse {
                id: row.get(0)?,
                program_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(log)))
}

/// DELETE /api/programs/progress/:log_id â€” delete a progress log entry.
async fn delete_progress_log(
    State(state): State<SharedState>,
    Path(log_id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify log entry exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM program_progress_log WHERE id = ?1",
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
        "DELETE FROM program_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Convert a row from the programs SELECT into a ProgramResponse (without nested data).
fn program_row_to_response_basic(row: &rusqlite::Row) -> ProgramResponse {
    ProgramResponse {
        id: row.get(0).unwrap_or(0),
        created_at: row.get(1).unwrap_or_default(),
        updated_at: row.get(2).unwrap_or_default(),
        name: row.get(3).unwrap_or_default(),
        description: row.get(4).unwrap_or(None),
        program_type: row.get(5).unwrap_or_default(),
        status: row.get(6).unwrap_or_default(),
        owner: row.get(7).unwrap_or(None),
        color: row.get(8).unwrap_or(None),
        sort_order: row.get(9).unwrap_or(0),
        metrics: ProgramMetrics::default(),
        goals: vec![],
        progress_log: vec![],
        links: vec![],
        attachments: vec![],
    }
}

/// Fetch a basic program response by ID (no nested goals/progress/links).
fn fetch_program_response_basic(
    conn: &rusqlite::Connection,
    program_id: i64,
) -> Result<ProgramResponse, AppError> {
    conn.query_row(
        "SELECT id, created_at, updated_at, name, description, program_type, status, owner, color, sort_order
         FROM programs WHERE id = ?1",
        rusqlite::params![program_id],
        |row| Ok(program_row_to_response_basic(row)),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Program not found".to_string())
        }
        other => AppError::Database(other),
    })
}

/// Fetch goals associated with a program.
fn fetch_program_goals(
    conn: &rusqlite::Connection,
    program_id: i64,
) -> Result<Vec<GoalResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, created_at, updated_at, title, description, specific, measurable,
                achievable, relevant, time_bound, fiscal_year, quarter, status,
                target_date, is_accomplishment, program_id
         FROM goals WHERE program_id = ?1
         ORDER BY created_at DESC",
    )?;

    let goals = stmt
        .query_map(rusqlite::params![program_id], |row| {
            Ok(GoalResponse {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                title: row.get(3)?,
                description: row.get(4)?,
                specific: row.get(5)?,
                measurable: row.get(6)?,
                achievable: row.get(7)?,
                relevant: row.get(8)?,
                time_bound: row.get(9)?,
                fiscal_year: row.get(10)?,
                quarter: row.get(11)?,
                status: row.get(12)?,
                target_date: row.get(13)?,
                is_accomplishment: row.get(14)?,
                program_id: row.get(15)?,
                program_name: None,
                linked_projects_count: 0,
                progress_log: vec![],
                projects: vec![],
                links: vec![],
                attachments: vec![],
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(goals)
}

/// Fetch progress log entries for a program (oldest first).
fn fetch_program_progress_log(
    conn: &rusqlite::Connection,
    program_id: i64,
) -> Result<Vec<ProgramProgressLogResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, program_id, created_at, note, status_at_time
         FROM program_progress_log WHERE program_id = ?1
         ORDER BY created_at ASC",
    )?;

    let logs = stmt
        .query_map(rusqlite::params![program_id], |row| {
            Ok(ProgramProgressLogResponse {
                id: row.get(0)?,
                program_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(logs)
}

/// Fetch links for a given parent type and ID.
fn fetch_links(
    conn: &rusqlite::Connection,
    parent_type: &str,
    parent_id: i64,
) -> Result<Vec<LinkResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, url, label, created_at
         FROM links WHERE parent_type = ?1 AND parent_id = ?2
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
        "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at
         FROM attachments WHERE parent_type = ?1 AND parent_id = ?2
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

/// Compute the scheduled completion rate for a program.
///
/// Rate = (completed + auto_completed) / (completed + auto_completed + skipped) * 100
/// Returns 0.0 when denominator is zero.
fn compute_scheduled_completion_rate(
    conn: &rusqlite::Connection,
    program_id: i64,
) -> Result<f64, AppError> {
    let row = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN si2.status IN ('completed', 'auto_completed') THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN si2.status = 'skipped' THEN 1 ELSE 0 END), 0) AS skipped
         FROM scheduled_item_instances si2
         JOIN scheduled_items si ON si2.scheduled_item_id = si.id
         WHERE si.program_id = ?1",
        rusqlite::params![program_id],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;

    let (done, skipped) = row;
    let denominator = done + skipped;
    if denominator == 0 {
        Ok(0.0)
    } else {
        Ok((done as f64 / denominator as f64) * 100.0)
    }
}
