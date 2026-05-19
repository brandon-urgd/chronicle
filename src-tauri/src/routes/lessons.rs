//! Lesson routes: CRUD for lessons_learned with tag associations.
//!
//! Routes:
//! - POST /api/lessons â€” create lesson with tag_ids
//! - GET /api/lessons â€” list all lessons (optional source_project_id filter)
//! - GET /api/lessons/:id â€” get by ID with tags, links, attachments, source names
//! - PUT /api/lessons/:id â€” update lesson fields + tag_ids
//! - DELETE /api/lessons/:id â€” delete lesson (CASCADE handles lesson_tags)

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{CreateLesson, UpdateLesson};
use crate::models::entry::{AttachmentResponse, LinkResponse, TagResponse};
use crate::models::project::LessonResponse;

/// Query parameters for the list lessons endpoint.
#[derive(Debug, Deserialize)]
pub struct LessonFilters {
    pub source_project_id: Option<i64>,
}

/// Build the lessons sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/lessons", post(create_lesson))
        .route("/api/lessons", get(list_lessons))
        .route("/api/lessons/:id", get(get_lesson))
        .route("/api/lessons/:id", put(update_lesson))
        .route("/api/lessons/:id", delete(delete_lesson))
        .with_state(state)
}

/// POST /api/lessons â€” create a new lesson with tag associations.
async fn create_lesson(
    State(state): State<SharedState>,
    Json(body): Json<CreateLesson>,
) -> Result<(StatusCode, Json<LessonResponse>), AppError> {
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO lessons_learned (title, context, lesson, application,
            source_entry_id, source_project_id, date_range_start, date_range_end, date_range_label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id",
        rusqlite::params![
            body.title,
            body.context,
            body.lesson,
            body.application,
            body.source_entry_id,
            body.source_project_id,
            body.date_range_start,
            body.date_range_end,
            body.date_range_label,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    // Insert lesson_tags junction rows
    for tag_id in &body.tag_ids {
        conn.execute(
            "INSERT INTO lesson_tags (lesson_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![id, tag_id],
        )?;
    }

    let response = fetch_lesson_response(&conn, id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/lessons â€” list all lessons with optional source_project_id filter.
async fn list_lessons(
    State(state): State<SharedState>,
    Query(filters): Query<LessonFilters>,
) -> Result<Json<Vec<LessonResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT id FROM lessons_learned WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(source_project_id) = filters.source_project_id {
        sql.push_str(" AND source_project_id = ?");
        params.push(Box::new(source_project_id));
    }

    sql.push_str(" ORDER BY created_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let ids: Vec<i64> = stmt
        .query_map(param_refs.as_slice(), |row| row.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut lessons = Vec::new();
    for lesson_id in ids {
        lessons.push(fetch_lesson_response(&conn, lesson_id)?);
    }

    Ok(Json(lessons))
}

/// GET /api/lessons/:id â€” get a single lesson with tags, links, attachments, source names.
async fn get_lesson(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<LessonResponse>, AppError> {
    let conn = state.pool.get()?;
    let response = fetch_lesson_response(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/lessons/:id â€” update lesson fields and tag_ids.
async fn update_lesson(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateLesson>,
) -> Result<Json<LessonResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify lesson exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM lessons_learned WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Lesson not found".to_string()));
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

    macro_rules! add_field_i64 {
        ($field:expr, $name:literal) => {
            if let Some(val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                values.push(Box::new(val));
            }
        };
    }

    add_field!(body.title, "title");
    add_field!(body.context, "context");
    add_field!(body.lesson, "lesson");
    add_field!(body.application, "application");
    add_field_i64!(body.source_entry_id, "source_entry_id");
    add_field_i64!(body.source_project_id, "source_project_id");
    add_field!(body.date_range_start, "date_range_start");
    add_field!(body.date_range_end, "date_range_end");
    add_field!(body.date_range_label, "date_range_label");

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE lessons_learned SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    } else if body.tag_ids.is_some() {
        // Still update updated_at even if only tag_ids changed
        conn.execute(
            "UPDATE lessons_learned SET updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )?;
    }

    // Handle tag_ids update
    if let Some(ref tag_ids) = body.tag_ids {
        conn.execute(
            "DELETE FROM lesson_tags WHERE lesson_id = ?1",
            rusqlite::params![id],
        )?;
        for tid in tag_ids {
            conn.execute(
                "INSERT INTO lesson_tags (lesson_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![id, tid],
            )?;
        }
    }

    let response = fetch_lesson_response(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/lessons/:id â€” delete a lesson (CASCADE handles lesson_tags).
async fn delete_lesson(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Delete polymorphic links and attachments
    conn.execute(
        "DELETE FROM links WHERE parent_type = 'lesson' AND parent_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM attachments WHERE parent_type = 'lesson' AND parent_id = ?1",
        rusqlite::params![id],
    )?;

    let affected = conn.execute(
        "DELETE FROM lessons_learned WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Lesson not found".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Fetch a complete lesson response by ID with tags, links, attachments, and source names.
fn fetch_lesson_response(
    conn: &rusqlite::Connection,
    lesson_id: i64,
) -> Result<LessonResponse, AppError> {
    let lesson = conn
        .query_row(
            "SELECT l.id, l.created_at, l.updated_at, l.title, l.context, l.lesson,
                    l.application, l.source_entry_id, l.source_project_id,
                    l.date_range_start, l.date_range_end, l.date_range_label,
                    e.title, p.name
             FROM lessons_learned l
             LEFT JOIN entries e ON l.source_entry_id = e.id
             LEFT JOIN projects p ON l.source_project_id = p.id
             WHERE l.id = ?1",
            rusqlite::params![lesson_id],
            |row| {
                Ok(LessonResponse {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    updated_at: row.get(2)?,
                    title: row.get(3)?,
                    context: row.get(4)?,
                    lesson: row.get(5)?,
                    application: row.get(6)?,
                    source_entry_id: row.get(7)?,
                    source_project_id: row.get(8)?,
                    source_entry_title: row.get(12)?,
                    source_project_name: row.get(13)?,
                    date_range_start: row.get(9)?,
                    date_range_end: row.get(10)?,
                    date_range_label: row.get(11)?,
                    tags: vec![],
                    links: vec![],
                    attachments: vec![],
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Lesson not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // Fetch tags
    let mut tag_stmt = conn.prepare(
        "SELECT t.id, t.name, t.created_at
         FROM tags t
         JOIN lesson_tags lt ON t.id = lt.tag_id
         WHERE lt.lesson_id = ?1
         ORDER BY t.name",
    )?;
    let tags: Vec<TagResponse> = tag_stmt
        .query_map(rusqlite::params![lesson_id], |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    // Fetch links
    let mut link_stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, url, label, created_at
         FROM links WHERE parent_type = 'lesson' AND parent_id = ?1
         ORDER BY created_at ASC",
    )?;
    let links: Vec<LinkResponse> = link_stmt
        .query_map(rusqlite::params![lesson_id], |row| {
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

    // Fetch attachments
    let mut att_stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at
         FROM attachments WHERE parent_type = 'lesson' AND parent_id = ?1
         ORDER BY created_at ASC",
    )?;
    let attachments: Vec<AttachmentResponse> = att_stmt
        .query_map(rusqlite::params![lesson_id], |row| {
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

    Ok(LessonResponse {
        tags,
        links,
        attachments,
        ..lesson
    })
}
