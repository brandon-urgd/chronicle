//! Scheduled item routes: full CRUD plus instance management.
//!
//! Implements ~12 routes matching the Python FastAPI backend for scheduled items
//! and their instances (tasks and cadences).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{CompleteRequest, DueTodayResponse, SkipRequest};
use crate::models::scheduled::{
    CreateScheduledItem, ScheduledInstanceResponse, ScheduledItemResponse, UpdateScheduledItem,
};

/// Maximum length for the `reason` field on the skip endpoint.
const SKIP_REASON_MAX_LEN: usize = 500;

/// Query parameters for the list scheduled items endpoint.
#[derive(Debug, Deserialize)]
pub struct ScheduledItemFilters {
    pub status: Option<String>,
    pub program_id: Option<i64>,
    pub project_id: Option<i64>,
    pub item_class: Option<String>,
    pub mode: Option<String>,
}

/// Query parameters for the bulk instances endpoint
/// (`GET /api/scheduled-items/instances`). All filters are optional and
/// combine with AND semantics.
#[derive(Debug, Deserialize)]
pub struct InstanceFilters {
    pub status: Option<String>,
    pub due_date_start: Option<String>,
    pub due_date_end: Option<String>,
    pub scheduled_item_id: Option<i64>,
}

/// Query parameters for the per-item instances endpoint
/// (`GET /api/scheduled-items/:id/instances`). Both filters are optional.
///
/// `limit` caps the number of returned rows; defaults to 50 when absent.
#[derive(Debug, Deserialize)]
pub struct ItemInstanceFilters {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

/// Request body for updating an instance (reschedule, complete, skip, etc.).
#[derive(Debug, Deserialize)]
pub struct UpdateInstanceBody {
    pub status: Option<String>,
    pub notes: Option<String>,
    pub skip_reason: Option<String>,
    pub resolved_at: Option<String>,
    pub due_date: Option<String>,
}

/// Response for the complete endpoint.
#[derive(Debug, Serialize)]
pub struct CompleteResponse {
    pub occurrence: Option<serde_json::Value>,
    pub entry: Option<serde_json::Value>,
}

/// Build the scheduled items sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        // Static path routes MUST come before /{id} to avoid path conflicts
        .route("/api/scheduled-items/due", get(get_due_today))
        .route("/api/scheduled-items/instances", get(list_instances))
        .route("/api/scheduled-items", post(create_scheduled_item))
        .route("/api/scheduled-items", get(list_scheduled_items))
        .route("/api/scheduled-items/:id", get(get_scheduled_item))
        .route("/api/scheduled-items/:id", put(update_scheduled_item))
        .route("/api/scheduled-items/:id", delete(delete_scheduled_item))
        .route(
            "/api/scheduled-items/:id/instances/:instance_id",
            put(update_instance),
        )
        .route(
            "/api/scheduled-items/:id/instances/regenerate",
            post(regenerate_instances),
        )
        .route(
            "/api/scheduled-items/:id/instances",
            get(list_item_instances),
        )
        .route(
            "/api/scheduled-items/:id/complete",
            post(complete_scheduled_item),
        )
        .route(
            "/api/scheduled-items/:id/skip",
            post(skip_scheduled_item),
        )
        .with_state(state)
}

// â”€â”€â”€ SQL Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Base SELECT for scheduled items with LEFT JOIN to programs and projects.
const SCHEDULED_ITEM_SELECT: &str = "\
    SELECT si.id, si.created_at, si.updated_at, si.name, si.description, \
           si.mode, si.due_date, si.recurrence_type, si.day_of_week, si.day_of_month, \
           si.month_of_year, si.time_of_day, si.day_range_start, si.day_range_end, \
           si.program_id, si.project_id, \
           si.template_entry_type, si.template_work_type, si.template_tags, \
           si.template_visibility, si.quick_complete, si.status, si.sort_order, \
           si.item_class, si.show_on_today, si.require_acknowledgment, \
           prog.name, proj.name \
    FROM scheduled_items si \
    LEFT JOIN programs prog ON si.program_id = prog.id \
    LEFT JOIN projects proj ON si.project_id = proj.id";

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// POST /api/scheduled-items â€” create a new scheduled item.
async fn create_scheduled_item(
    State(state): State<SharedState>,
    Json(body): Json<CreateScheduledItem>,
) -> Result<(StatusCode, Json<ScheduledItemResponse>), AppError> {
    let conn = state.pool.get()?;

    // Infer item_class from mode if not explicitly provided
    let item_class = body.item_class.clone().unwrap_or_else(|| {
        if body.mode == "one_time" {
            "task".to_string()
        } else {
            "cadence".to_string()
        }
    });

    // v3.0: Inherit program_id from project if not explicitly set
    let effective_program_id = if body.program_id.is_some() {
        body.program_id
    } else if let Some(project_id) = body.project_id {
        conn.query_row(
            "SELECT program_id FROM projects WHERE id = ?1",
            rusqlite::params![project_id],
            |row| row.get::<_, Option<i64>>(0),
        ).unwrap_or(None)
    } else {
        None
    };

    // For recurring items, default due_date to today if not provided
    let effective_due_date = if body.mode == "recurring" && body.due_date.is_none() {
        Some(chrono::Local::now().format("%Y-%m-%d").to_string())
    } else {
        body.due_date.clone()
    };

    let item_id = conn.query_row(
        "INSERT INTO scheduled_items (name, description, mode, due_date, \
         recurrence_type, day_of_week, day_of_month, month_of_year, \
         time_of_day, day_range_start, day_range_end, \
         program_id, project_id, \
         template_entry_type, template_work_type, template_tags, \
         template_visibility, quick_complete, sort_order, item_class, \
         require_acknowledgment) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21) \
         RETURNING id",
        rusqlite::params![
            body.name,
            body.description,
            body.mode,
            effective_due_date,
            body.recurrence_type,
            body.day_of_week,
            body.day_of_month,
            body.month_of_year,
            body.time_of_day,
            body.day_range_start,
            body.day_range_end,
            effective_program_id,
            body.project_id,
            body.template_entry_type,
            body.template_work_type,
            body.template_tags,
            body.template_visibility,
            body.quick_complete,
            body.sort_order,
            item_class,
            body.require_acknowledgment,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    // Auto-create single instance for one-time items with a due_date
    if body.mode == "one_time" {
        if let Some(ref due_date) = body.due_date {
            conn.execute(
                "INSERT OR IGNORE INTO scheduled_item_instances \
                 (scheduled_item_id, due_date, due_time, status) \
                 VALUES (?1, ?2, ?3, 'pending')",
                rusqlite::params![item_id, due_date, body.time_of_day],
            )?;
        }
    }

    // For recurring items, generate pending instances within the lookahead window
    if body.mode == "recurring" {
        let _ = crate::engines::scheduled::generate_pending_instances_for_item(
            &conn, item_id, REGENERATE_LOOKAHEAD_DAYS,
        );
    }

    // v3.0: Auto-complete flow — create item + immediately complete in one operation.
    // Used by CaptureSheet "Log" mode to create-and-complete in a single request.
    if body.auto_complete && item_class == "task" {
        let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
        let entry_date = body.due_date.as_deref().unwrap_or(&today_str);

        // Ensure an instance exists for this date
        conn.execute(
            "INSERT OR IGNORE INTO scheduled_item_instances \
             (scheduled_item_id, due_date, status) VALUES (?1, ?2, 'pending')",
            rusqlite::params![item_id, entry_date],
        )?;

        // Determine entry_type
        let effective_entry_type = if let Some(ref details) = body.completion_details {
            details.entry_type.clone().unwrap_or_else(|| {
                if body.project_id.is_some() { "project_update".to_string() }
                else { "operational_rhythm".to_string() }
            })
        } else if body.project_id.is_some() {
            "project_update".to_string()
        } else {
            "operational_rhythm".to_string()
        };

        let visibility = body.completion_details.as_ref()
            .and_then(|d| d.visibility.as_deref())
            .unwrap_or(&body.template_visibility);
        let description = body.completion_details.as_ref()
            .and_then(|d| d.description.as_deref());
        let impact = body.completion_details.as_ref()
            .and_then(|d| d.impact.as_deref());
        let metrics = body.completion_details.as_ref()
            .and_then(|d| d.metrics.as_deref());

        // Create the entry
        let entry_id: i64 = conn.query_row(
            "INSERT INTO entries (entry_date, entry_type, work_type, title, \
             description, impact, metrics, project_id, status, visibility, \
             is_accomplishment, is_lesson_learned, is_weekly_highlight, \
             program_id, scheduled_item_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'completed', ?9, 0, 0, 0, ?10, ?11) \
             RETURNING id",
            rusqlite::params![
                entry_date,
                effective_entry_type,
                body.template_work_type,
                body.name,
                description,
                impact,
                metrics,
                body.project_id,
                visibility,
                effective_program_id,
                item_id,
            ],
            |row| row.get::<_, i64>(0),
        )?;

        // Mark instance as completed
        let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        conn.execute(
            "UPDATE scheduled_item_instances SET status = 'completed', \
             resolved_at = ?1, entry_id = ?2 \
             WHERE scheduled_item_id = ?3 AND due_date = ?4 AND status = 'pending'",
            rusqlite::params![now, entry_id, item_id, entry_date],
        )?;

        // Mark item as completed (one-time task)
        conn.execute(
            "UPDATE scheduled_items SET status = 'completed', updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, item_id],
        )?;
    }

    let response = fetch_scheduled_item_response(&conn, item_id)?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// GET /api/scheduled-items â€” list all scheduled items with optional filters.
async fn list_scheduled_items(
    State(state): State<SharedState>,
    Query(filters): Query<ScheduledItemFilters>,
) -> Result<Json<Vec<ScheduledItemResponse>>, AppError> {
    let conn = state.pool.get()?;

    let mut sql = format!("{} WHERE 1=1", SCHEDULED_ITEM_SELECT);
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = filters.status {
        sql.push_str(" AND si.status = ?");
        params.push(Box::new(status.clone()));
    }
    if let Some(ref program_id) = filters.program_id {
        sql.push_str(" AND si.program_id = ?");
        params.push(Box::new(*program_id));
    }
    if let Some(ref project_id) = filters.project_id {
        sql.push_str(" AND si.project_id = ?");
        params.push(Box::new(*project_id));
    }
    if let Some(ref item_class) = filters.item_class {
        sql.push_str(" AND si.item_class = ?");
        params.push(Box::new(item_class.clone()));
    }
    if let Some(ref mode) = filters.mode {
        sql.push_str(" AND si.mode = ?");
        params.push(Box::new(mode.clone()));
    }

    sql.push_str(" ORDER BY si.sort_order ASC, si.created_at DESC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(scheduled_item_row_to_response(row))
    })?;

    let mut items: Vec<ScheduledItemResponse> = Vec::new();
    for row_result in rows {
        let mut item = row_result?;
        // Fetch pending/recent instances for each item
        item.instances = fetch_item_instances(&conn, item.id, 10)?;
        items.push(item);
    }

    Ok(Json(items))
}

/// GET /api/scheduled-items/:id â€” get a single scheduled item with instances.
async fn get_scheduled_item(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<ScheduledItemResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut item = fetch_scheduled_item_response(&conn, id)?;

    // Fetch recent instances (last 30)
    item.instances = fetch_item_instances(&conn, id, 30)?;

    Ok(Json(item))
}

/// PUT /api/scheduled-items/:id â€” update scheduled item fields (dynamic partial update).
async fn update_scheduled_item(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<UpdateScheduledItem>,
) -> Result<Json<ScheduledItemResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify item exists and get current state
    let (old_due_date, old_mode, old_time): (Option<String>, String, Option<String>) = conn
        .query_row(
            "SELECT due_date, mode, time_of_day FROM scheduled_items WHERE id = ?1",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Scheduled item not found".to_string())
            }
            other => AppError::Database(other),
        })?;

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

    // For FK fields: 0 means "set to NULL" (clear the association)
    macro_rules! add_fk_field {
        ($field:expr, $name:literal) => {
            if let Some(val) = $field {
                set_clauses.push(format!("{} = ?", $name));
                if val == 0 {
                    values.push(Box::new(rusqlite::types::Null));
                } else {
                    values.push(Box::new(val));
                }
            }
        };
    }

    add_field!(body.name, "name");
    add_nullable_field!(body.description, "description");
    add_field!(body.mode, "mode");
    add_field!(body.due_date, "due_date");
    add_field!(body.recurrence_type, "recurrence_type");
    add_field_i64!(body.day_of_week, "day_of_week");
    add_field_i64!(body.day_of_month, "day_of_month");
    add_field_i64!(body.month_of_year, "month_of_year");
    add_field!(body.time_of_day, "time_of_day");
    add_field_i64!(body.day_range_start, "day_range_start");
    add_field_i64!(body.day_range_end, "day_range_end");
    add_fk_field!(body.program_id, "program_id");
    add_fk_field!(body.project_id, "project_id");
    add_field!(body.template_entry_type, "template_entry_type");
    add_field!(body.template_work_type, "template_work_type");
    add_field!(body.template_tags, "template_tags");
    add_field!(body.template_visibility, "template_visibility");
    add_field_i64!(body.quick_complete, "quick_complete");
    add_field!(body.status, "status");
    add_field_i64!(body.sort_order, "sort_order");
    add_field!(body.item_class, "item_class");
    add_field_i64!(body.show_on_today, "show_on_today");
    add_field_i64!(body.require_acknowledgment, "require_acknowledgment");

    if !set_clauses.is_empty() {
        set_clauses.push("updated_at = datetime('now')".to_string());
        values.push(Box::new(id));

        let sql = format!(
            "UPDATE scheduled_items SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;

        // Sync pending instances when due_date changes on a one-time task
        let new_due_date = body.due_date.as_ref().or(old_due_date.as_ref());
        let updated_mode = body.mode.as_deref().unwrap_or(&old_mode);
        let updated_time = body.time_of_day.as_ref().or(old_time.as_ref());

        if updated_mode == "one_time" {
            if let Some(due_date) = new_due_date {
                // Update existing pending instances to the new date
                conn.execute(
                    "UPDATE scheduled_item_instances \
                     SET due_date = ?1, due_time = ?2 \
                     WHERE scheduled_item_id = ?3 AND status = 'pending'",
                    rusqlite::params![due_date, updated_time, id],
                )?;
                // If no pending instance existed, create one
                conn.execute(
                    "INSERT OR IGNORE INTO scheduled_item_instances \
                     (scheduled_item_id, due_date, due_time, status) \
                     VALUES (?1, ?2, ?3, 'pending')",
                    rusqlite::params![id, due_date, updated_time],
                )?;
            } else {
                // Task has no due_date â†’ remove pending instances
                conn.execute(
                    "DELETE FROM scheduled_item_instances \
                     WHERE scheduled_item_id = ?1 AND status = 'pending'",
                    rusqlite::params![id],
                )?;
            }
        }
    }

    let response = fetch_scheduled_item_response(&conn, id)?;
    Ok(Json(response))
}

/// DELETE /api/scheduled-items/:id â€” delete a scheduled item (CASCADE handles instances).
async fn delete_scheduled_item(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let conn = state.pool.get()?;

    // Verify item exists
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM scheduled_items WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Scheduled item not found".to_string()));
    }

    // scheduled_item_instances has ON DELETE CASCADE â€” handled by FK
    conn.execute(
        "DELETE FROM scheduled_items WHERE id = ?1",
        rusqlite::params![id],
    )?;

    Ok(StatusCode::NO_CONTENT)
}


/// GET /api/scheduled-items/due â€” list due/overdue instances for today.
async fn get_due_today(
    State(state): State<SharedState>,
) -> Result<Json<DueTodayResponse>, AppError> {
    let conn = state.pool.get()?;

    // Ensure pending instances are generated for the current window.
    // This is idempotent (INSERT OR IGNORE) and covers cadences created
    // before the v2.5.1 fix that generates instances at creation time.
    let _ = crate::engines::scheduled::generate_pending_instances(&conn, 14);

    // Backfill: ensure one-time tasks with a due_date have their instance.
    let _ = conn.execute(
        "INSERT OR IGNORE INTO scheduled_item_instances (scheduled_item_id, due_date, due_time, status) \
         SELECT id, due_date, time_of_day, 'pending' FROM scheduled_items \
         WHERE mode = 'one_time' AND status = 'active' AND due_date IS NOT NULL",
        [],
    );

    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Query pending instances due today or overdue, filtered to show_on_today items
    let mut stmt = conn.prepare(
        "SELECT sii.id, sii.scheduled_item_id, sii.due_date, sii.due_time, \
                sii.status, sii.resolved_at, sii.notes, sii.skip_reason, sii.entry_id, \
                si.name, si.program_id, prog.name, si.quick_complete, \
                si.template_entry_type, si.template_work_type, si.project_id, \
                si.item_class, si.recurrence_type, proj.name, si.require_acknowledgment \
         FROM scheduled_item_instances sii \
         JOIN scheduled_items si ON sii.scheduled_item_id = si.id \
         LEFT JOIN programs prog ON si.program_id = prog.id \
         LEFT JOIN projects proj ON si.project_id = proj.id \
         WHERE sii.status = 'pending' AND sii.due_date <= ?1 \
           AND (si.item_class = 'task' OR (si.item_class = 'cadence' AND si.show_on_today = 1)) \
         ORDER BY sii.due_date ASC, sii.due_time ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![&today_str], |row| {
        Ok(DueInstanceRow {
            instance_id: row.get(0)?,
            scheduled_item_id: row.get(1)?,
            due_date: row.get(2)?,
            due_time: row.get(3)?,
            _status: row.get(4)?,
            name: row.get(9)?,
            program_id: row.get(10)?,
            program_name: row.get(11)?,
            quick_complete: row.get(12)?,
            template_entry_type: row.get(13)?,
            template_work_type: row.get(14)?,
            project_id: row.get(15)?,
            item_class: row.get(16)?,
            recurrence_type: row.get(17)?,
            project_name: row.get(18)?,
            require_acknowledgment: row.get(19)?,
        })
    })?;

    let mut today_items: Vec<serde_json::Value> = Vec::new();
    let mut overdue_items: Vec<serde_json::Value> = Vec::new();

    for row_result in rows {
        let r = row_result?;
        let item_dict = serde_json::json!({
            "instance_id": r.instance_id,
            "scheduled_item_id": r.scheduled_item_id,
            "due_date": r.due_date,
            "due_time": r.due_time,
            "status": "pending",
            "name": r.name,
            "program_id": r.program_id,
            "program_name": r.program_name,
            "quick_complete": r.quick_complete,
            "template_entry_type": r.template_entry_type,
            "template_work_type": r.template_work_type,
            "project_id": r.project_id,
            "item_class": r.item_class,
            "recurrence_type": r.recurrence_type,
            "project_name": r.project_name,
            "require_acknowledgment": r.require_acknowledgment,
        });

        if r.due_date == today_str {
            today_items.push(item_dict);
        } else {
            overdue_items.push(item_dict);
        }
    }

    // Counts for today
    let mut count_stmt = conn.prepare(
        "SELECT sii.status, COUNT(*) \
         FROM scheduled_item_instances sii \
         WHERE sii.due_date = ?1 \
         GROUP BY sii.status",
    )?;
    let count_rows = count_stmt.query_map(rusqlite::params![&today_str], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    let mut completed_today: i64 = 0;
    let mut pending_today: i64 = 0;
    let mut skipped_today: i64 = 0;

    for count_result in count_rows {
        if let Ok((status, count)) = count_result {
            match status.as_str() {
                "completed" => completed_today = count,
                "pending" => pending_today = count,
                "skipped" => skipped_today = count,
                _ => {}
            }
        }
    }

    Ok(Json(DueTodayResponse {
        today: today_items,
        overdue: overdue_items,
        completed_today,
        pending_today,
        skipped_today,
    }))
}

/// GET /api/scheduled-items/instances — bulk list of instances across items.
///
/// Query params (all optional, AND-combined):
///   - `status`: filter by exact instance status (e.g. `pending`, `completed`).
///   - `due_date_start`: include instances with `due_date >= this date`.
///   - `due_date_end`: include instances with `due_date <= this date`.
///   - `scheduled_item_id`: scope to a single parent item.
///
/// Joins to `scheduled_items` (and `programs` / `projects`) so each returned
/// row carries the parent's name, program, project, recurrence_type, item_class,
/// and require_acknowledgment for the frontend's upcoming-view rendering.
///
/// Results are ordered by `due_date ASC, due_time ASC NULLS LAST` so missing
/// times sort after timed occurrences within the same day.
async fn list_instances(
    State(state): State<SharedState>,
    Query(filters): Query<InstanceFilters>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let conn = state.pool.get()?;

    // Ensure pending instances are generated for the current window.
    // This is idempotent (INSERT OR IGNORE) and covers the Upcoming section
    // which queries future instances that may not have been seeded yet.
    let _ = crate::engines::scheduled::generate_pending_instances(&conn, 14);

    // Backfill: ensure one-time tasks with a due_date have their instance.
    // Covers tasks created before v2.5.1 that never got an instance row.
    let _ = conn.execute(
        "INSERT OR IGNORE INTO scheduled_item_instances (scheduled_item_id, due_date, due_time, status) \
         SELECT id, due_date, time_of_day, 'pending' FROM scheduled_items \
         WHERE mode = 'one_time' AND status = 'active' AND due_date IS NOT NULL",
        [],
    );

    let mut sql = String::from(
        "SELECT sii.id, sii.scheduled_item_id, sii.created_at, sii.due_date, sii.due_time, \
                sii.status, sii.resolved_at, sii.notes, sii.skip_reason, sii.entry_id, \
                si.name, si.program_id, si.project_id, si.recurrence_type, si.item_class, \
                si.require_acknowledgment, prog.name, proj.name \
         FROM scheduled_item_instances sii \
         JOIN scheduled_items si ON sii.scheduled_item_id = si.id \
         LEFT JOIN programs prog ON si.program_id = prog.id \
         LEFT JOIN projects proj ON si.project_id = proj.id \
         WHERE 1=1",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = filters.status {
        sql.push_str(" AND sii.status = ?");
        params.push(Box::new(status.clone()));
    }
    if let Some(ref start) = filters.due_date_start {
        sql.push_str(" AND sii.due_date >= ?");
        params.push(Box::new(start.clone()));
    }
    if let Some(ref end) = filters.due_date_end {
        sql.push_str(" AND sii.due_date <= ?");
        params.push(Box::new(end.clone()));
    }
    if let Some(item_id) = filters.scheduled_item_id {
        sql.push_str(" AND sii.scheduled_item_id = ?");
        params.push(Box::new(item_id));
    }

    // SQLite sorts NULLs first by default on ASC; `due_time IS NULL` as a
    // secondary key puts rows with NULL due_time *after* timed rows on the
    // same date, matching the "NULLS LAST" semantic the design calls for.
    sql.push_str(" ORDER BY sii.due_date ASC, sii.due_time IS NULL, sii.due_time ASC");

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "scheduled_item_id": row.get::<_, i64>(1)?,
            "created_at": row.get::<_, String>(2)?,
            "due_date": row.get::<_, String>(3)?,
            "due_time": row.get::<_, Option<String>>(4)?,
            "status": row.get::<_, String>(5)?,
            "resolved_at": row.get::<_, Option<String>>(6)?,
            "notes": row.get::<_, Option<String>>(7)?,
            "skip_reason": row.get::<_, Option<String>>(8)?,
            "entry_id": row.get::<_, Option<i64>>(9)?,
            "name": row.get::<_, String>(10)?,
            "program_id": row.get::<_, Option<i64>>(11)?,
            "project_id": row.get::<_, Option<i64>>(12)?,
            "recurrence_type": row.get::<_, Option<String>>(13)?,
            "item_class": row.get::<_, String>(14)?,
            "require_acknowledgment": row.get::<_, i64>(15)?,
            "program_name": row.get::<_, Option<String>>(16)?,
            "project_name": row.get::<_, Option<String>>(17)?,
        }))
    })?;

    let instances: Vec<serde_json::Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(instances))
}

/// GET /api/scheduled-items/:id/instances — list instances for a single scheduled item.
///
/// Query params (both optional, AND-combined):
///   - `status`: filter by exact instance status (e.g. `pending`, `completed`, `skipped`).
///   - `limit`:  cap the number of returned rows; defaults to 50.
///
/// Unlike the bulk `/api/scheduled-items/instances` endpoint, this route is
/// scoped to a single parent item so it returns the canonical
/// `ScheduledInstanceResponse` shape without joined parent fields — the caller
/// already knows which scheduled item they asked about.
///
/// Results are ordered by `due_date ASC, due_time IS NULL, due_time ASC` so
/// rows without a `due_time` sort after timed rows on the same date,
/// matching the bulk endpoint's "NULLS LAST" semantic.
async fn list_item_instances(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Query(filters): Query<ItemInstanceFilters>,
) -> Result<Json<Vec<ScheduledInstanceResponse>>, AppError> {
    let conn = state.pool.get()?;

    let limit = filters.limit.unwrap_or(50);

    let mut sql = String::from(
        "SELECT id, scheduled_item_id, created_at, due_date, due_time, status, \
                resolved_at, notes, skip_reason, entry_id \
         FROM scheduled_item_instances \
         WHERE scheduled_item_id = ?",
    );
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    params.push(Box::new(id));

    if let Some(ref status) = filters.status {
        sql.push_str(" AND status = ?");
        params.push(Box::new(status.clone()));
    }

    sql.push_str(" ORDER BY due_date ASC, due_time IS NULL, due_time ASC LIMIT ?");
    params.push(Box::new(limit));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(ScheduledInstanceResponse {
            id: row.get(0)?,
            scheduled_item_id: row.get(1)?,
            created_at: row.get(2)?,
            due_date: row.get(3)?,
            due_time: row.get(4)?,
            status: row.get(5)?,
            resolved_at: row.get(6)?,
            notes: row.get(7)?,
            skip_reason: row.get(8)?,
            entry_id: row.get(9)?,
        })
    })?;

    let instances: Vec<ScheduledInstanceResponse> = rows.filter_map(|r| r.ok()).collect();
    Ok(Json(instances))
}

/// Default lookahead window (days) for regenerating pending instances.
///
/// Matches the lookahead used by the dashboard-driven generator so the regenerated set
/// lines up with what the rest of the app expects to see.
const REGENERATE_LOOKAHEAD_DAYS: i64 = 14;

/// Response body for `POST /api/scheduled-items/:id/instances/regenerate`.
///
/// `regenerated_count` is the number of fresh `pending` rows produced by the
/// regeneration. It is independent of how many rows were deleted beforehand —
/// callers that care about churn can compute `deleted = old_count - new_count`
/// against a prior list call if they need it.
#[derive(Debug, Serialize)]
pub struct RegenerateInstancesResponse {
    pub regenerated_count: i64,
}

/// POST /api/scheduled-items/:id/instances/regenerate — delete and rebuild pending instances.
///
/// Useful after a user edits a cadence schedule inline and wants the upcoming window to
/// reflect the new recurrence immediately without waiting for the next dashboard load.
///
/// Behavior:
/// - Verifies the scheduled item exists → 404 if not.
/// - Deletes all `status = 'pending'` instances for the item. Resolved rows (completed,
///   skipped, auto_completed) are preserved.
/// - Regenerates pending instances against the current cadence within the default
///   lookahead window (see `REGENERATE_LOOKAHEAD_DAYS`). One-time, paused, or otherwise
///   non-generating items simply produce a count of `0`.
/// - Returns `{ regenerated_count: N }` on success.
async fn regenerate_instances(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
) -> Result<Json<RegenerateInstancesResponse>, AppError> {
    let conn = state.pool.get()?;

    // Verify the scheduled item exists → 404 if not.
    let item_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM scheduled_items WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !item_exists {
        return Err(AppError::NotFound("Scheduled item not found".to_string()));
    }

    // Delegate to the engine helper: delete pending + regenerate within the window.
    let regenerated_count =
        crate::engines::scheduled::regenerate_instances_for_item(&conn, id, REGENERATE_LOOKAHEAD_DAYS)
            .map_err(|e| {
                // The engine returns anyhow::Result. Downcast to rusqlite::Error when possible
                // so failures surface as Database (500 "Database error"); otherwise Internal.
                match e.downcast::<rusqlite::Error>() {
                    Ok(db_err) => AppError::Database(db_err),
                    Err(other) => AppError::Internal(other.to_string()),
                }
            })?;

    Ok(Json(RegenerateInstancesResponse { regenerated_count }))
}

/// PUT /api/scheduled-items/:id/instances/:instance_id â€” update an instance.
async fn update_instance(
    State(state): State<SharedState>,
    Path((item_id, instance_id)): Path<(i64, i64)>,
    Json(body): Json<UpdateInstanceBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let conn = state.pool.get()?;

    // Verify instance exists and belongs to the item
    let exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM scheduled_item_instances \
             WHERE id = ?1 AND scheduled_item_id = ?2",
            rusqlite::params![instance_id, item_id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !exists {
        return Err(AppError::NotFound("Instance not found".to_string()));
    }

    // Build dynamic UPDATE for the instance
    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref status) = body.status {
        set_clauses.push("status = ?".to_string());
        values.push(Box::new(status.clone()));
    }
    if let Some(ref notes) = body.notes {
        set_clauses.push("notes = ?".to_string());
        values.push(Box::new(notes.clone()));
    }
    if let Some(ref skip_reason) = body.skip_reason {
        set_clauses.push("skip_reason = ?".to_string());
        values.push(Box::new(skip_reason.clone()));
    }
    if let Some(ref resolved_at) = body.resolved_at {
        set_clauses.push("resolved_at = ?".to_string());
        values.push(Box::new(resolved_at.clone()));
    }
    if let Some(ref due_date) = body.due_date {
        set_clauses.push("due_date = ?".to_string());
        values.push(Box::new(due_date.clone()));
    }

    if !set_clauses.is_empty() {
        values.push(Box::new(instance_id));
        let sql = format!(
            "UPDATE scheduled_item_instances SET {} WHERE id = ?",
            set_clauses.join(", ")
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
    }

    // Return the updated instance
    let instance = conn.query_row(
        "SELECT id, scheduled_item_id, created_at, due_date, due_time, status, \
                resolved_at, notes, skip_reason, entry_id \
         FROM scheduled_item_instances WHERE id = ?1",
        rusqlite::params![instance_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "scheduled_item_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_date": row.get::<_, String>(3)?,
                "due_time": row.get::<_, Option<String>>(4)?,
                "status": row.get::<_, String>(5)?,
                "resolved_at": row.get::<_, Option<String>>(6)?,
                "notes": row.get::<_, Option<String>>(7)?,
                "skip_reason": row.get::<_, Option<String>>(8)?,
                "entry_id": row.get::<_, Option<i64>>(9)?,
            }))
        },
    )?;

    Ok(Json(instance))
}


/// POST /api/scheduled-items/:id/complete â€” quick-complete a scheduled item.
async fn complete_scheduled_item(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<CompleteRequest>,
) -> Result<Json<CompleteResponse>, AppError> {
    let conn = state.pool.get()?;

    // 1. Get the scheduled item
    let item = conn
        .query_row(
            "SELECT id, name, mode, program_id, project_id, \
                    template_entry_type, template_work_type, template_tags, \
                    template_visibility, quick_complete \
             FROM scheduled_items WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(ScheduledItemRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    mode: row.get(2)?,
                    program_id: row.get(3)?,
                    project_id: row.get(4)?,
                    template_entry_type: row.get(5)?,
                    template_work_type: row.get(6)?,
                    template_tags: row.get(7)?,
                    template_visibility: row.get(8)?,
                    quick_complete: row.get(9)?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("Scheduled item not found".to_string())
            }
            other => AppError::Database(other),
        })?;

    // 2. Determine the due_date (use body.due_date or today)
    let today_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let entry_date = body.due_date.as_deref().unwrap_or(&today_str);

    // 3. Find or create an instance for this due_date (INSERT OR IGNORE)
    conn.execute(
        "INSERT OR IGNORE INTO scheduled_item_instances \
         (scheduled_item_id, due_date, status) \
         VALUES (?1, ?2, 'pending')",
        rusqlite::params![id, entry_date],
    )?;

    // Get the instance (whether just created or already existed)
    // Check ALL statuses first to detect already-resolved instances
    let (instance_id, instance_status): (Option<i64>, Option<String>) = conn
        .query_row(
            "SELECT id, status FROM scheduled_item_instances \
             WHERE scheduled_item_id = ?1 AND due_date = ?2",
            rusqlite::params![id, entry_date],
            |row| Ok((Some(row.get::<_, i64>(0)?), Some(row.get::<_, String>(1)?))),
        )
        .unwrap_or((None, None));

    // If instance is already resolved (completed, skipped, auto_completed), reject
    if let Some(ref status) = instance_status {
        if status != "pending" {
            return Err(AppError::Conflict("Instance is already resolved".to_string()));
        }
    }

    // 4. Create an entry from the template fields
    // Determine effective entry_type (project tasks get project_update)
    let effective_entry_type = if item.project_id.is_some()
        && ["operational_rhythm", "quick_capture", "action_item"]
            .contains(&item.template_entry_type.as_str())
    {
        "project_update".to_string()
    } else if item.project_id.is_none() && item.template_entry_type == "action_item" {
        "operational_rhythm".to_string()
    } else {
        item.template_entry_type.clone()
    };

    let entry_visibility = body
        .visibility
        .as_deref()
        .unwrap_or(&item.template_visibility);

    let entry_description = body.description.as_deref().or(body.notes.as_deref());

    let entry_id: i64 = conn.query_row(
        "INSERT INTO entries (entry_date, entry_type, work_type, title, \
         description, impact, metrics, project_id, status, visibility, \
         is_accomplishment, is_lesson_learned, is_weekly_highlight, \
         program_id, scheduled_item_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'completed', ?9, 0, 0, 0, ?10, ?11) \
         RETURNING id",
        rusqlite::params![
            entry_date,
            effective_entry_type,
            item.template_work_type,
            item.name,
            entry_description,
            body.impact,
            body.metrics,
            item.project_id,
            entry_visibility,
            item.program_id,
            id,
        ],
        |row| row.get::<_, i64>(0),
    )?;

    // Handle template_tags: parse comma-separated tag names, look up IDs, insert into entry_tags
    if let Some(ref template_tags) = item.template_tags {
        let tag_names: Vec<&str> = template_tags.split(',').map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
        for tag_name in tag_names {
            if let Ok(tag_id) = conn.query_row(
                "SELECT id FROM tags WHERE name = ?1",
                rusqlite::params![tag_name],
                |row| row.get::<_, i64>(0),
            ) {
                conn.execute(
                    "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?1, ?2)",
                    rusqlite::params![entry_id, tag_id],
                )?;
            }
        }
    }

    // 5. Mark instance as completed
    let mut occurrence: Option<serde_json::Value> = None;
    if let Some(inst_id) = instance_id {
        conn.execute(
            "UPDATE scheduled_item_instances \
             SET status = 'completed', entry_id = ?1, resolved_at = datetime('now', 'localtime'), notes = ?2 \
             WHERE id = ?3",
            rusqlite::params![entry_id, body.notes, inst_id],
        )?;

        // Fetch updated instance for response
        occurrence = conn
            .query_row(
                "SELECT id, scheduled_item_id, due_date, due_time, status, \
                        resolved_at, notes, skip_reason, entry_id \
                 FROM scheduled_item_instances WHERE id = ?1",
                rusqlite::params![inst_id],
                |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, i64>(0)?,
                        "scheduled_item_id": row.get::<_, i64>(1)?,
                        "due_date": row.get::<_, String>(2)?,
                        "due_time": row.get::<_, Option<String>>(3)?,
                        "status": row.get::<_, String>(4)?,
                        "resolved_at": row.get::<_, Option<String>>(5)?,
                        "notes": row.get::<_, Option<String>>(6)?,
                        "skip_reason": row.get::<_, Option<String>>(7)?,
                        "entry_id": row.get::<_, Option<i64>>(8)?,
                    }))
                },
            )
            .ok();
    }

    // 6. If one-time item, mark the scheduled_item as completed
    if item.mode == "one_time" {
        conn.execute(
            "UPDATE scheduled_items SET status = 'completed', updated_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )?;
    }

    // 7. Build entry response
    let entry = conn
        .query_row(
            "SELECT e.id, e.created_at, e.updated_at, e.entry_date, e.entry_type, \
                    e.work_type, e.title, e.description, e.impact, e.metrics, \
                    e.project_id, e.status, e.visibility, \
                    e.is_accomplishment, e.is_lesson_learned, e.is_weekly_highlight, \
                    e.is_pinned, e.outcome, e.program_id, e.scheduled_item_id \
             FROM entries e WHERE e.id = ?1",
            rusqlite::params![entry_id],
            |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "created_at": row.get::<_, String>(1)?,
                    "updated_at": row.get::<_, String>(2)?,
                    "entry_date": row.get::<_, String>(3)?,
                    "entry_type": row.get::<_, String>(4)?,
                    "work_type": row.get::<_, String>(5)?,
                    "title": row.get::<_, String>(6)?,
                    "description": row.get::<_, Option<String>>(7)?,
                    "impact": row.get::<_, Option<String>>(8)?,
                    "metrics": row.get::<_, Option<String>>(9)?,
                    "project_id": row.get::<_, Option<i64>>(10)?,
                    "status": row.get::<_, String>(11)?,
                    "visibility": row.get::<_, String>(12)?,
                    "is_accomplishment": row.get::<_, i64>(13)?,
                    "is_lesson_learned": row.get::<_, i64>(14)?,
                    "is_weekly_highlight": row.get::<_, i64>(15)?,
                    "is_pinned": row.get::<_, i64>(16)?,
                    "outcome": row.get::<_, Option<String>>(17)?,
                    "program_id": row.get::<_, Option<i64>>(18)?,
                    "scheduled_item_id": row.get::<_, Option<i64>>(19)?,
                }))
            },
        )
        .ok();

    Ok(Json(CompleteResponse {
        occurrence,
        entry,
    }))
}

/// POST /api/scheduled-items/:id/skip — skip a scheduled item instance for a given due_date.
///
/// Behavior (matches the legacy Python contract):
/// - If a pending Instance exists → update it to `skipped` with `skip_reason` and `resolved_at`.
/// - If no Instance exists for `(scheduled_item_id, due_date)` → create a new one with `skipped` status.
/// - If an Instance exists but is not pending (already completed/skipped/auto_completed) → 409.
/// - If the scheduled_item_id does not exist → 404.
/// - If the request body fails validation → 400.
///
/// Returns the updated/created Instance as JSON on success.
async fn skip_scheduled_item(
    State(state): State<SharedState>,
    Path(id): Path<i64>,
    Json(body): Json<SkipRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // 1. Validate due_date format (strict YYYY-MM-DD)
    if chrono::NaiveDate::parse_from_str(&body.due_date, "%Y-%m-%d").is_err() {
        return Err(AppError::Validation(
            "due_date must be in YYYY-MM-DD format".to_string(),
        ));
    }

    // 2. Validate reason length
    if let Some(ref reason) = body.reason {
        if reason.chars().count() > SKIP_REASON_MAX_LEN {
            return Err(AppError::Validation(format!(
                "reason must be {SKIP_REASON_MAX_LEN} characters or fewer"
            )));
        }
    }

    let conn = state.pool.get()?;

    // 3. Verify the scheduled item exists → 404 if not
    let item_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM scheduled_items WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get::<_, i64>(0),
        )
        .map(|c| c > 0)?;

    if !item_exists {
        return Err(AppError::NotFound("Scheduled item not found".to_string()));
    }

    // 4. Look up existing instance for (scheduled_item_id, due_date)
    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, status FROM scheduled_item_instances \
             WHERE scheduled_item_id = ?1 AND due_date = ?2",
            rusqlite::params![id, body.due_date],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    // UTC timestamp in ISO 8601 (second precision, no fractional part, explicit Z).
    let resolved_at = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let instance_id: i64 = match existing {
        Some((inst_id, status)) if status == "pending" => {
            // Update the pending instance → skipped
            conn.execute(
                "UPDATE scheduled_item_instances \
                 SET status = 'skipped', skip_reason = ?1, resolved_at = ?2 \
                 WHERE id = ?3",
                rusqlite::params![body.reason, resolved_at, inst_id],
            )?;
            inst_id
        }
        Some(_) => {
            // Non-pending instance → 409 Conflict, no write
            return Err(AppError::Conflict(
                "Instance is already resolved".to_string(),
            ));
        }
        None => {
            // No instance → create a new one in 'skipped' state
            conn.query_row(
                "INSERT INTO scheduled_item_instances \
                 (scheduled_item_id, due_date, status, skip_reason, resolved_at) \
                 VALUES (?1, ?2, 'skipped', ?3, ?4) \
                 RETURNING id",
                rusqlite::params![id, body.due_date, body.reason, resolved_at],
                |row| row.get::<_, i64>(0),
            )?
        }
    };

    // 5. Re-select the instance to return the canonical record.
    let instance = conn.query_row(
        "SELECT id, scheduled_item_id, created_at, due_date, due_time, status, \
                resolved_at, notes, skip_reason, entry_id \
         FROM scheduled_item_instances WHERE id = ?1",
        rusqlite::params![instance_id],
        |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "scheduled_item_id": row.get::<_, i64>(1)?,
                "created_at": row.get::<_, String>(2)?,
                "due_date": row.get::<_, String>(3)?,
                "due_time": row.get::<_, Option<String>>(4)?,
                "status": row.get::<_, String>(5)?,
                "resolved_at": row.get::<_, Option<String>>(6)?,
                "notes": row.get::<_, Option<String>>(7)?,
                "skip_reason": row.get::<_, Option<String>>(8)?,
                "entry_id": row.get::<_, Option<i64>>(9)?,
            }))
        },
    )?;

    Ok(Json(instance))
}

// â”€â”€â”€ Helper Functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Temporary struct for holding due instance row data.
struct DueInstanceRow {
    instance_id: i64,
    scheduled_item_id: i64,
    due_date: String,
    due_time: Option<String>,
    _status: String,
    name: String,
    program_id: Option<i64>,
    program_name: Option<String>,
    quick_complete: i64,
    template_entry_type: String,
    template_work_type: String,
    project_id: Option<i64>,
    item_class: String,
    recurrence_type: Option<String>,
    project_name: Option<String>,
    require_acknowledgment: i64,
}

/// Temporary struct for holding scheduled item data during complete operation.
struct ScheduledItemRow {
    id: i64,
    name: String,
    mode: String,
    program_id: Option<i64>,
    project_id: Option<i64>,
    template_entry_type: String,
    template_work_type: String,
    template_tags: Option<String>,
    template_visibility: String,
    quick_complete: i64,
}

/// Convert a row from the scheduled items SELECT (with LEFT JOIN programs, projects) into a ScheduledItemResponse.
fn scheduled_item_row_to_response(row: &rusqlite::Row) -> ScheduledItemResponse {
    ScheduledItemResponse {
        id: row.get(0).unwrap_or(0),
        created_at: row.get(1).unwrap_or_default(),
        updated_at: row.get(2).unwrap_or_default(),
        name: row.get(3).unwrap_or_default(),
        description: row.get(4).unwrap_or(None),
        mode: row.get(5).unwrap_or_default(),
        due_date: row.get(6).unwrap_or(None),
        recurrence_type: row.get(7).unwrap_or(None),
        day_of_week: row.get(8).unwrap_or(None),
        day_of_month: row.get(9).unwrap_or(None),
        month_of_year: row.get(10).unwrap_or(None),
        time_of_day: row.get(11).unwrap_or(None),
        day_range_start: row.get(12).unwrap_or(None),
        day_range_end: row.get(13).unwrap_or(None),
        program_id: row.get(14).unwrap_or(None),
        project_id: row.get(15).unwrap_or(None),
        template_entry_type: row.get(16).unwrap_or_default(),
        template_work_type: row.get(17).unwrap_or_default(),
        template_tags: row.get(18).unwrap_or(None),
        template_visibility: row.get(19).unwrap_or_default(),
        quick_complete: row.get(20).unwrap_or(0),
        status: row.get(21).unwrap_or_default(),
        sort_order: row.get(22).unwrap_or(0),
        item_class: row.get(23).unwrap_or_default(),
        show_on_today: row.get(24).unwrap_or(1),
        require_acknowledgment: row.get(25).unwrap_or(0),
        program_name: row.get(26).unwrap_or(None),
        project_name: row.get(27).unwrap_or(None),
        instances: vec![],
    }
}

/// Fetch a scheduled item response by ID (with program_name and project_name via LEFT JOINs).
fn fetch_scheduled_item_response(
    conn: &rusqlite::Connection,
    item_id: i64,
) -> Result<ScheduledItemResponse, AppError> {
    let sql = format!("{} WHERE si.id = ?1", SCHEDULED_ITEM_SELECT);
    conn.query_row(&sql, rusqlite::params![item_id], |row| {
        Ok(scheduled_item_row_to_response(row))
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound("Scheduled item not found".to_string())
        }
        other => AppError::Database(other),
    })
}

/// Fetch instances for a scheduled item (most recent first, limited).
fn fetch_item_instances(
    conn: &rusqlite::Connection,
    item_id: i64,
    limit: i64,
) -> Result<Vec<ScheduledInstanceResponse>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, scheduled_item_id, created_at, due_date, due_time, status, \
                resolved_at, notes, skip_reason, entry_id \
         FROM scheduled_item_instances \
         WHERE scheduled_item_id = ?1 \
         ORDER BY due_date DESC LIMIT ?2",
    )?;

    let instances = stmt
        .query_map(rusqlite::params![item_id, limit], |row| {
            Ok(ScheduledInstanceResponse {
                id: row.get(0)?,
                scheduled_item_id: row.get(1)?,
                created_at: row.get(2)?,
                due_date: row.get(3)?,
                due_time: row.get(4)?,
                status: row.get(5)?,
                resolved_at: row.get(6)?,
                notes: row.get(7)?,
                skip_reason: row.get(8)?,
                entry_id: row.get(9)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(instances)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Unit tests for the `skip_scheduled_item` handler.
    //!
    //! Covers every branch documented in the handler doc comment plus a property
    //! test that establishes skip idempotency across arbitrary valid dates.
    //!
    //! Follows the same test-state/router pattern used in `system.rs` tests.

    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use proptest::prelude::*;
    use std::sync::Arc;
    use tokio::sync::watch;
    use tower::util::ServiceExt;

    // ─── Test helpers ──────────────────────────────────────────────────────

    /// Build a `SharedState` backed by a temp-dir SQLite database with the
    /// full production schema initialized.
    fn test_state() -> SharedState {
        let dir = tempfile::tempdir().unwrap();
        let config = AppConfig {
            db_path: dir.path().join("test.db"),
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };
        let pool = init_pool(&config).unwrap();

        // Install the full schema so FK constraints behave like production.
        let conn = pool.get().unwrap();
        initialize_schema(&conn).unwrap();
        drop(conn);

        // Keep the temp dir alive for the lifetime of the pool by leaking it —
        // acceptable in tests, matches the pattern used elsewhere in the crate.
        std::mem::forget(dir);

        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    /// Insert a scheduled item with sane defaults. Returns the new item id.
    fn insert_scheduled_item(state: &SharedState, name: &str) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO scheduled_items \
             (name, mode, template_entry_type, template_work_type, template_visibility, item_class) \
             VALUES (?1, 'recurring', 'operational_rhythm', 'operational_rhythm', 'shareable', 'cadence') \
             RETURNING id",
            rusqlite::params![name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Insert an instance with the given status. Returns the new instance id.
    fn insert_instance(state: &SharedState, item_id: i64, due_date: &str, status: &str) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) \
             VALUES (?1, ?2, ?3) RETURNING id",
            rusqlite::params![item_id, due_date, status],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Read back the status of an instance by id.
    fn instance_status(state: &SharedState, instance_id: i64) -> String {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "SELECT status FROM scheduled_item_instances WHERE id = ?1",
            rusqlite::params![instance_id],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
    }

    /// POST to `/api/scheduled-items/{item_id}/skip` with the given raw JSON
    /// body and return `(status, body_json)`.
    async fn post_skip(
        state: SharedState,
        item_id: i64,
        body: &str,
    ) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri(format!("/api/scheduled-items/{}/skip", item_id))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    // ─── Unit tests ────────────────────────────────────────────────────────

    /// Requirement 2.2, 2.4: pending → skipped returns 200 with the updated
    /// Instance JSON body. The skip_reason and resolved_at fields SHALL be set.
    #[tokio::test]
    async fn skip_pending_instance_returns_200_and_skipped_status() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Daily standup");
        let instance_id = insert_instance(&state, item_id, "2026-01-15", "pending");

        let body = r#"{"due_date": "2026-01-15", "reason": "on vacation"}"#;
        let (status, json) = post_skip(state.clone(), item_id, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["id"], instance_id);
        assert_eq!(json["scheduled_item_id"], item_id);
        assert_eq!(json["due_date"], "2026-01-15");
        assert_eq!(json["status"], "skipped");
        assert_eq!(json["skip_reason"], "on vacation");
        // resolved_at SHALL be set to an ISO 8601 UTC timestamp (ends with Z).
        let resolved_at = json["resolved_at"].as_str().unwrap();
        assert!(
            resolved_at.ends_with('Z'),
            "resolved_at should be ISO 8601 UTC, got {resolved_at}"
        );
        assert_eq!(instance_status(&state, instance_id), "skipped");
    }

    /// Requirement 2.3: when no Instance exists for (scheduled_item_id,
    /// due_date), the skip endpoint SHALL create a new Instance in 'skipped'
    /// state and return 200.
    #[tokio::test]
    async fn skip_creates_new_instance_when_none_exists() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Weekly review");
        // No instance pre-seeded.

        let body = r#"{"due_date": "2026-03-02", "reason": "skipping this week"}"#;
        let (status, json) = post_skip(state.clone(), item_id, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["scheduled_item_id"], item_id);
        assert_eq!(json["due_date"], "2026-03-02");
        assert_eq!(json["status"], "skipped");
        assert_eq!(json["skip_reason"], "skipping this week");
        assert!(json["resolved_at"].is_string());

        // Confirm exactly one instance was inserted.
        let conn = state.pool.get().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_item_instances WHERE scheduled_item_id = ?1",
                rusqlite::params![item_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    /// Requirement 2.3: skip with a null `reason` still succeeds and creates
    /// an instance with a null skip_reason.
    #[tokio::test]
    async fn skip_accepts_null_reason() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Optional task");

        let body = r#"{"due_date": "2026-04-10", "reason": null}"#;
        let (status, json) = post_skip(state, item_id, body).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(json["status"], "skipped");
        assert!(json["skip_reason"].is_null());
    }

    /// Requirement 2.5: 404 with `{"detail": "Scheduled item not found"}` when
    /// the scheduled_item_id does not exist. No instance SHALL be created.
    #[tokio::test]
    async fn skip_returns_404_for_missing_scheduled_item() {
        let state = test_state();

        let body = r#"{"due_date": "2026-01-15", "reason": null}"#;
        let (status, json) = post_skip(state.clone(), 9_999, body).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json["detail"], "Scheduled item not found");

        // And no instance was inserted for the phantom item id.
        let conn = state.pool.get().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_item_instances WHERE scheduled_item_id = ?1",
                rusqlite::params![9_999_i64],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    /// Requirement 2.8: 409 with `{"detail": "Instance is already resolved"}`
    /// when the instance for (scheduled_item_id, due_date) has a non-pending
    /// status. The instance SHALL NOT be modified.
    #[tokio::test]
    async fn skip_returns_409_for_already_completed_instance() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Finished work");
        let instance_id = insert_instance(&state, item_id, "2026-02-01", "completed");

        let body = r#"{"due_date": "2026-02-01", "reason": "too late"}"#;
        let (status, json) = post_skip(state.clone(), item_id, body).await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(json["detail"], "Instance is already resolved");
        // Status is unchanged.
        assert_eq!(instance_status(&state, instance_id), "completed");
    }

    /// Requirement 2.8 (second branch): an already-skipped instance cannot
    /// be re-skipped — returns 409.
    #[tokio::test]
    async fn skip_returns_409_for_already_skipped_instance() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Already skipped");
        let instance_id = insert_instance(&state, item_id, "2026-02-02", "skipped");

        let body = r#"{"due_date": "2026-02-02", "reason": "trying again"}"#;
        let (status, json) = post_skip(state.clone(), item_id, body).await;

        assert_eq!(status, StatusCode::CONFLICT);
        assert_eq!(json["detail"], "Instance is already resolved");
        assert_eq!(instance_status(&state, instance_id), "skipped");
    }

    /// Requirement 2.6: invalid `due_date` format SHALL return 400.
    #[tokio::test]
    async fn skip_returns_400_for_bad_date_format() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Some item");

        let body = r#"{"due_date": "not-a-date", "reason": null}"#;
        let (status, json) = post_skip(state, item_id, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["detail"], "due_date must be in YYYY-MM-DD format");
    }

    /// Requirement 2.6: a partial date like `2026-01` is rejected as 400.
    #[tokio::test]
    async fn skip_returns_400_for_partial_date() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Some item");

        let body = r#"{"due_date": "2026-01", "reason": null}"#;
        let (status, _json) = post_skip(state, item_id, body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    /// Requirement 2.6: missing `due_date` field is a validation failure.
    ///
    /// axum's `Json` extractor rejects a body missing a required non-optional
    /// field with a 4xx client error (typically 422 Unprocessable Entity).
    /// Assert a client error so the test documents the behaviour without
    /// coupling to axum's internal status-code choice.
    #[tokio::test]
    async fn skip_returns_client_error_for_missing_due_date() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Some item");

        let body = r#"{"reason": "no date"}"#;
        let (status, _json) = post_skip(state, item_id, body).await;

        assert!(
            status.is_client_error(),
            "expected 4xx client error for missing due_date, got {status}"
        );
    }

    /// Requirement 2.6: `reason` longer than 500 characters SHALL return 400.
    #[tokio::test]
    async fn skip_returns_400_for_reason_over_500_chars() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Some item");

        // 501 characters — one over the limit.
        let long_reason = "a".repeat(501);
        let body = format!(
            r#"{{"due_date": "2026-01-15", "reason": "{}"}}"#,
            long_reason
        );
        let (status, json) = post_skip(state, item_id, &body).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let detail = json["detail"].as_str().unwrap();
        assert!(
            detail.contains("500"),
            "expected detail to mention the 500-char limit, got {detail}"
        );
    }

    /// Boundary case: a `reason` of exactly 500 characters is accepted.
    #[tokio::test]
    async fn skip_accepts_reason_of_exactly_500_chars() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Some item");

        let reason = "a".repeat(500);
        let body = format!(r#"{{"due_date": "2026-01-15", "reason": "{}"}}"#, reason);
        let (status, _json) = post_skip(state, item_id, &body).await;

        assert_eq!(status, StatusCode::OK);
    }

    // ─── Property-Based Tests ──────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(20))]

        // Feature: chronicle-v2.5.1-patch, Property: Skip Is Idempotent-Safe
        // **Validates: Requirements 2.2, 2.8**
        //
        // For any valid (scheduled_item_id, due_date) pair with a pending
        // Instance, the first skip SHALL return 200 and the second skip
        // SHALL return 409 — never a second 200, and the Instance SHALL
        // remain in `skipped` state with the first call's skip_reason.
        #[test]
        fn prop_skip_is_idempotent_safe(
            year in 2020i32..=2030,
            month in 1u32..=12,
            day in 1u32..=28,
        ) {
            let rt = tokio::runtime::Runtime::new().unwrap();
            let result: Result<(), TestCaseError> = rt.block_on(async {
                let state = test_state();
                let item_id = insert_scheduled_item(&state, "prop item");
                let due_date = format!("{:04}-{:02}-{:02}", year, month, day);
                let instance_id = insert_instance(&state, item_id, &due_date, "pending");

                let body1 = format!(
                    r#"{{"due_date": "{}", "reason": "first"}}"#,
                    due_date
                );
                let (status1, json1) = post_skip(state.clone(), item_id, &body1).await;
                prop_assert_eq!(status1, StatusCode::OK);
                prop_assert_eq!(&json1["status"], "skipped");
                prop_assert_eq!(&json1["skip_reason"], "first");

                let body2 = format!(
                    r#"{{"due_date": "{}", "reason": "second"}}"#,
                    due_date
                );
                let (status2, json2) = post_skip(state.clone(), item_id, &body2).await;
                prop_assert_eq!(status2, StatusCode::CONFLICT);
                prop_assert_eq!(&json2["detail"], "Instance is already resolved");

                // Instance is untouched by the second call: status still
                // 'skipped' and skip_reason still matches the first call.
                let conn = state.pool.get().unwrap();
                let (status, skip_reason): (String, Option<String>) = conn
                    .query_row(
                        "SELECT status, skip_reason FROM scheduled_item_instances WHERE id = ?1",
                        rusqlite::params![instance_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .unwrap();
                prop_assert_eq!(status, "skipped".to_string());
                prop_assert_eq!(skip_reason, Some("first".to_string()));

                Ok(())
            });
            result?;
        }
    }

    // ─── Helpers for instance routes (§2.6–2.8) ────────────────────────────

    /// Issue a GET request through the scheduled router and return
    /// `(status, body_json)`.
    ///
    /// Shared by the bulk-list and per-item-list tests — both routes return
    /// JSON arrays, so a single helper keeps call-sites small.
    async fn get_json(state: SharedState, path: &str) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("GET")
            .uri(path)
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    /// POST to `/api/scheduled-items/:id/instances/regenerate` (empty body)
    /// and return `(status, body_json)`.
    async fn post_regenerate(
        state: SharedState,
        item_id: i64,
    ) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri(format!(
                "/api/scheduled-items/{}/instances/regenerate",
                item_id
            ))
            .header("content-type", "application/json")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    /// Flip an existing `scheduled_items` row to a given recurrence_type.
    ///
    /// The shared `insert_scheduled_item` helper creates a cadence with no
    /// `recurrence_type` set (so `compute_due_dates` returns an empty set).
    /// The regenerate tests need a concrete schedule — `every_day` gives a
    /// deterministic `lookahead_days + 1` instances regardless of the weekday
    /// the test runs on.
    fn set_recurrence_every_day(state: &SharedState, item_id: i64) {
        let conn = state.pool.get().unwrap();
        conn.execute(
            "UPDATE scheduled_items SET recurrence_type = 'every_day' WHERE id = ?1",
            rusqlite::params![item_id],
        )
        .unwrap();
    }

    /// Read all pending instances for an item as a sorted `Vec<(due_date,
    /// status)>`. Used to compare instance sets across regenerate calls.
    fn snapshot_instances(state: &SharedState, item_id: i64) -> Vec<(String, String)> {
        let conn = state.pool.get().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT due_date, status FROM scheduled_item_instances \
                 WHERE scheduled_item_id = ?1 ORDER BY due_date ASC",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![item_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    }

    // ─── §2.6: GET /api/scheduled-items/instances ─────────────────────────

    /// Requirement 6.7: bulk-list honors `due_date_start` + `due_date_end`
    /// and returns only instances falling within the inclusive range.
    #[tokio::test]
    async fn list_instances_filters_by_date_range() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Ranged item");

        // Four instances spanning Jan 10 → Jan 25. The filter should keep
        // only Jan 15 and Jan 20.
        insert_instance(&state, item_id, "2024-01-10", "pending");
        let jan15 = insert_instance(&state, item_id, "2024-01-15", "pending");
        let jan20 = insert_instance(&state, item_id, "2024-01-20", "pending");
        insert_instance(&state, item_id, "2024-01-25", "pending");

        let (status, json) = get_json(
            state,
            "/api/scheduled-items/instances?due_date_start=2024-01-12&due_date_end=2024-01-22",
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        let arr = json.as_array().expect("response should be a JSON array");
        assert_eq!(arr.len(), 2, "expected exactly 2 instances in range");

        // Results are ordered by due_date ASC → Jan 15 first, Jan 20 second.
        assert_eq!(arr[0]["id"], jan15);
        assert_eq!(arr[0]["due_date"], "2024-01-15");
        assert_eq!(arr[1]["id"], jan20);
        assert_eq!(arr[1]["due_date"], "2024-01-20");

        // Parent fields from the JOIN are populated.
        assert_eq!(arr[0]["name"], "Ranged item");
        assert_eq!(arr[0]["item_class"], "cadence");
    }

    // ─── §2.7: GET /api/scheduled-items/:id/instances ─────────────────────

    /// Requirement 6.8: per-item list respects the `limit` query param and
    /// returns at most `limit` rows ordered by due_date ASC.
    #[tokio::test]
    async fn list_item_instances_respects_limit() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Limited item");

        // Five instances spread across distinct due_dates.
        for day in ["2024-02-01", "2024-02-02", "2024-02-03", "2024-02-04", "2024-02-05"] {
            insert_instance(&state, item_id, day, "pending");
        }

        let path = format!("/api/scheduled-items/{}/instances?limit=3", item_id);
        let (status, json) = get_json(state, &path).await;

        assert_eq!(status, StatusCode::OK);
        let arr = json.as_array().expect("response should be a JSON array");
        assert_eq!(arr.len(), 3, "limit=3 should cap the result set at 3 rows");

        // Ordered by due_date ASC → the three earliest dates.
        assert_eq!(arr[0]["due_date"], "2024-02-01");
        assert_eq!(arr[1]["due_date"], "2024-02-02");
        assert_eq!(arr[2]["due_date"], "2024-02-03");
    }

    // ─── §2.8: POST /api/scheduled-items/:id/instances/regenerate ─────────

    /// Requirement 6.9: regenerate deletes existing pending instances and
    /// rebuilds the schedule. The returned `regenerated_count` SHALL match
    /// the count of pending instances in the DB after the call.
    #[tokio::test]
    async fn regenerate_replaces_seeded_pending_with_fresh_generation() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Regenerating item");
        set_recurrence_every_day(&state, item_id);

        // Seed 2 pending instances with arbitrary stale due_dates that fall
        // outside the regenerate lookahead window. After regenerate they
        // SHALL be gone, replaced by the freshly-generated schedule.
        insert_instance(&state, item_id, "2020-01-01", "pending");
        insert_instance(&state, item_id, "2020-01-02", "pending");

        let (status, json) = post_regenerate(state.clone(), item_id).await;
        assert_eq!(status, StatusCode::OK);

        let regenerated_count = json["regenerated_count"]
            .as_i64()
            .expect("regenerated_count should be an integer");
        assert!(
            regenerated_count > 0,
            "every_day recurrence should generate a non-empty schedule"
        );

        // Count actual pending instances in the DB → SHALL match the
        // response count exactly (the 2 seeded stale rows are deleted).
        let conn = state.pool.get().unwrap();
        let pending_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_item_instances \
                 WHERE scheduled_item_id = ?1 AND status = 'pending'",
                rusqlite::params![item_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            pending_count, regenerated_count,
            "DB pending count should match regenerated_count from response"
        );

        // The stale seeded dates are not present in the regenerated set
        // (they fall well outside the `today..today+14` lookahead window).
        let stale_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM scheduled_item_instances \
                 WHERE scheduled_item_id = ?1 AND due_date IN ('2020-01-01', '2020-01-02')",
                rusqlite::params![item_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stale_exists, 0, "seeded stale pending rows should be deleted");
    }

    /// Requirement 6.9: regenerate is idempotent — calling it twice in a row
    /// produces the same instance set (same due_dates, same count). The
    /// second call SHALL NOT double the schedule or leave orphan rows.
    #[tokio::test]
    async fn regenerate_is_idempotent() {
        let state = test_state();
        let item_id = insert_scheduled_item(&state, "Idempotent item");
        set_recurrence_every_day(&state, item_id);

        // First call establishes the baseline schedule.
        let (status1, json1) = post_regenerate(state.clone(), item_id).await;
        assert_eq!(status1, StatusCode::OK);
        let count1 = json1["regenerated_count"].as_i64().unwrap();
        let snapshot1 = snapshot_instances(&state, item_id);

        // Second call should produce the same schedule.
        let (status2, json2) = post_regenerate(state.clone(), item_id).await;
        assert_eq!(status2, StatusCode::OK);
        let count2 = json2["regenerated_count"].as_i64().unwrap();
        let snapshot2 = snapshot_instances(&state, item_id);

        assert_eq!(
            count1, count2,
            "regenerated_count should be identical across back-to-back calls"
        );
        assert_eq!(
            snapshot1, snapshot2,
            "instance set (due_date, status) should be identical across back-to-back calls"
        );
    }
}
