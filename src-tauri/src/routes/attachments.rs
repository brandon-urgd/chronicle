//! Attachment routes: file upload, download, list, and delete.
//!
//! v3.0: Rewritten to accept multipart/form-data for file uploads.
//!
//! Routes:
//! - POST /api/attachments - multipart file upload
//! - GET /api/attachments - list attachments filtered by parent_type + parent_id
//! - GET /api/attachments/:id/download - download file bytes
//! - DELETE /api/attachments/:id - delete attachment record + file from disk

use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::entry::AttachmentResponse;

/// Query parameters for filtering attachments by parent.
#[derive(Debug, Deserialize)]
pub struct AttachmentFilters {
    pub parent_type: Option<String>,
    pub parent_id: Option<i64>,
}

/// Build the attachments sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/attachments", post(create_attachment))
        .route("/api/attachments", get(list_attachments))
        .route("/api/attachments/:id/download", get(download_attachment))
        .route("/api/attachments/:id", delete(delete_attachment))
        .with_state(state)
}

/// POST /api/attachments - multipart file upload.
///
/// Accepts multipart/form-data with fields:
/// - file (binary, required)
/// - parent_type (string, required)
/// - parent_id (integer, required)
///
/// Saves the file to {data_dir}/attachments/{uuid}_{original_name}
/// and creates a metadata row in the attachments table.
async fn create_attachment(
    State(state): State<SharedState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<AttachmentResponse>), AppError> {
    let mut file_bytes: Option<Vec<u8>> = None;
    let mut original_name: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut parent_type: Option<String> = None;
    let mut parent_id: Option<i64> = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "file" => {
                original_name = field.file_name().map(|s| s.to_string());
                mime_type = field.content_type().map(|s| s.to_string());
                match field.bytes().await {
                    Ok(bytes) => file_bytes = Some(bytes.to_vec()),
                    Err(_) => return Err(AppError::Validation("Failed to read file data".to_string())),
                }
            }
            "parent_type" => {
                if let Ok(text) = field.text().await {
                    parent_type = Some(text);
                }
            }
            "parent_id" => {
                if let Ok(text) = field.text().await {
                    parent_id = text.parse().ok();
                }
            }
            _ => {}
        }
    }

    let bytes = file_bytes.ok_or_else(|| AppError::Validation("No file provided".to_string()))?;
    let pt = parent_type.ok_or_else(|| AppError::Validation("parent_type is required".to_string()))?;
    let pid = parent_id.ok_or_else(|| AppError::Validation("parent_id is required".to_string()))?;

    if bytes.is_empty() {
        return Err(AppError::Validation("Empty files are not accepted".to_string()));
    }
    if bytes.len() > 10_485_760 {
        return Err(AppError::Validation("File exceeds 10 MB size limit".to_string()));
    }

    // Generate unique filename and save to disk
    let uuid = Uuid::new_v4();
    let orig = original_name.unwrap_or_else(|| "file".to_string());
    let filename = format!("{}_{}", uuid, orig);
    let attachments_dir = state.config.data_dir.join("attachments");
    std::fs::create_dir_all(&attachments_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create attachments dir: {e}")))?;
    std::fs::write(attachments_dir.join(&filename), &bytes)
        .map_err(|e| AppError::Internal(format!("Failed to write file: {e}")))?;

    let file_size = bytes.len() as i64;
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO attachments (parent_type, parent_id, filename, original_name, file_size, mime_type)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
        rusqlite::params![pt, pid, filename, orig, file_size, mime_type],
        |row| row.get::<_, i64>(0),
    )?;

    let response = conn.query_row(
        "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at
         FROM attachments WHERE id = ?1",
        rusqlite::params![id],
        |row| {
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
        },
    )?;

    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/attachments - list attachments filtered by parent_type and parent_id.
async fn list_attachments(
    State(state): State<SharedState>,
    Query(filters): Query<AttachmentFilters>,
) -> Result<Json<Vec<AttachmentResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at FROM attachments WHERE 1=1".to_string();
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
    let attachments = stmt
        .query_map(param_refs.as_slice(), |row| {
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
        .collect::<Vec<_>>();

    Ok(Json(attachments))
}

/// GET /api/attachments/:id/download - return file bytes with Content-Type header.
async fn download_attachment(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<impl IntoResponse, AppError> {
    let conn = state.pool.get()?;

    let (filename, mime): (String, Option<String>) = conn
        .query_row(
            "SELECT filename, mime_type FROM attachments WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Attachment not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let file_path = state.config.data_dir.join("attachments").join(&filename);
    let bytes = std::fs::read(&file_path)
        .map_err(|e| AppError::NotFound(format!("File not found on disk: {e}")))?;

    let content_type = mime.unwrap_or_else(|| "application/octet-stream".to_string());

    Ok((
        [(header::CONTENT_TYPE, content_type)],
        bytes,
    ))
}

/// DELETE /api/attachments/:id - delete attachment record and file from disk.
async fn delete_attachment(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Get filename before deleting the row
    let filename: Option<String> = conn
        .query_row(
            "SELECT filename FROM attachments WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .ok();

    let affected = conn.execute(
        "DELETE FROM attachments WHERE id = ?1",
        rusqlite::params![id],
    )?;

    if affected == 0 {
        return Err(AppError::NotFound("Attachment not found".to_string()));
    }

    // Remove file from disk (best-effort - don't fail if file is already gone)
    if let Some(ref fname) = filename {
        let file_path = state.config.data_dir.join("attachments").join(fname);
        let _ = std::fs::remove_file(&file_path);
    }

    Ok(StatusCode::NO_CONTENT)
}
