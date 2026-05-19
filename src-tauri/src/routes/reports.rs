//! Report routes: presets and drafts CRUD.
//!
//! Implements 8 routes matching the Python FastAPI backend.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{
    CreateReportDraft, CreateReportPreset, ReportDraftResponse, ReportPresetResponse,
    UpdateReportDraft, UpdateReportPreset,
};

/// Build the reports sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/report-presets", post(create_preset))
        .route("/api/report-presets", get(list_presets))
        .route("/api/report-presets/:id", put(update_preset))
        .route("/api/report-presets/:id", delete(delete_preset))
        .route("/api/report-drafts", post(create_draft))
        .route("/api/report-drafts", get(list_drafts))
        .route("/api/report-drafts/:id", put(update_draft))
        .route("/api/report-drafts/:id", delete(delete_draft))
        .with_state(state)
}

// â”€â”€â”€ Report Presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/report-presets â€” create a new report preset.
async fn create_preset(
    State(state): State<SharedState>,
    Json(body): Json<CreateReportPreset>,
) -> Result<(StatusCode, Json<ReportPresetResponse>), AppError> {
    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO report_presets (name, template_type, scope, program_id, sections, is_default) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
        rusqlite::params![
            body.name,
            body.template_type,
            body.scope,
            body.program_id,
            body.sections,
            body.is_default,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_preset(&conn, id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/report-presets â€” list all report presets.
async fn list_presets(
    State(state): State<SharedState>,
) -> Result<Json<Vec<ReportPresetResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, created_at, name, template_type, scope, program_id, sections, is_default \
         FROM report_presets ORDER BY created_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ReportPresetResponse {
            id: row.get(0)?,
            created_at: row.get(1)?,
            name: row.get(2)?,
            template_type: row.get(3)?,
            scope: row.get(4)?,
            program_id: row.get(5)?,
            sections: row.get(6)?,
            is_default: row.get(7)?,
        })
    })?;

    let presets: Vec<ReportPresetResponse> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(presets))
}

/// PUT /api/report-presets/:id â€” update a report preset.
async fn update_preset(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateReportPreset>,
) -> Result<Json<ReportPresetResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM report_presets WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Report preset not found".to_string()));
    }

    // Build dynamic UPDATE
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = body.name {
        set_clauses.push("name = ?".to_string());
        values.push(Box::new(name.clone()));
    }
    if let Some(ref template_type) = body.template_type {
        set_clauses.push("template_type = ?".to_string());
        values.push(Box::new(template_type.clone()));
    }
    if let Some(ref scope) = body.scope {
        set_clauses.push("scope = ?".to_string());
        values.push(Box::new(scope.clone()));
    }
    if let Some(program_id) = body.program_id {
        set_clauses.push("program_id = ?".to_string());
        values.push(Box::new(program_id));
    }
    if let Some(ref sections) = body.sections {
        set_clauses.push("sections = ?".to_string());
        values.push(Box::new(sections.clone()));
    }
    if let Some(is_default) = body.is_default {
        set_clauses.push("is_default = ?".to_string());
        values.push(Box::new(is_default));
    }

    if !set_clauses.is_empty() {
        values.push(Box::new(id));
        let sql = format!(
            "UPDATE report_presets SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_preset(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/report-presets/:id â€” delete a report preset.
async fn delete_preset(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM report_presets WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Report preset not found".to_string()));
    }

    conn.execute(
        "DELETE FROM report_presets WHERE id = ?1",
        rusqlite::params![id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}

// â”€â”€â”€ Report Drafts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/report-drafts â€” create a new report draft.
async fn create_draft(
    State(state): State<SharedState>,
    Json(body): Json<CreateReportDraft>,
) -> Result<(StatusCode, Json<ReportDraftResponse>), AppError> {
    // Validate status
    let valid_statuses = ["draft", "ready", "sent"];
    if !valid_statuses.contains(&body.status.as_str()) {
        return Err(AppError::Validation(format!(
            "Invalid status '{}'. Must be one of: draft, ready, sent",
            body.status
        )));
    }

    let conn = state.pool.get()?;

    let id = conn.query_row(
        "INSERT INTO report_drafts (title, content, status, preset_id, date_range_start, date_range_end) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
        rusqlite::params![
            body.title,
            body.content,
            body.status,
            body.preset_id,
            body.date_range_start,
            body.date_range_end,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    let response = fetch_draft(&conn, id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/report-drafts â€” list all report drafts ordered by updated_at DESC.
async fn list_drafts(
    State(state): State<SharedState>,
) -> Result<Json<Vec<ReportDraftResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(
        "SELECT id, title, content, status, preset_id, date_range_start, date_range_end, \
         created_at, updated_at FROM report_drafts ORDER BY updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ReportDraftResponse {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            status: row.get(3)?,
            preset_id: row.get(4)?,
            date_range_start: row.get(5)?,
            date_range_end: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;

    let drafts: Vec<ReportDraftResponse> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(drafts))
}

/// PUT /api/report-drafts/:id â€” update a report draft (title, content, status).
async fn update_draft(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateReportDraft>,
) -> Result<Json<ReportDraftResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM report_drafts WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Report draft not found".to_string()));
    }

    // Validate status if provided
    if let Some(ref status) = body.status {
        let valid_statuses = ["draft", "ready", "sent"];
        if !valid_statuses.contains(&status.as_str()) {
            return Err(AppError::Validation(format!(
                "Invalid status '{}'. Must be one of: draft, ready, sent",
                status
            )));
        }
    }

    // Build dynamic UPDATE
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = body.title {
        set_clauses.push("title = ?".to_string());
        values.push(Box::new(title.clone()));
    }
    if let Some(ref content) = body.content {
        set_clauses.push("content = ?".to_string());
        values.push(Box::new(content.clone()));
    }
    if let Some(ref status) = body.status {
        set_clauses.push("status = ?".to_string());
        values.push(Box::new(status.clone()));
    }

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));
        let sql = format!(
            "UPDATE report_drafts SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    let response = fetch_draft(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/report-drafts/:id â€” permanently delete a report draft.
async fn delete_draft(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM report_drafts WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Report draft not found".to_string()));
    }

    conn.execute(
        "DELETE FROM report_drafts WHERE id = ?1",
        rusqlite::params![id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fn fetch_preset(conn: &rusqlite::Connection, id: i64) -> Result<ReportPresetResponse, AppError> {
    conn.query_row(
        "SELECT id, created_at, name, template_type, scope, program_id, sections, is_default \
         FROM report_presets WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(ReportPresetResponse {
                id: row.get(0)?,
                created_at: row.get(1)?,
                name: row.get(2)?,
                template_type: row.get(3)?,
                scope: row.get(4)?,
                program_id: row.get(5)?,
                sections: row.get(6)?,
                is_default: row.get(7)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Report preset not found".to_string())
        }
        other => AppError::Database(other),
    })
}

fn fetch_draft(conn: &rusqlite::Connection, id: i64) -> Result<ReportDraftResponse, AppError> {
    conn.query_row(
        "SELECT id, title, content, status, preset_id, date_range_start, date_range_end, \
         created_at, updated_at FROM report_drafts WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(ReportDraftResponse {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                status: row.get(3)?,
                preset_id: row.get(4)?,
                date_range_start: row.get(5)?,
                date_range_end: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Report draft not found".to_string())
        }
        other => AppError::Database(other),
    })
}
