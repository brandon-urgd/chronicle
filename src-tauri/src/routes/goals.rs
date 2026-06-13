//! Goal routes: full CRUD plus progress log and accomplishment toggle.
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
use crate::models::goal::{
    CreateGoal, GoalProgressLogCreate, GoalProgressLogResponse, GoalResponse, UpdateGoal,
};
use crate::models::project::ProjectResponse;

/// Query parameters for the list goals endpoint.
#[derive(Debug, Deserialize)]
pub struct GoalFilters {
    pub program_id: Option<i64>,
    pub status: Option<String>,
    pub fiscal_year: Option<i64>,
    pub quarter: Option<i64>,
    pub search: Option<String>,
}

/// Build the goals sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/goals", post(create_goal))
        .route("/api/goals", get(list_goals))
        .route("/api/goals/:id", get(get_goal))
        .route("/api/goals/:id", put(update_goal))
        .route("/api/goals/:id", delete(delete_goal))
        .route("/api/goals/:id/progress", post(create_progress_log))
        .route("/api/goals/progress/:log_id", delete(delete_progress_log))
        .route("/api/goals/:id/accomplishment", patch(toggle_accomplishment))
        .with_state(state)
}

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/goals â€” create a new goal.
async fn create_goal(
    State(state): State<SharedState>,
    Json(body): Json<CreateGoal>,
) -> Result<(StatusCode, Json<GoalResponse>), AppError> {
    let conn = state.pool.get()?;

    let goal_id = conn.query_row(
        "INSERT INTO goals (title, description, specific, measurable, achievable,
         relevant, time_bound, fiscal_year, quarter, status, target_date,
         is_accomplishment, program_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         RETURNING id",
        rusqlite::params![
            body.title,
            body.description,
            body.specific,
            body.measurable,
            body.achievable,
            body.relevant,
            body.time_bound,
            body.fiscal_year,
            body.quarter,
            body.status,
            body.target_date,
            body.is_accomplishment,
            body.program_id,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_goal_response_basic(&conn, goal_id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/goals â€” list all goals with optional filters.
async fn list_goals(
    State(state): State<SharedState>,
    Query(filters): Query<GoalFilters>,
) -> Result<Json<Vec<GoalResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT g.id, g.created_at, g.updated_at, g.title, g.description, \
                   g.specific, g.measurable, g.achievable, g.relevant, g.time_bound, \
                   g.fiscal_year, g.quarter, g.status, g.target_date, g.is_accomplishment, \
                   g.program_id, p.name as program_name \
                   FROM goals g LEFT JOIN programs p ON g.program_id = p.id WHERE 1=1"
        .to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref program_id) = filters.program_id {
        sql.push_str(" AND g.program_id = ?");
        params.push(Box::new(*program_id));
    }

    if let Some(ref status) = filters.status {
        sql.push_str(" AND g.status = ?");
        params.push(Box::new(status.clone()));
    }

    if let Some(ref fiscal_year) = filters.fiscal_year {
        sql.push_str(" AND g.fiscal_year = ?");
        params.push(Box::new(*fiscal_year));
    }

    if let Some(ref quarter) = filters.quarter {
        sql.push_str(" AND g.quarter = ?");
        params.push(Box::new(*quarter));
    }

    if let Some(ref search) = filters.search {
        if !search.is_empty() {
            sql.push_str(" AND (LOWER(g.title) LIKE ? OR LOWER(COALESCE(g.description,'')) LIKE ?)");
            let pattern = format!("%{}%", search.to_lowercase());
            params.push(Box::new(pattern.clone()));
            params.push(Box::new(pattern));
        }
    }

    sql.push_str(" ORDER BY g.created_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(goal_row_to_response(row))
    })?;

    let mut goals: Vec<GoalResponse> = Vec::new();
    for row_result in rows {
        goals.push(row_result?);
    }

    // Get linked project counts for all goals in one query
    let mut count_stmt = conn.prepare(
        "SELECT goal_id, COUNT(*) FROM projects WHERE goal_id IS NOT NULL GROUP BY goal_id",
    )?;
    let count_map: std::collections::HashMap<i64, i64> = count_stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    for goal in &mut goals {
        goal.linked_projects_count = *count_map.get(&goal.id).unwrap_or(&0);
    }

    Ok(Json(goals))
}

/// GET /api/goals/:id â€” get a single goal with progress_log and projects.
async fn get_goal(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<GoalResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut goal = conn
        .query_row(
            "SELECT g.id, g.created_at, g.updated_at, g.title, g.description, \
             g.specific, g.measurable, g.achievable, g.relevant, g.time_bound, \
             g.fiscal_year, g.quarter, g.status, g.target_date, g.is_accomplishment, \
             g.program_id, p.name as program_name \
             FROM goals g LEFT JOIN programs p ON g.program_id = p.id \
             WHERE g.id = ?1",
            rusqlite::params![id],
            |row| Ok(goal_row_to_response(row)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Goal not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // Progress log â€” chronological (oldest first)
    goal.progress_log = fetch_goal_progress_log(&conn, id)?;

    // Linked projects
    goal.projects = fetch_goal_projects(&conn, id, &goal.title)?;

    // Linked projects count
    goal.linked_projects_count = goal.projects.len() as i64;

    Ok(Json(goal))
}

/// PUT /api/goals/:id â€” update goal fields (dynamic partial update).
async fn update_goal(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateGoal>,
) -> Result<Json<GoalResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify goal exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Goal not found".to_string()));
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

    add_field!(body.title, "title");
    add_nullable_field!(body.description, "description");
    add_nullable_field!(body.specific, "specific");
    add_nullable_field!(body.measurable, "measurable");
    add_nullable_field!(body.achievable, "achievable");
    add_nullable_field!(body.relevant, "relevant");
    add_nullable_field!(body.time_bound, "time_bound");
    add_field_i64!(body.fiscal_year, "fiscal_year");
    add_field_i64!(body.quarter, "quarter");
    add_field!(body.status, "status");
    add_field!(body.target_date, "target_date");
    add_field_i64!(body.is_accomplishment, "is_accomplishment");
    add_fk_field!(body.program_id, "program_id");

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE goals SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_goal_response_basic(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/goals/:id â€” delete a goal (SET NULL on projects.goal_id via FK).
async fn delete_goal(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify goal exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM goals WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Goal not found".to_string()));
    }

    // goal_progress_log has ON DELETE CASCADE â€” handled by FK
    // projects have ON DELETE SET NULL on goal_id â€” handled by FK
    conn.execute("DELETE FROM goals WHERE id = ?1", rusqlite::params![id])?;

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/goals/:id/progress â€” add a progress log entry.
async fn create_progress_log(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<GoalProgressLogCreate>,
) -> Result<(StatusCode, Json<GoalProgressLogResponse>), AppError> {
    let conn = state.pool.get()?;

    // Get goal's current status for status_at_time
    let status_at_time: String = conn
        .query_row(
            "SELECT status FROM goals WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Goal not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let log_id = conn.query_row(
        "INSERT INTO goal_progress_log (goal_id, note, status_at_time)
         VALUES (?1, ?2, ?3)
         RETURNING id",
        rusqlite::params![id, body.note, status_at_time],
        |row| row.get::<_, i64>(0),
    )?;

    let log = conn.query_row(
        "SELECT id, goal_id, created_at, note, status_at_time
         FROM goal_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
        |row| {
            Ok(GoalProgressLogResponse {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(log)))
}

/// DELETE /api/goals/progress/:log_id â€” delete a progress log entry.
async fn delete_progress_log(
    State(state): State<SharedState>,
    Path(log_id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify log entry exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM goal_progress_log WHERE id = ?1",
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
        "DELETE FROM goal_progress_log WHERE id = ?1",
        rusqlite::params![log_id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/goals/:id/accomplishment â€” toggle is_accomplishment (0â†”1).
async fn toggle_accomplishment(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<GoalResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify goal exists and get current value
    let current: i64 = conn
        .query_row(
            "SELECT is_accomplishment FROM goals WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Goal not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let new_value = if current == 0 { 1 } else { 0 };

    conn.execute(
        "UPDATE goals SET is_accomplishment = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_value, id],
    )?;

    let response = fetch_goal_response_basic(&conn, id)?;
    Ok(Json(response))
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Convert a row from the goals SELECT (with LEFT JOIN programs) into a GoalResponse.
fn goal_row_to_response(row: &rusqlite::Row) -> GoalResponse {
    GoalResponse {
        id: row.get(0).unwrap_or(0),
        created_at: row.get(1).unwrap_or_default(),
        updated_at: row.get(2).unwrap_or_default(),
        title: row.get(3).unwrap_or_default(),
        description: row.get(4).unwrap_or(None),
        specific: row.get(5).unwrap_or(None),
        measurable: row.get(6).unwrap_or(None),
        achievable: row.get(7).unwrap_or(None),
        relevant: row.get(8).unwrap_or(None),
        time_bound: row.get(9).unwrap_or(None),
        fiscal_year: row.get(10).unwrap_or(None),
        quarter: row.get(11).unwrap_or(None),
        status: row.get(12).unwrap_or_default(),
        target_date: row.get(13).unwrap_or(None),
        is_accomplishment: row.get(14).unwrap_or(0),
        program_id: row.get(15).unwrap_or(None),
        program_name: row.get(16).unwrap_or(None),
        linked_projects_count: 0,
        progress_log: vec![],
        projects: vec![],
    }
}

/// Fetch a basic goal response by ID (with program_name via LEFT JOIN).
fn fetch_goal_response_basic(
    conn: &rusqlite::Connection,
    goal_id: i64,
) -> Result<GoalResponse, AppError> {
    conn.query_row(
        "SELECT g.id, g.created_at, g.updated_at, g.title, g.description, \
         g.specific, g.measurable, g.achievable, g.relevant, g.time_bound, \
         g.fiscal_year, g.quarter, g.status, g.target_date, g.is_accomplishment, \
         g.program_id, p.name as program_name \
         FROM goals g LEFT JOIN programs p ON g.program_id = p.id \
         WHERE g.id = ?1",
        rusqlite::params![goal_id],
        |row| Ok(goal_row_to_response(row)),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Goal not found".to_string())
        }
        other => AppError::Database(other),
    })
}

/// Fetch progress log entries for a goal (oldest first).
fn fetch_goal_progress_log(
    conn: &rusqlite::Connection,
    goal_id: i64,
) -> Result<Vec<GoalProgressLogResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, goal_id, created_at, note, status_at_time
         FROM goal_progress_log WHERE goal_id = ?1
         ORDER BY created_at ASC",
    )?;

    let logs = stmt
        .query_map(rusqlite::params![goal_id], |row| {
            Ok(GoalProgressLogResponse {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                created_at: row.get(2)?,
                note: row.get(3)?,
                status_at_time: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(logs)
}

/// Fetch projects linked to a goal.
fn fetch_goal_projects(
    conn: &rusqlite::Connection,
    goal_id: i64,
    goal_title: &str,
) -> Result<Vec<ProjectResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT p.id, p.created_at, p.updated_at, p.name, p.description,
                p.metrics, p.start_date, p.target_end_date, p.actual_end_date,
                p.status, p.goal_id, p.is_accomplishment, p.program_id,
                pr.name as program_name
         FROM projects p
         LEFT JOIN programs pr ON p.program_id = pr.id
         WHERE p.goal_id = ?1
         ORDER BY p.created_at DESC",
    )?;

    let projects = stmt
        .query_map(rusqlite::params![goal_id], |row| {
            Ok(ProjectResponse {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                name: row.get(3)?,
                description: row.get(4)?,
                metrics: row.get(5)?,
                start_date: row.get(6)?,
                target_end_date: row.get(7)?,
                actual_end_date: row.get(8)?,
                status: row.get(9)?,
                goal_id: row.get(10)?,
                is_accomplishment: row.get(11)?,
                program_id: row.get(12)?,
                program_name: row.get(13)?,
                goal_title: Some(goal_title.to_string()),
                entries: vec![],
                progress_log: vec![],
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(projects)
}
