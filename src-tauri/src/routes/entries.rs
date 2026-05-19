//! Entry routes: full CRUD plus toggle/highlight operations.
//!
//! Implements ~12 routes matching the Python FastAPI backend exactly.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, put},
    Json, Router,
};
use chrono::{Datelike, NaiveDate};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::entry::{
    AttachmentResponse, CreateEntry, EntryResponse, LinkResponse, TagResponse, UpdateEntry,
};

/// Query parameters for the list entries endpoint.
#[derive(Debug, Deserialize)]
pub struct EntryFilters {
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub program_id: Option<i64>,
    pub project_id: Option<i64>,
    pub entry_type: Option<String>,
    pub work_type: Option<String>,
    pub tag_ids: Option<String>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub search: Option<String>,
    pub is_pinned: Option<i64>,
}

/// Build the entries sub-router.
///
/// v3.0: POST /api/entries removed — entries are now created exclusively
/// through the Task_Completion_Flow (POST /api/scheduled-items/:id/complete
/// or POST /api/scheduled-items with auto_complete=true).
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/entries", get(list_entries))
        .route("/api/entries/:id", get(get_entry))
        .route("/api/entries/:id", put(update_entry))
        .route("/api/entries/:id", delete(delete_entry))
        .route("/api/entries/:id/pin", patch(toggle_pin))
        .route("/api/entries/:id/highlight", put(set_highlight))
        .route("/api/entries/:id/accomplishment", put(toggle_accomplishment))
        .route(
            "/api/entries/:id/lesson-learned",
            put(toggle_lesson_learned),
        )
        .with_state(state)
}

// â”€â”€â”€ SQL Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Base SELECT for entries with joined project and program names.
///
/// Exposed at crate visibility so other route modules (e.g., dashboard) can
/// append their own WHERE / ORDER BY / LIMIT clauses without duplicating the
/// column list or join shape.
pub(crate) const ENTRY_SELECT: &str = r#"
    SELECT e.id, e.created_at, e.updated_at, e.entry_date, e.entry_type,
           e.work_type, e.title, e.description, e.impact, e.metrics,
           e.project_id, e.status, e.visibility,
           e.is_accomplishment, e.is_lesson_learned, e.is_weekly_highlight,
           p.name, e.program_id, e.scheduled_item_id, prog.name,
           e.is_pinned, e.outcome
    FROM entries e
    LEFT JOIN projects p ON e.project_id = p.id
    LEFT JOIN programs prog ON e.program_id = prog.id
"#;

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/entries â€” create a new entry with tag associations.
#[allow(dead_code)]
async fn create_entry(
    State(state): State<SharedState>,
    Json(body): Json<CreateEntry>,
) -> Result<(StatusCode, Json<EntryResponse>), AppError> {
    let conn = state.pool.get()?;

    // Auto-infer work_type from project_id
    let work_type = if body.project_id.is_some() {
        "project"
    } else {
        "operational_rhythm"
    };

    // Default entry_date to today if not provided
    let entry_date = body
        .entry_date
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());

    let entry_id = conn.query_row(
        "INSERT INTO entries (entry_date, entry_type, work_type, title,
            description, impact, metrics, project_id, status, visibility,
            is_accomplishment, is_lesson_learned, is_weekly_highlight,
            program_id, scheduled_item_id, is_pinned, outcome)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            RETURNING id",
        rusqlite::params![
            entry_date,
            body.entry_type,
            work_type,
            body.title,
            body.description,
            body.impact,
            body.metrics,
            body.project_id,
            body.status,
            body.visibility,
            body.is_accomplishment,
            body.is_lesson_learned,
            body.is_weekly_highlight,
            body.program_id,
            body.scheduled_item_id,
            body.is_pinned,
            body.outcome,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    // Insert entry_tags junction rows
    for tag_id in &body.tag_ids {
        conn.execute(
            "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![entry_id, tag_id],
        )?;
    }

    // Auto-tag: add 'project' tag when entry is linked to a project
    auto_tag_entry(&conn, entry_id, body.project_id)?;

    let response = fetch_entry_response(&conn, entry_id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/entries â€” list entries with optional filters.
async fn list_entries(
    State(state): State<SharedState>,
    Query(filters): Query<EntryFilters>,
) -> Result<Json<Vec<EntryResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = format!("{} WHERE 1=1", ENTRY_SELECT);
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref date_start) = filters.date_start {
        sql.push_str(" AND e.entry_date >= ?");
        params.push(Box::new(date_start.clone()));
    }
    if let Some(ref date_end) = filters.date_end {
        sql.push_str(" AND e.entry_date <= ?");
        params.push(Box::new(date_end.clone()));
    }
    if let Some(ref entry_type) = filters.entry_type {
        sql.push_str(" AND e.entry_type = ?");
        params.push(Box::new(entry_type.clone()));
    }
    if let Some(ref work_type) = filters.work_type {
        sql.push_str(" AND e.work_type = ?");
        params.push(Box::new(work_type.clone()));
    }
    if let Some(project_id) = filters.project_id {
        sql.push_str(" AND e.project_id = ?");
        params.push(Box::new(project_id));
    }
    if let Some(program_id) = filters.program_id {
        sql.push_str(
            " AND (e.program_id = ? OR e.project_id IN (\
                SELECT pr.id FROM projects pr \
                JOIN goals g ON pr.goal_id = g.id \
                WHERE g.program_id = ?\
            ))",
        );
        params.push(Box::new(program_id));
        params.push(Box::new(program_id));
    }
    if let Some(ref status) = filters.status {
        sql.push_str(" AND e.status = ?");
        params.push(Box::new(status.clone()));
    }
    if let Some(ref visibility) = filters.visibility {
        sql.push_str(" AND e.visibility = ?");
        params.push(Box::new(visibility.clone()));
    }
    if let Some(ref search) = filters.search {
        sql.push_str(" AND (e.title LIKE ? OR e.description LIKE ?)");
        let like_term = format!("%{}%", search);
        params.push(Box::new(like_term.clone()));
        params.push(Box::new(like_term));
    }
    if let Some(ref tag_ids_str) = filters.tag_ids {
        let tag_id_list: Vec<i64> = tag_ids_str
            .split(',')
            .filter_map(|s| s.trim().parse::<i64>().ok())
            .collect();
        if !tag_id_list.is_empty() {
            let placeholders: Vec<String> = tag_id_list.iter().map(|_| "?".to_string()).collect();
            sql.push_str(&format!(
                " AND e.id IN (SELECT entry_id FROM entry_tags WHERE tag_id IN ({}))",
                placeholders.join(",")
            ));
            for tid in tag_id_list {
                params.push(Box::new(tid));
            }
        }
    }
    if let Some(is_pinned) = filters.is_pinned {
        sql.push_str(" AND e.is_pinned = ?");
        params.push(Box::new(is_pinned));
    }

    sql.push_str(" ORDER BY e.entry_date DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(entry_row_to_response_basic(row))
    })?;

    let mut entries = Vec::new();
    for row_result in rows {
        let mut entry = row_result?;
        entry.tags = fetch_entry_tags(&conn, entry.id)?;
        entries.push(entry);
    }

    Ok(Json(entries))
}

/// GET /api/entries/:id â€” get a single entry with tags, links, and attachments.
async fn get_entry(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;
    let response = fetch_entry_response_full(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/entries/:id â€” update entry fields.
async fn update_entry(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateEntry>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify entry exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Entry not found".to_string()));
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

    // For nullable text fields: empty string → NULL in DB
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

    add_field!(body.entry_date, "entry_date");
    add_field!(body.entry_type, "entry_type");
    add_field!(body.work_type, "work_type");
    add_field!(body.title, "title");
    add_nullable_field!(body.description, "description");
    add_nullable_field!(body.impact, "impact");
    add_nullable_field!(body.metrics, "metrics");
    add_field_i64!(body.project_id, "project_id");
    add_field_i64!(body.program_id, "program_id");
    add_field_i64!(body.scheduled_item_id, "scheduled_item_id");
    add_field!(body.status, "status");
    add_field!(body.visibility, "visibility");
    add_field_i64!(body.is_accomplishment, "is_accomplishment");
    add_field_i64!(body.is_lesson_learned, "is_lesson_learned");
    add_field_i64!(body.is_weekly_highlight, "is_weekly_highlight");
    add_field_i64!(body.is_pinned, "is_pinned");
    add_nullable_field!(body.outcome, "outcome");

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE entries SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    } else if body.tag_ids.is_some() {
        // Still update updated_at even if only tag_ids changed
        conn.execute(
            "UPDATE entries SET updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )?;
    }

    // Handle tag_ids update
    if let Some(ref tag_ids) = body.tag_ids {
        conn.execute(
            "DELETE FROM entry_tags WHERE entry_id = ?1",
            rusqlite::params![id],
        )?;
        for tid in tag_ids {
            conn.execute(
                "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![id, tid],
            )?;
        }
    }

    // Auto-tag: project tag
    let cur_state: Option<Option<i64>> = conn
        .query_row(
            "SELECT project_id FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .ok();
    if let Some(project_id) = cur_state {
        auto_tag_entry(&conn, id, project_id)?;
    }

    let response = fetch_entry_response(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/entries/:id â€” delete an entry (CASCADE handles entry_tags).
async fn delete_entry(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify entry exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Entry not found".to_string()));
    }

    // Set source_entry_id=NULL on lessons_learned referencing this entry
    conn.execute(
        "UPDATE lessons_learned SET source_entry_id = NULL WHERE source_entry_id = ?1",
        rusqlite::params![id],
    )?;

    // Delete links and attachments (polymorphic, no FK on parent_id)
    conn.execute(
        "DELETE FROM links WHERE parent_type = 'entry' AND parent_id = ?1",
        rusqlite::params![id],
    )?;
    conn.execute(
        "DELETE FROM attachments WHERE parent_type = 'entry' AND parent_id = ?1",
        rusqlite::params![id],
    )?;

    // entry_tags has ON DELETE CASCADE â€” handled by FK
    conn.execute("DELETE FROM entries WHERE id = ?1", rusqlite::params![id])?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/entries/:id/pin â€” toggle is_pinned (0â†”1).
async fn toggle_pin(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;

    let current: i64 = conn
        .query_row(
            "SELECT is_pinned FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Entry not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let new_val: i64 = if current != 0 { 0 } else { 1 };
    conn.execute(
        "UPDATE entries SET is_pinned = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_val, id],
    )?;

    let response = fetch_entry_response(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/entries/:id/highlight â€” set is_weekly_highlight=1 with week-boundary logic.
///
/// Finds the Sunâ€“Sat week boundary for the entry's entry_date, then sets
/// is_weekly_highlight=0 on all other entries in that same week before
/// setting the target entry to 1.
async fn set_highlight(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;

    let entry_date_str: String = conn
        .query_row(
            "SELECT entry_date FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Entry not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // Parse date (take first 10 chars for YYYY-MM-DD)
    let date_str = &entry_date_str[..10.min(entry_date_str.len())];
    let entry_date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map_err(|_| AppError::Internal("Invalid entry_date format".to_string()))?;

    // Compute Sunday of the week (isoweekday: Mon=1..Sun=7)
    let days_since_sunday = entry_date.weekday().num_days_from_sunday();
    let sunday = entry_date - chrono::Duration::days(days_since_sunday as i64);
    let saturday = sunday + chrono::Duration::days(6);

    // Unset highlight on all entries in this week
    conn.execute(
        "UPDATE entries SET is_weekly_highlight = 0 \
         WHERE entry_date >= ?1 AND entry_date <= ?2 \
         AND is_weekly_highlight = 1",
        rusqlite::params![sunday.to_string(), saturday.to_string()],
    )?;

    // Set highlight on the target entry
    conn.execute(
        "UPDATE entries SET is_weekly_highlight = 1, updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![id],
    )?;

    let response = fetch_entry_response(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/entries/:id/accomplishment â€” toggle is_accomplishment (0â†”1).
async fn toggle_accomplishment(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;

    let current: i64 = conn
        .query_row(
            "SELECT is_accomplishment FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Entry not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let new_val: i64 = if current != 0 { 0 } else { 1 };
    conn.execute(
        "UPDATE entries SET is_accomplishment = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_val, id],
    )?;

    let response = fetch_entry_response(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/entries/:id/lesson-learned â€” toggle is_lesson_learned (0â†”1).
async fn toggle_lesson_learned(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;

    let current: i64 = conn
        .query_row(
            "SELECT is_lesson_learned FROM entries WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Entry not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    let new_val: i64 = if current != 0 { 0 } else { 1 };
    conn.execute(
        "UPDATE entries SET is_lesson_learned = ?1, updated_at = datetime('now') WHERE id = ?2",
        rusqlite::params![new_val, id],
    )?;

    let response = fetch_entry_response(&conn, id)?;
    Ok(Json(response))
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Auto-add 'project' tag when entry is linked to a project.
fn auto_tag_entry(
    conn: &rusqlite::Connection,
    entry_id: i64,
    project_id: Option<i64>,
) -> Result<(), AppError> {
    if project_id.is_none() {
        return Ok(());
    }
    let tag_row: Option<i64> = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1",
            rusqlite::params!["project"],
            |row| row.get(0),
        )
        .ok();
    if let Some(tag_id) = tag_row {
        conn.execute(
            "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![entry_id, tag_id],
        )?;
    }
    Ok(())
}

/// Fetch tags for a given entry via the entry_tags junction table.
///
/// Exposed at crate visibility so other route modules that return EntryResponse
/// values (e.g., dashboard) can populate the `tags` field consistently.
pub(crate) fn fetch_entry_tags(
    conn: &rusqlite::Connection,
    entry_id: i64,
) -> Result<Vec<TagResponse>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.created_at \
         FROM tags t \
         JOIN entry_tags et ON t.id = et.tag_id \
         WHERE et.entry_id = ?1 \
         ORDER BY t.name",
    )?;
    let tags = stmt
        .query_map(rusqlite::params![entry_id], |row| {
            Ok(TagResponse {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

/// Fetch links for a given entry.
fn fetch_entry_links(
    conn: &rusqlite::Connection,
    entry_id: i64,
) -> Result<Vec<LinkResponse>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, url, label, created_at \
         FROM links WHERE parent_type = 'entry' AND parent_id = ?1 \
         ORDER BY created_at ASC",
    )?;
    let links = stmt
        .query_map(rusqlite::params![entry_id], |row| {
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

/// Fetch attachments for a given entry.
fn fetch_entry_attachments(
    conn: &rusqlite::Connection,
    entry_id: i64,
) -> Result<Vec<AttachmentResponse>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_type, parent_id, filename, original_name, file_size, mime_type, created_at \
         FROM attachments WHERE parent_type = 'entry' AND parent_id = ?1 \
         ORDER BY created_at ASC",
    )?;
    let attachments = stmt
        .query_map(rusqlite::params![entry_id], |row| {
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

/// Convert a row from the ENTRY_SELECT query into an EntryResponse (without links/attachments).
///
/// Exposed at crate visibility so other route modules that build on ENTRY_SELECT
/// can decode rows without duplicating the column mapping.
pub(crate) fn entry_row_to_response_basic(row: &rusqlite::Row) -> EntryResponse {
    EntryResponse {
        id: row.get(0).unwrap_or(0),
        created_at: row.get(1).unwrap_or_default(),
        updated_at: row.get(2).unwrap_or_default(),
        entry_date: row.get(3).unwrap_or_default(),
        entry_type: row.get(4).unwrap_or_default(),
        work_type: row.get(5).unwrap_or_default(),
        title: row.get(6).unwrap_or_default(),
        description: row.get(7).unwrap_or(None),
        impact: row.get(8).unwrap_or(None),
        metrics: row.get(9).unwrap_or(None),
        project_id: row.get(10).unwrap_or(None),
        status: row.get(11).unwrap_or_default(),
        visibility: row.get(12).unwrap_or_default(),
        is_accomplishment: row.get(13).unwrap_or(0),
        is_lesson_learned: row.get(14).unwrap_or(0),
        is_weekly_highlight: row.get(15).unwrap_or(0),
        project_name: row.get(16).unwrap_or(None),
        program_id: row.get(17).unwrap_or(None),
        scheduled_item_id: row.get(18).unwrap_or(None),
        program_name: row.get(19).unwrap_or(None),
        is_pinned: row.get(20).unwrap_or(0),
        outcome: row.get(21).unwrap_or(None),
        tags: vec![],
        links: vec![],
        attachments: vec![],
    }
}

/// Fetch a complete entry response by ID (with tags, no links/attachments).
/// Used for create/update/toggle responses matching Python behavior.
fn fetch_entry_response(
    conn: &rusqlite::Connection,
    entry_id: i64,
) -> Result<EntryResponse, AppError> {
    let sql = format!("{} WHERE e.id = ?1", ENTRY_SELECT);
    let mut entry = conn.query_row(&sql, rusqlite::params![entry_id], |row| {
        Ok(entry_row_to_response_basic(row))
    })?;
    entry.tags = fetch_entry_tags(conn, entry_id)?;
    Ok(entry)
}

/// Fetch a complete entry response by ID (with tags, links, AND attachments).
/// Used for the get-by-ID endpoint.
fn fetch_entry_response_full(
    conn: &rusqlite::Connection,
    entry_id: i64,
) -> Result<EntryResponse, AppError> {
    let sql = format!("{} WHERE e.id = ?1", ENTRY_SELECT);
    let mut entry = conn
        .query_row(&sql, rusqlite::params![entry_id], |row| {
            Ok(entry_row_to_response_basic(row))
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Entry not found".to_string())
            }
            other => AppError::Database(other),
        })?;
    entry.tags = fetch_entry_tags(conn, entry_id)?;
    entry.links = fetch_entry_links(conn, entry_id)?;
    entry.attachments = fetch_entry_attachments(conn, entry_id)?;
    Ok(entry)
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use proptest::prelude::*;
    use rusqlite::Connection;

    /// **Validates: Requirements 2.3, 2.5, 3.4, 14.1**
    ///
    /// Property 1: Entity Round-Trip Preservation
    /// For any valid entry payload, creating it via the same SQL logic used by the handler
    /// and then retrieving it by ID SHALL return a response with identical field values
    /// for all non-computed fields.

    fn arb_entry_type() -> impl Strategy<Value = String> {
        prop::sample::select(vec![
            "quick_capture",
            "project_update",
            "operational_rhythm",
            "development",
            "recognition",
            "decision",
            "milestone",
            "action_item",
            "program_update",
        ])
        .prop_map(|s| s.to_string())
    }

    fn arb_work_type() -> impl Strategy<Value = String> {
        prop::sample::select(vec!["project", "operational_rhythm"]).prop_map(|s| s.to_string())
    }

    fn arb_status() -> impl Strategy<Value = String> {
        prop::sample::select(vec!["in_progress", "completed", "ongoing", "paused"])
            .prop_map(|s| s.to_string())
    }

    fn arb_visibility() -> impl Strategy<Value = String> {
        prop::sample::select(vec!["personal", "shareable"]).prop_map(|s| s.to_string())
    }

    fn arb_entry_date() -> impl Strategy<Value = String> {
        (2020u32..2030, 1u32..13, 1u32..29).prop_map(|(y, m, d)| format!("{:04}-{:02}-{:02}", y, m, d))
    }

    fn arb_optional_string() -> impl Strategy<Value = Option<String>> {
        prop::option::of("[a-zA-Z0-9 .,!?]{0,50}")
    }

    fn arb_bool_int() -> impl Strategy<Value = i64> {
        prop::sample::select(vec![0i64, 1])
    }

    fn arb_title() -> impl Strategy<Value = String> {
        "[a-zA-Z0-9 ]{1,50}"
    }

    /// Strategy that generates a valid CreateEntry payload (without project/program references
    /// since those would require FK setup).
    fn arb_create_entry() -> impl Strategy<Value = CreateEntry> {
        // Split into two tuples to stay within proptest's 12-element tuple limit
        let core_fields = (
            arb_entry_date(),
            arb_entry_type(),
            arb_work_type(),
            arb_title(),
            arb_optional_string(),
            arb_optional_string(),
            arb_optional_string(),
            arb_status(),
            arb_visibility(),
        );
        let flag_fields = (
            arb_bool_int(),
            arb_bool_int(),
            arb_bool_int(),
            arb_bool_int(),
            arb_optional_string(),
        );

        (core_fields, flag_fields).prop_map(
            |(
                (entry_date, entry_type, work_type, title, description, impact, metrics, status, visibility),
                (is_accomplishment, is_lesson_learned, is_weekly_highlight, is_pinned, outcome),
            )| {
                CreateEntry {
                    entry_date: Some(entry_date),
                    entry_type,
                    work_type,
                    title,
                    description,
                    impact,
                    metrics,
                    project_id: None,
                    program_id: None,
                    scheduled_item_id: None,
                    status,
                    visibility,
                    is_accomplishment,
                    is_lesson_learned,
                    is_weekly_highlight,
                    is_pinned,
                    outcome,
                    tag_ids: vec![],
                }
            },
        )
    }

    /// Helper: insert an entry using the same SQL logic as the create_entry handler,
    /// then retrieve it using fetch_entry_response.
    fn insert_and_fetch(conn: &Connection, body: &CreateEntry) -> EntryResponse {
        // The handler auto-infers work_type from project_id presence
        let work_type = if body.project_id.is_some() {
            "project"
        } else {
            "operational_rhythm"
        };

        let entry_date = body
            .entry_date
            .clone()
            .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());

        let entry_id: i64 = conn
            .query_row(
                "INSERT INTO entries (entry_date, entry_type, work_type, title,
                    description, impact, metrics, project_id, status, visibility,
                    is_accomplishment, is_lesson_learned, is_weekly_highlight,
                    program_id, scheduled_item_id, is_pinned, outcome)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
                    RETURNING id",
                rusqlite::params![
                    entry_date,
                    body.entry_type,
                    work_type,
                    body.title,
                    body.description,
                    body.impact,
                    body.metrics,
                    body.project_id,
                    body.status,
                    body.visibility,
                    body.is_accomplishment,
                    body.is_lesson_learned,
                    body.is_weekly_highlight,
                    body.program_id,
                    body.scheduled_item_id,
                    body.is_pinned,
                    body.outcome,
                ],
                |row| row.get::<_, i64>(0),
            )
            .expect("INSERT should succeed");

        fetch_entry_response(conn, entry_id).expect("fetch should succeed")
    }

    /// Set up an in-memory database with the full schema initialized.
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        /// Feature: rust-backend-rewrite, Property 1: Entity round-trip preservation
        ///
        /// For any valid entry payload, creating it and retrieving it by ID
        /// returns a response with identical non-computed field values.
        #[test]
        fn prop_entry_round_trip(entry in arb_create_entry()) {
            let conn = setup_test_db();
            let response = insert_and_fetch(&conn, &entry);

            // The handler overrides work_type based on project_id
            let expected_work_type = if entry.project_id.is_some() {
                "project".to_string()
            } else {
                "operational_rhythm".to_string()
            };

            // Verify all non-computed fields match
            prop_assert_eq!(&response.entry_date, entry.entry_date.as_ref().unwrap());
            prop_assert_eq!(&response.entry_type, &entry.entry_type);
            prop_assert_eq!(&response.work_type, &expected_work_type);
            prop_assert_eq!(&response.title, &entry.title);
            prop_assert_eq!(&response.description, &entry.description);
            prop_assert_eq!(&response.impact, &entry.impact);
            prop_assert_eq!(&response.metrics, &entry.metrics);
            prop_assert_eq!(&response.status, &entry.status);
            prop_assert_eq!(&response.visibility, &entry.visibility);
            prop_assert_eq!(response.is_accomplishment, entry.is_accomplishment);
            prop_assert_eq!(response.is_lesson_learned, entry.is_lesson_learned);
            prop_assert_eq!(response.is_weekly_highlight, entry.is_weekly_highlight);
            prop_assert_eq!(response.is_pinned, entry.is_pinned);
            prop_assert_eq!(&response.outcome, &entry.outcome);
            prop_assert_eq!(response.project_id, entry.project_id);
            prop_assert_eq!(response.program_id, entry.program_id);
            prop_assert_eq!(response.scheduled_item_id, entry.scheduled_item_id);
        }
    }
}
