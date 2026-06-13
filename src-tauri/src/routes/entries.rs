//! Entry routes: full CRUD plus toggle/highlight operations.
//!
//! Implements routes matching the lean v3.1 schema (no impact, work_type,
//! metrics, outcome, is_lesson_learned, links, or attachments on entries).

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
use crate::models::entry::{CreateEntry, EntryResponse, TagResponse, UpdateEntry};

/// Query parameters for the list entries endpoint.
#[derive(Debug, Deserialize)]
pub struct EntryFilters {
    pub date_start: Option<String>,
    pub date_end: Option<String>,
    pub program_id: Option<i64>,
    pub project_id: Option<i64>,
    pub entry_type: Option<String>,
    pub tag_ids: Option<String>,
    pub status: Option<String>,
    pub visibility: Option<String>,
    pub search: Option<String>,
    pub is_pinned: Option<i64>,
}

/// Build the entries sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/entries", get(list_entries))
        .route("/api/entries/:id", get(get_entry))
        .route("/api/entries/:id", put(update_entry))
        .route("/api/entries/:id", delete(delete_entry))
        .route("/api/entries/:id/pin", patch(toggle_pin))
        .route("/api/entries/:id/highlight", put(set_highlight))
        .route("/api/entries/:id/accomplishment", put(toggle_accomplishment))
        .with_state(state)
}

// ─── SQL Constants ──────────────────────────────────────────────────────────

/// Base SELECT for entries with joined project and program names.
///
/// Exposed at crate visibility so other route modules (e.g., dashboard) can
/// append their own WHERE / ORDER BY / LIMIT clauses without duplicating the
/// column list or join shape.
pub(crate) const ENTRY_SELECT: &str = r#"
    SELECT e.id, e.created_at, e.updated_at, e.entry_date, e.entry_type,
           e.title, e.description,
           e.project_id, e.status, e.visibility,
           e.is_accomplishment, e.is_weekly_highlight,
           p.name, e.program_id, e.scheduled_item_id, prog.name,
           e.is_pinned
    FROM entries e
    LEFT JOIN projects p ON e.project_id = p.id
    LEFT JOIN programs prog ON e.program_id = prog.id
"#;

// ─── Handlers ───────────────────────────────────────────────────────────────

/// POST /api/entries — create a new entry with tag associations.
#[allow(dead_code)]
async fn create_entry(
    State(state): State<SharedState>,
    Json(body): Json<CreateEntry>,
) -> Result<(StatusCode, Json<EntryResponse>), AppError> {
    let conn = state.pool.get()?;

    // Default entry_date to today if not provided
    let entry_date = body
        .entry_date
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string());

    let entry_id = conn.query_row(
        "INSERT INTO entries (entry_date, entry_type, title,
            description, project_id, status, visibility,
            is_accomplishment, is_weekly_highlight,
            program_id, scheduled_item_id, is_pinned)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            RETURNING id",
        rusqlite::params![
            entry_date,
            body.entry_type,
            body.title,
            body.description,
            body.project_id,
            body.status,
            body.visibility,
            body.is_accomplishment,
            body.is_weekly_highlight,
            body.program_id,
            body.scheduled_item_id,
            body.is_pinned,
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

/// GET /api/entries — list entries with optional filters.
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

/// GET /api/entries/:id — get a single entry with tags.
async fn get_entry(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<EntryResponse>, AppError> {
    let conn = state.pool.get()?;
    let response = fetch_entry_response_full(&conn, id)?;
    Ok(Json(response))
}

/// PUT /api/entries/:id — update entry fields.
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
    add_field!(body.title, "title");
    add_nullable_field!(body.description, "description");
    add_field_i64!(body.project_id, "project_id");
    add_field_i64!(body.program_id, "program_id");
    add_field_i64!(body.scheduled_item_id, "scheduled_item_id");
    add_field!(body.status, "status");
    add_field!(body.visibility, "visibility");
    add_field_i64!(body.is_accomplishment, "is_accomplishment");
    add_field_i64!(body.is_weekly_highlight, "is_weekly_highlight");
    add_field_i64!(body.is_pinned, "is_pinned");

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

/// DELETE /api/entries/:id — delete an entry (CASCADE handles entry_tags).
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

    // entry_tags has ON DELETE CASCADE — handled by FK
    conn.execute("DELETE FROM entries WHERE id = ?1", rusqlite::params![id])?;

    Ok(StatusCode::NO_CONTENT)
}

/// PATCH /api/entries/:id/pin — toggle is_pinned (0↔1).
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

/// PUT /api/entries/:id/highlight — set is_weekly_highlight=1 with week-boundary logic.
///
/// Finds the Sun–Sat week boundary for the entry's entry_date, then sets
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

/// PUT /api/entries/:id/accomplishment — toggle is_accomplishment (0↔1).
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

// ─── Helper Functions ───────────────────────────────────────────────────────

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

/// Convert a row from the ENTRY_SELECT query into an EntryResponse.
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
        title: row.get(5).unwrap_or_default(),
        description: row.get(6).unwrap_or(None),
        project_id: row.get(7).unwrap_or(None),
        status: row.get(8).unwrap_or_default(),
        visibility: row.get(9).unwrap_or_default(),
        is_accomplishment: row.get(10).unwrap_or(0),
        is_weekly_highlight: row.get(11).unwrap_or(0),
        project_name: row.get(12).unwrap_or(None),
        program_id: row.get(13).unwrap_or(None),
        scheduled_item_id: row.get(14).unwrap_or(None),
        program_name: row.get(15).unwrap_or(None),
        is_pinned: row.get(16).unwrap_or(0),
        tags: vec![],
    }
}

/// Fetch a complete entry response by ID (with tags).
/// Used for create/update/toggle responses.
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

/// Fetch a complete entry response by ID (with tags).
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
    Ok(entry)
}

#[cfg(test)]
#[path = "entries_test.rs"]
mod entries_test;
