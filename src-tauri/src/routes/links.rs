//! Link routes: CRUD for polymorphic links.
//!
//! Routes:
//! - POST /api/links â€” create link
//! - GET /api/links â€” list links filtered by parent_type + parent_id
//! - DELETE /api/links/:id â€” delete link

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::CreateLink;
use crate::models::entry::LinkResponse;

/// Query parameters for filtering links by parent.
#[derive(Debug, Deserialize)]
pub struct LinkFilters {
    pub parent_type: Option<String>,
    pub parent_id: Option<i64>,
}

/// Build the links sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/links", post(create_link))
        .route("/api/links", get(list_links))
        .route("/api/links/:id", delete(delete_link))
        .with_state(state)
}

/// POST /api/links â€” create a new link.
async fn create_link(
    State(state): State<SharedState>,
    Json(body): Json<CreateLink>,
) -> Result<(StatusCode, Json<LinkResponse>), AppError> {
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO links (parent_type, parent_id, url, label) VALUES (?1, ?2, ?3, ?4) RETURNING id",
        rusqlite::params![body.parent_type, body.parent_id, body.url, body.label],
        |row| row.get::<_, i64>(0),
    )?;

    let response = conn.query_row(
        "SELECT id, parent_type, parent_id, url, label, created_at FROM links WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(LinkResponse {
                id: row.get(0)?,
                parent_type: row.get(1)?,
                parent_id: row.get(2)?,
                url: row.get(3)?,
                label: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/links â€” list links filtered by parent_type and parent_id query params.
async fn list_links(
    State(state): State<SharedState>,
    Query(filters): Query<LinkFilters>,
) -> Result<Json<Vec<LinkResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT id, parent_type, parent_id, url, label, created_at FROM links WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref parent_type) = filters.parent_type {
        sql.push_str(" AND parent_type = ?");
        params.push(Box::new(parent_type.clone()));
    }
    if let Some(parent_id) = filters.parent_id {
        sql.push_str(" AND parent_id = ?");
        params.push(Box::new(parent_id));
    }

    sql.push_str(" ORDER BY created_at ASC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let links = stmt
        .query_map(param_refs.as_slice(), |row| {
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
        .collect::<Vec<_>>();

    Ok(Json(links))
}

/// DELETE /api/links/:id â€” delete a link.
async fn delete_link(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let affected = conn.execute(
        "DELETE FROM links WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Link not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}
