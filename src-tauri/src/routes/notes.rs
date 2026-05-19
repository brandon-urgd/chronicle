//! Prep notes routes: CRUD for 1:1 topics and follow-up reminders.
//!
//! Implements 4 routes matching the Python FastAPI backend.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch, post, put},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{CreatePrepNote, PrepNoteResponse};

/// Build the notes sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/notes", post(create_note))
        .route("/api/notes", get(list_notes))
        .route("/api/notes/:id", put(update_note))
        .route("/api/notes/:id/dismiss", patch(dismiss_note))
        .with_state(state)
}

/// POST /api/notes â€” create a new prep note.
async fn create_note(
    State(state): State<SharedState>,
    Json(body): Json<CreatePrepNote>,
) -> Result<(StatusCode, Json<PrepNoteResponse>), AppError> {
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::Validation("Note text cannot be empty".to_string()));
    }

    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO notes (text, created_at) VALUES (?1, datetime('now')) RETURNING id",
        rusqlite::params![text],
        |row| row.get::<_, i64>(0),
    )?;

    let response = conn.query_row(
        "SELECT id, text, created_at, dismissed_at FROM notes WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(PrepNoteResponse {
                id: row.get(0)?,
                text: row.get(1)?,
                created_at: row.get(2)?,
                dismissed_at: row.get(3)?,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/notes â€” list all active (non-dismissed) notes, newest first.
async fn list_notes(
    State(state): State<SharedState>,
) -> Result<Json<Vec<PrepNoteResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, text, created_at, dismissed_at FROM notes \
         WHERE dismissed_at IS NULL ORDER BY created_at DESC, id DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(PrepNoteResponse {
            id: row.get(0)?,
            text: row.get(1)?,
            created_at: row.get(2)?,
            dismissed_at: row.get(3)?,
        })
    })?;

    let notes: Vec<PrepNoteResponse> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(notes))
}

/// PUT /api/notes/:id â€” update note text.
async fn update_note(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<CreatePrepNote>,
) -> Result<Json<PrepNoteResponse>, AppError> {
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return Err(AppError::Validation("Note text cannot be empty".to_string()));
    }

    let conn = state.pool.get()?;

    // Verify note exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Note not found".to_string()));
    }

    conn.execute(
        "UPDATE notes SET text = ?1 WHERE id = ?2",
        rusqlite::params![text, id],
    )?;

    let response = conn.query_row(
        "SELECT id, text, created_at, dismissed_at FROM notes WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(PrepNoteResponse {
                id: row.get(0)?,
                text: row.get(1)?,
                created_at: row.get(2)?,
                dismissed_at: row.get(3)?,
            })
        },
    )?;

    Ok(Json(response))
}

/// PATCH /api/notes/:id/dismiss â€” set dismissed_at = datetime('now').
async fn dismiss_note(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<PrepNoteResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify note exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM notes WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound(format!("Note {} not found", id)));
    }

    conn.execute(
        "UPDATE notes SET dismissed_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    )?;

    let response = conn.query_row(
        "SELECT id, text, created_at, dismissed_at FROM notes WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(PrepNoteResponse {
                id: row.get(0)?,
                text: row.get(1)?,
                created_at: row.get(2)?,
                dismissed_at: row.get(3)?,
            })
        },
    )?;

    Ok(Json(response))
}
