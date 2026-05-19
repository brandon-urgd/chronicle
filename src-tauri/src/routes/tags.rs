//! Tag routes: CRUD for tags.
//!
//! Routes:
//! - POST /api/tags â€” create tag
//! - GET /api/tags â€” list all tags
//! - PUT /api/tags/:id â€” update tag name
//! - DELETE /api/tags/:id â€” delete tag (CASCADE handles entry_tags, lesson_tags)

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{CreateTag, UpdateTag};
use crate::models::entry::TagResponse;

/// Build the tags sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/tags", post(create_tag))
        .route("/api/tags", get(list_tags))
        .route("/api/tags/:id", put(update_tag))
        .route("/api/tags/:id", delete(delete_tag))
        .with_state(state)
}

/// POST /api/tags â€” create a new tag.
async fn create_tag(
    State(state): State<SharedState>,
    Json(body): Json<CreateTag>,
) -> Result<(StatusCode, Json<TagResponse>), AppError> {
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO tags (name) VALUES (?1) RETURNING id",
        rusqlite::params![body.name],
        |row| row.get::<_, i64>(0),
    )?;

    let response = conn.query_row(
        "SELECT id, name, created_at FROM tags WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/tags â€” list all tags.
async fn list_tags(
    State(state): State<SharedState>,
) -> Result<Json<Vec<TagResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, name, created_at FROM tags ORDER BY name",
    )?;

    let tags = stmt
        .query_map([], |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();

    Ok(Json(tags))
}

/// PUT /api/tags/:id â€” update tag name.
async fn update_tag(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateTag>,
) -> Result<Json<TagResponse>, AppError> {
    let conn = state.pool.get()?;

    let affected = conn.execute(
        "UPDATE tags SET name = ?1 WHERE id = ?2",
        rusqlite::params![body.name, id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Tag not found".to_string()));
    }

    let response = conn.query_row(
        "SELECT id, name, created_at FROM tags WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        },
    )?;

    Ok(Json(response))
}

/// DELETE /api/tags/:id â€” delete tag (CASCADE handles entry_tags, lesson_tags).
async fn delete_tag(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let affected = conn.execute(
        "DELETE FROM tags WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Tag not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}
