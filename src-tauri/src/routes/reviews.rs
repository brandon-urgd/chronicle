//! Review routes: review sessions and review notes.
//!
//! Implements 3 routes matching the Python FastAPI backend.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{
    CreateReviewNote, CreateReviewSession, ReviewNoteResponse, ReviewSessionResponse,
};

/// Valid review types matching the DB CHECK constraint.
const VALID_REVIEW_TYPES: &[&str] = &["weekly", "monthly", "quarterly", "annual", "custom"];

/// Build the reviews sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/reviews", post(create_review))
        .route("/api/reviews", get(list_reviews))
        .route("/api/reviews/:id", get(get_review))
        .with_state(state)
}

/// POST /api/reviews â€” create a review session (with optional review_notes array).
async fn create_review(
    State(state): State<SharedState>,
    Json(body): Json<CreateReviewSessionWithNotes>,
) -> Result<(StatusCode, Json<ReviewSessionResponse>), AppError> {
    // Validate review_type
    if !VALID_REVIEW_TYPES.contains(&body.session.review_type.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid review_type '{}'. Must be one of: {}",
            body.session.review_type,
            VALID_REVIEW_TYPES.join(", ")
        )));
    }

    let conn = state.pool.get()?;

    let session_id = conn.query_row(
        "INSERT INTO review_sessions (review_date, date_range_start, date_range_end, \
         review_type, session_notes, program_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
        rusqlite::params![
            body.session.review_date,
            body.session.date_range_start,
            body.session.date_range_end,
            body.session.review_type,
            body.session.session_notes,
            body.session.program_id,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    // Insert review notes if provided
    let mut notes = Vec::new();
    for note_body in &body.notes {
        let note_id = conn.query_row(
            "INSERT INTO review_notes (review_session_id, parent_type, parent_id, note_text) \
             VALUES (?1, ?2, ?3, ?4) RETURNING id",
            rusqlite::params![session_id, note_body.parent_type, note_body.parent_id, note_body.note_text],
            |row| row.get::<_, i64>(0),
        )?;

        let note = conn.query_row(
            "SELECT id, review_session_id, parent_type, parent_id, note_text, created_at \
             FROM review_notes WHERE id = ?1",
            rusqlite::params![note_id],
            |row| {
                Ok(ReviewNoteResponse {
                    id: row.get(0)?,
                    review_session_id: row.get(1)?,
                    parent_type: row.get(2)?,
                    parent_id: row.get(3)?,
                    note_text: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )?;
        notes.push(note);
    }

    let session = conn.query_row(
        "SELECT id, review_date, date_range_start, date_range_end, review_type, \
         session_notes, created_at, program_id FROM review_sessions WHERE id = ?1",
        rusqlite::params![session_id],
        |row| {
            Ok(ReviewSessionResponse {
                id: row.get(0)?,
                review_date: row.get(1)?,
                date_range_start: row.get(2)?,
                date_range_end: row.get(3)?,
                review_type: row.get(4)?,
                session_notes: row.get(5)?,
                created_at: row.get(6)?,
                program_id: row.get(7)?,
                notes,
            })
        },
    )?;

    Ok((StatusCode::CREATED, Json(session)))
}

/// GET /api/reviews â€” list all review sessions (without notes).
async fn list_reviews(
    State(state): State<SharedState>,
) -> Result<Json<Vec<ReviewSessionResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, review_date, date_range_start, date_range_end, review_type, \
         session_notes, created_at, program_id \
         FROM review_sessions ORDER BY review_date DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ReviewSessionResponse {
            id: row.get(0)?,
            review_date: row.get(1)?,
            date_range_start: row.get(2)?,
            date_range_end: row.get(3)?,
            review_type: row.get(4)?,
            session_notes: row.get(5)?,
            created_at: row.get(6)?,
            program_id: row.get(7)?,
            notes: vec![],
        })
    })?;

    let sessions: Vec<ReviewSessionResponse> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(sessions))
}

/// GET /api/reviews/:id â€” get a review session by ID with nested review_notes.
async fn get_review(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<ReviewSessionResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut session = conn
        .query_row(
            "SELECT id, review_date, date_range_start, date_range_end, review_type, \
             session_notes, created_at, program_id FROM review_sessions WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(ReviewSessionResponse {
                    id: row.get(0)?,
                    review_date: row.get(1)?,
                    date_range_start: row.get(2)?,
                    date_range_end: row.get(3)?,
                    review_type: row.get(4)?,
                    session_notes: row.get(5)?,
                    created_at: row.get(6)?,
                    program_id: row.get(7)?,
                    notes: vec![],
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Review session not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // Fetch associated review notes
    let mut stmt = conn.prepare(
        "SELECT id, review_session_id, parent_type, parent_id, note_text, created_at \
         FROM review_notes WHERE review_session_id = ?1 ORDER BY created_at ASC",
    )?;

    let note_rows = stmt.query_map(rusqlite::params![id], |row| {
        Ok(ReviewNoteResponse {
            id: row.get(0)?,
            review_session_id: row.get(1)?,
            parent_type: row.get(2)?,
            parent_id: row.get(3)?,
            note_text: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;

    session.notes = note_rows.filter_map(|r| r.ok()).collect();
    Ok(Json(session))
}

// â”€â”€â”€ Request Model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Combined request body for creating a review session with optional notes.
#[derive(Debug, Clone, serde::Deserialize)]
struct CreateReviewSessionWithNotes {
    #[serde(flatten)]
    session: CreateReviewSession,
    #[serde(default)]
    notes: Vec<CreateReviewNote>,
}
