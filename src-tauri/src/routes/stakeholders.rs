//! Stakeholder routes: CRUD for stakeholders with project associations.
//!
//! Routes:
//! - POST /api/stakeholders Ã¢â‚¬â€ create stakeholder
//! - GET /api/stakeholders Ã¢â‚¬â€ list all stakeholders with project_count and project_names
//! - GET /api/stakeholders/:id Ã¢â‚¬â€ get by ID with project associations
//! - PUT /api/stakeholders/:id Ã¢â‚¬â€ update stakeholder fields
//! - DELETE /api/stakeholders/:id Ã¢â‚¬â€ delete stakeholder (CASCADE handles project_stakeholders)
//! - POST /api/projects/:project_id/stakeholders/:stakeholder_id Ã¢â‚¬â€ link stakeholder to project
//! - DELETE /api/projects/:project_id/stakeholders/:stakeholder_id Ã¢â‚¬â€ unlink stakeholder from project

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{CreateStakeholder, StakeholderSummaryResponse, UpdateStakeholder};
use crate::models::project::StakeholderResponse;

/// Build the stakeholders sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/stakeholders", post(create_stakeholder))
        .route("/api/stakeholders", get(list_stakeholders))
        .route("/api/stakeholders/:id", get(get_stakeholder))
        .route("/api/stakeholders/:id", put(update_stakeholder))
        .route("/api/stakeholders/:id", delete(delete_stakeholder))
        .route(
            "/api/projects/:project_id/stakeholders/:stakeholder_id",
            post(link_stakeholder),
        )
        .route(
            "/api/projects/:project_id/stakeholders/:stakeholder_id",
            delete(unlink_stakeholder),
        )
        .with_state(state)
}

/// POST /api/stakeholders Ã¢â‚¬â€ create a new stakeholder.
async fn create_stakeholder(
    State(state): State<SharedState>,
    Json(body): Json<CreateStakeholder>,
) -> Result<(StatusCode, Json<StakeholderResponse>), AppError> {
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO stakeholders (name, email, role, notes) VALUES (?1, ?2, ?3, ?4) RETURNING id",
        rusqlite::params![body.name, body.email, body.role, body.notes],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_stakeholder_detail(&conn, id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/stakeholders Ã¢â‚¬â€ list all stakeholders with project_count and project_names.
async fn list_stakeholders(
    State(state): State<SharedState>,
) -> Result<Json<Vec<StakeholderSummaryResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.email, s.role
         FROM stakeholders s
         ORDER BY s.name",
    )?;

    let rows: Vec<(i64, String, Option<String>, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::new();
    for (id, name, email, role) in rows {
        let mut proj_stmt = conn.prepare(
            "SELECT p.name FROM projects p
             JOIN project_stakeholders ps ON p.id = ps.project_id
             WHERE ps.stakeholder_id = ?1
             ORDER BY p.name",
        )?;
        let project_names: Vec<String> = proj_stmt
            .query_map(rusqlite::params![id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();

        results.push(StakeholderSummaryResponse {
            id,
            name,
            email,
            role,
            project_count: project_names.len() as i64,
            project_names,
        });
    }

    Ok(Json(results))
}

/// GET /api/stakeholders/:id Ã¢â‚¬â€ get stakeholder by ID with full detail.
async fn get_stakeholder(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<StakeholderResponse>, AppError> {
    let conn = state.pool.get()?;
    let response = fetch_stakeholder_detail(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/stakeholders/:id Ã¢â‚¬â€ update stakeholder fields.
async fn update_stakeholder(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateStakeholder>,
) -> Result<Json<StakeholderResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify stakeholder exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM stakeholders WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Stakeholder not found".to_string()));
    }

    // Build dynamic UPDATE
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = body.name {
        set_clauses.push("name = ?".to_string());
        values.push(Box::new(name.clone()));
    }
    if let Some(ref email) = body.email {
        set_clauses.push("email = ?".to_string());
        values.push(Box::new(email.clone()));
    }
    if let Some(ref role) = body.role {
        set_clauses.push("role = ?".to_string());
        values.push(Box::new(role.clone()));
    }
    if let Some(ref notes) = body.notes {
        set_clauses.push("notes = ?".to_string());
        values.push(Box::new(notes.clone()));
    }

    if !set_clauses.is_empty() {
        values.push(Box::new(id));
        let sql = format!(
            "UPDATE stakeholders SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_stakeholder_detail(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/stakeholders/:id Ã¢â‚¬â€ delete stakeholder (CASCADE handles project_stakeholders).
async fn delete_stakeholder(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let affected = conn.execute(
        "DELETE FROM stakeholders WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Stakeholder not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/projects/:project_id/stakeholders/:stakeholder_id Ã¢â‚¬â€ link stakeholder to project.
async fn link_stakeholder(
    State(state): State<SharedState>,
    Path((project_id, stakeholder_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify project exists
    let project_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !project_exists {
        return Err(AppError::NotFound("Project not found".to_string()));
    }

    // Verify stakeholder exists
    let stakeholder_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM stakeholders WHERE id = ?1",
            rusqlite::params![stakeholder_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !stakeholder_exists {
        return Err(AppError::NotFound("Stakeholder not found".to_string()));
    }

    // INSERT OR IGNORE to handle idempotent linking
    conn.execute(
        "INSERT OR IGNORE INTO project_stakeholders (project_id, stakeholder_id) VALUES (?1, ?2)",
        rusqlite::params![project_id, stakeholder_id],
    )?;

    Ok(StatusCode::CREATED)
}

/// DELETE /api/projects/:project_id/stakeholders/:stakeholder_id Ã¢â‚¬â€ unlink stakeholder from project.
async fn unlink_stakeholder(
    State(state): State<SharedState>,
    Path((project_id, stakeholder_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let affected = conn.execute(
        "DELETE FROM project_stakeholders WHERE project_id = ?1 AND stakeholder_id = ?2",
        rusqlite::params![project_id, stakeholder_id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound(
            "Project-stakeholder association not found".to_string(),
        ));
    }

    Ok(StatusCode::NO_CONTENT)
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Helper Functions Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

/// Fetch a stakeholder by ID with full detail.
fn fetch_stakeholder_detail(
    conn: &rusqlite::Connection,
    id: i64,
) -> Result<StakeholderResponse, AppError> {
    conn.query_row(
        "SELECT id, name, email, role, notes, created_at FROM stakeholders WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(StakeholderResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
                role: row.get(3)?,
                notes: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Stakeholder not found".to_string())
        }
        other => AppError::Database(other),
    })
}
