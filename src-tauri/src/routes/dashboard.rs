//! Dashboard routes: aggregate stats, heatmap, and activity pulse.
//!
//! Implements 3 routes matching the Python FastAPI backend.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{Datelike, Local, NaiveDate};
use serde::Deserialize;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{
    ActivityPulse, DashboardResponse, HeatmapEntry, HeatmapResponse, ReportReady,
};
use crate::routes::entries::{entry_row_to_response_basic, fetch_entry_tags, ENTRY_SELECT};

/// Build the dashboard sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/dashboard", get(get_dashboard))
        .route("/api/dashboard/heatmap", get(get_heatmap))
        .route("/api/dashboard/activity-pulse", get(get_activity_pulse))
        .with_state(state)
}

/// GET /api/dashboard — return aggregate stats.
async fn get_dashboard(
    State(state): State<SharedState>,
) -> Result<Json<DashboardResponse>, AppError> {
    let conn = state.pool.get()?;

    let today = Local::now().date_naive();

    // Week boundaries (Sun-Sat)
    let days_since_sunday = today.weekday().num_days_from_sunday();
    let week_sunday = today - chrono::Duration::days(days_since_sunday as i64);
    let week_saturday = week_sunday + chrono::Duration::days(6);

    // Month boundaries
    let month_start = today.with_day(1).unwrap_or(today);

    // Quarter boundaries (simple calendar quarter)
    let quarter_month = ((today.month() - 1) / 3) * 3 + 1;
    let q_start = NaiveDate::from_ymd_opt(today.year(), quarter_month, 1).unwrap_or(today);
    let q_end_month = quarter_month + 2;
    let q_end = if q_end_month == 12 {
        NaiveDate::from_ymd_opt(today.year(), 12, 31).unwrap_or(today)
    } else {
        NaiveDate::from_ymd_opt(today.year(), q_end_month + 1, 1)
            .unwrap_or(today)
            - chrono::Duration::days(1)
    };

    // entries_this_week
    let entries_this_week: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE entry_date >= ?1 AND entry_date <= ?2",
        rusqlite::params![week_sunday.to_string(), week_saturday.to_string()],
        |row| row.get(0),
    )?;

    // entries_this_month
    let entries_this_month: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE entry_date >= ?1 AND entry_date <= ?2",
        rusqlite::params![month_start.to_string(), today.to_string()],
        |row| row.get(0),
    )?;

    // entries_this_quarter
    let entries_this_quarter: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE entry_date >= ?1 AND entry_date <= ?2",
        rusqlite::params![q_start.to_string(), q_end.to_string()],
        |row| row.get(0),
    )?;

    // active_projects
    let active_projects: i64 = conn.query_row(
        "SELECT COUNT(*) FROM projects WHERE status IN ('planning', 'active')",
        [],
        |row| row.get(0),
    )?;

    // goals_on_track
    let goals_on_track: i64 = conn.query_row(
        "SELECT COUNT(*) FROM goals WHERE status = 'on_track'",
        [],
        |row| row.get(0),
    )?;

    // goals_at_risk
    let goals_at_risk: i64 = conn.query_row(
        "SELECT COUNT(*) FROM goals WHERE status = 'at_risk'",
        [],
        |row| row.get(0),
    )?;

    // days_since_last_entry
    let last_entry_date: Option<String> = conn
        .query_row("SELECT MAX(entry_date) FROM entries", [], |row| row.get(0))
        .unwrap_or(None);

    let days_since_last_entry = last_entry_date.as_ref().and_then(|d| {
        NaiveDate::parse_from_str(&d[..10.min(d.len())], "%Y-%m-%d")
            .ok()
            .map(|last| (today - last).num_days())
    });

    // operational_rhythm_count (current quarter)
    let operational_rhythm_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE work_type = 'operational_rhythm' \
         AND entry_date >= ?1 AND entry_date <= ?2",
        rusqlite::params![q_start.to_string(), q_end.to_string()],
        |row| row.get(0),
    )?;

    // open_todos_count
    let open_todos_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE entry_type = 'action_item' \
         AND status IN ('in_progress', 'ongoing')",
        [],
        |row| row.get(0),
    )?;

    // Activity pulse
    let tasks_completed_this_week: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scheduled_item_instances \
         WHERE status IN ('completed', 'auto_completed') \
         AND due_date >= ?1 AND due_date <= ?2",
        rusqlite::params![week_sunday.to_string(), week_saturday.to_string()],
        |row| row.get(0),
    )?;

    let time_since_last_entry = match days_since_last_entry {
        Some(0) => "today".to_string(),
        Some(1) => "1 day ago".to_string(),
        Some(n) => format!("{} days ago", n),
        None => "no entries".to_string(),
    };

    let activity_pulse = Some(ActivityPulse {
        entries_this_week,
        tasks_completed_this_week,
        time_since_last_entry,
    });

    // Report ready (check for drafts with status='ready')
    let report_ready: Option<ReportReady> = conn
        .query_row(
            "SELECT id, title FROM report_drafts WHERE status = 'ready' \
             ORDER BY updated_at DESC LIMIT 1",
            [],
            |row| {
                Ok(ReportReady {
                    draft_id: row.get(0)?,
                    title: row.get(1)?,
                })
            },
        )
        .ok();

    // Prep notes (active, non-dismissed)
    let mut prep_stmt = conn.prepare(
        "SELECT id, text, created_at FROM notes \
         WHERE dismissed_at IS NULL ORDER BY created_at DESC LIMIT 5",
    )?;
    let prep_notes: Vec<serde_json::Value> = prep_stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, i64>(0)?,
                "text": row.get::<_, String>(1)?,
                "created_at": row.get::<_, String>(2)?,
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    // recent_entries: 10 most-recent entries ordered by entry_date DESC,
    // created_at DESC, id DESC (req 4.1). Reuses the ENTRY_SELECT / row-to-response
    // helpers from routes/entries.rs so the JSON shape matches EntryResponse exactly.
    let recent_entries: Vec<serde_json::Value> = {
        let sql = format!(
            "{} ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT 10",
            ENTRY_SELECT
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| Ok(entry_row_to_response_basic(row)))?;

        let mut entries = Vec::new();
        for row_result in rows {
            let mut entry = row_result?;
            entry.tags = fetch_entry_tags(&conn, entry.id)?;
            entries.push(serde_json::to_value(&entry).map_err(|e| {
                AppError::Internal(format!("Failed to serialize recent entry: {}", e))
            })?);
        }
        entries
    };

    // open_todos: up to 20 action_item entries with status in ('in_progress',
    // 'ongoing'), ordered by entry_date DESC with created_at DESC / id DESC as
    // tie-breakers (req 4.2). Same helper reuse as recent_entries so the JSON
    // shape matches EntryResponse.
    let open_todos: Vec<serde_json::Value> = {
        let sql = format!(
            "{} WHERE e.entry_type = 'action_item' \
             AND e.status IN ('in_progress', 'ongoing') \
             ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT 20",
            ENTRY_SELECT
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map([], |row| Ok(entry_row_to_response_basic(row)))?;

        let mut entries = Vec::new();
        for row_result in rows {
            let mut entry = row_result?;
            entry.tags = fetch_entry_tags(&conn, entry.id)?;
            entries.push(serde_json::to_value(&entry).map_err(|e| {
                AppError::Internal(format!("Failed to serialize open todo: {}", e))
            })?);
        }
        entries
    };

    // gap_dates: dates in the current Sun-Sat week (local timezone) that have
    // zero entries, formatted as YYYY-MM-DD strings (req 4.5). Uses the same
    // `entry_date BETWEEN week_sunday AND week_saturday` range pattern as the
    // other week-scoped queries in this handler so `entry_date` is treated
    // consistently as a YYYY-MM-DD text column.
    let gap_dates: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT entry_date FROM entries \
             WHERE entry_date >= ?1 AND entry_date <= ?2",
        )?;
        let existing: std::collections::HashSet<String> = stmt
            .query_map(
                rusqlite::params![week_sunday.to_string(), week_saturday.to_string()],
                |row| row.get::<_, String>(0),
            )?
            .filter_map(|r| r.ok())
            .collect();

        (0..7)
            .map(|i| (week_sunday + chrono::Duration::days(i)).to_string())
            .filter(|day| !existing.contains(day))
            .collect()
    };

    // program_activity: one object per active program (status='active') with
    // `program_id`, `program_name`, `entries_this_week` (count in the current
    // Sun-Sat week, local timezone), and `scheduled_completion_rate`
    // (completed + auto_completed) / total scheduled instances in the last
    // 30 calendar days, or 0.0 when the denominator is 0 (req 4.6). Ordered
    // by `sort_order ASC, id ASC` so callers get a stable list.
    let program_activity: Vec<serde_json::Value> = {
        let thirty_days_ago = (today - chrono::Duration::days(30)).to_string();
        let mut stmt = conn.prepare(
            "SELECT \
                p.id, \
                p.name, \
                (SELECT COUNT(*) FROM entries e \
                     WHERE e.program_id = p.id \
                     AND e.entry_date >= ?1 AND e.entry_date <= ?2) AS entries_this_week, \
                (SELECT COUNT(*) FROM scheduled_item_instances sii \
                     JOIN scheduled_items si ON si.id = sii.scheduled_item_id \
                     WHERE si.program_id = p.id \
                     AND sii.due_date >= ?3) AS total_instances, \
                (SELECT COUNT(*) FROM scheduled_item_instances sii \
                     JOIN scheduled_items si ON si.id = sii.scheduled_item_id \
                     WHERE si.program_id = p.id \
                     AND sii.due_date >= ?3 \
                     AND sii.status IN ('completed', 'auto_completed')) AS completed_instances \
             FROM programs p \
             WHERE p.status = 'active' \
             ORDER BY p.sort_order ASC, p.id ASC",
        )?;

        let rows = stmt.query_map(
            rusqlite::params![
                week_sunday.to_string(),
                week_saturday.to_string(),
                thirty_days_ago,
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )?;

        let mut activity = Vec::new();
        for row_result in rows {
            let (program_id, program_name, entries_this_week, total, completed) = row_result?;
            let scheduled_completion_rate = if total == 0 {
                0.0
            } else {
                completed as f64 / total as f64
            };
            activity.push(serde_json::json!({
                "program_id": program_id,
                "program_name": program_name,
                "entries_this_week": entries_this_week,
                "scheduled_completion_rate": scheduled_completion_rate,
            }));
        }
        activity
    };

    // weekly_highlight: single entry with is_weekly_highlight=1 in the current
    // Sun-Sat week (local timezone); None when no highlighted entry exists in
    // the window (req 4.4). Reuses ENTRY_SELECT + entry_row_to_response_basic
    // so the JSON shape matches EntryResponse.
    let weekly_highlight: Option<serde_json::Value> = {
        let sql = format!(
            "{} WHERE e.is_weekly_highlight = 1 \
             AND e.entry_date BETWEEN ?1 AND ?2 \
             ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC LIMIT 1",
            ENTRY_SELECT
        );
        let mut stmt = conn.prepare(&sql)?;
        let mut rows = stmt.query(rusqlite::params![
            week_sunday.to_string(),
            week_saturday.to_string()
        ])?;
        if let Some(row) = rows.next()? {
            let mut entry = entry_row_to_response_basic(row);
            entry.tags = fetch_entry_tags(&conn, entry.id)?;
            Some(serde_json::to_value(&entry).map_err(|e| {
                AppError::Internal(format!("Failed to serialize weekly_highlight: {}", e))
            })?)
        } else {
            None
        }
    };

    // due_today: pending scheduled-item instances whose `due_date` equals
    // today (local timezone). Returns null when no such instances exist,
    // otherwise `{ count, items }` where `items` holds up to 5 rows ordered
    // by `due_time ASC NULLS LAST, scheduled_item_id ASC` (req 4.7). The
    // per-item shape matches the `today` / `overdue` rows returned by
    // `GET /api/scheduled-items/due` so the frontend can reuse its existing
    // type without a new schema. Applies the same `show_on_today` filter as
    // the Today/Overdue endpoint (tasks always count; cadences only when
    // `show_on_today = 1`) so the two surfaces agree.
    let due_today: Option<serde_json::Value> = {
        let today_str = today.to_string();
        let mut stmt = conn.prepare(
            "SELECT sii.id, sii.scheduled_item_id, sii.due_date, sii.due_time, \
                    si.name, si.program_id, prog.name AS program_name, \
                    si.quick_complete, si.template_entry_type, si.template_work_type, \
                    si.project_id, si.item_class, si.recurrence_type, \
                    proj.name AS project_name, si.require_acknowledgment \
             FROM scheduled_item_instances sii \
             JOIN scheduled_items si ON sii.scheduled_item_id = si.id \
             LEFT JOIN programs prog ON si.program_id = prog.id \
             LEFT JOIN projects proj ON si.project_id = proj.id \
             WHERE sii.status = 'pending' AND sii.due_date = ?1 \
               AND (si.item_class = 'task' \
                    OR (si.item_class = 'cadence' AND si.show_on_today = 1)) \
             ORDER BY (sii.due_time IS NULL) ASC, sii.due_time ASC, \
                      sii.scheduled_item_id ASC",
        )?;

        let rows = stmt.query_map(rusqlite::params![&today_str], |row| {
            Ok(serde_json::json!({
                "instance_id": row.get::<_, i64>(0)?,
                "scheduled_item_id": row.get::<_, i64>(1)?,
                "due_date": row.get::<_, String>(2)?,
                "due_time": row.get::<_, Option<String>>(3)?,
                "status": "pending",
                "name": row.get::<_, String>(4)?,
                "program_id": row.get::<_, Option<i64>>(5)?,
                "program_name": row.get::<_, Option<String>>(6)?,
                "quick_complete": row.get::<_, Option<i64>>(7)?,
                "template_entry_type": row.get::<_, Option<String>>(8)?,
                "template_work_type": row.get::<_, Option<String>>(9)?,
                "project_id": row.get::<_, Option<i64>>(10)?,
                "item_class": row.get::<_, String>(11)?,
                "recurrence_type": row.get::<_, Option<String>>(12)?,
                "project_name": row.get::<_, Option<String>>(13)?,
                "require_acknowledgment": row.get::<_, Option<i64>>(14)?,
            }))
        })?;

        let mut all_items: Vec<serde_json::Value> = Vec::new();
        for row_result in rows {
            all_items.push(row_result?);
        }

        if all_items.is_empty() {
            None
        } else {
            let count = all_items.len() as i64;
            let items: Vec<serde_json::Value> = all_items.into_iter().take(5).collect();
            Some(serde_json::json!({
                "count": count,
                "items": items,
            }))
        }
    };

    Ok(Json(DashboardResponse {
        entries_this_week,
        entries_this_month,
        entries_this_quarter,
        active_projects,
        goals_on_track,
        goals_at_risk,
        days_since_last_entry,
        weekly_highlight,
        recent_entries,
        gap_dates,
        operational_rhythm_count,
        open_todos,
        open_todos_count,
        program_activity,
        due_today,
        activity_pulse,
        prep_notes,
        report_ready,
    }))
}

/// Query parameters for the heatmap endpoint.
#[derive(Debug, Deserialize)]
pub struct HeatmapQuery {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
}

/// GET /api/dashboard/heatmap — return activity counts by date for the last 90 days.
async fn get_heatmap(
    State(state): State<SharedState>,
    Query(params): Query<HeatmapQuery>,
) -> Result<Json<HeatmapResponse>, AppError> {
    let conn = state.pool.get()?;

    let today = Local::now().date_naive();
    let start = params
        .start_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| today - chrono::Duration::days(90));
    let end = params
        .end_date
        .as_ref()
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or(today);

    // Query entry counts grouped by date and program
    let mut stmt = conn.prepare(
        "SELECT e.entry_date, e.program_id, p.color, COUNT(*) as cnt \
         FROM entries e \
         LEFT JOIN programs p ON p.id = e.program_id \
         WHERE e.entry_date BETWEEN ?1 AND ?2 \
         GROUP BY e.entry_date, e.program_id \
         ORDER BY e.entry_date, cnt DESC",
    )?;

    let rows = stmt.query_map(
        rusqlite::params![start.to_string(), end.to_string()],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
            ))
        },
    )?;

    // Aggregate: per day, pick dominant program (highest count), sum total
    let mut day_data: std::collections::HashMap<String, (i64, Option<i64>, Option<String>, i64)> =
        std::collections::HashMap::new();

    for row_result in rows {
        let (date_str, program_id, color, cnt) = row_result?;
        let entry = day_data
            .entry(date_str)
            .or_insert((0, program_id, color.clone(), cnt));
        entry.0 += cnt;
        if cnt > entry.3 {
            entry.1 = program_id;
            entry.2 = color;
            entry.3 = cnt;
        }
    }

    // Fill in zero-count days for complete range
    let mut days: Vec<HeatmapEntry> = Vec::new();
    let mut current = start;
    while current <= end {
        let d_str = current.to_string();
        if let Some(info) = day_data.get(&d_str) {
            days.push(HeatmapEntry {
                date: d_str,
                count: info.0,
                dominant_program_id: info.1,
                dominant_program_color: info.2.clone(),
            });
        } else {
            days.push(HeatmapEntry {
                date: d_str,
                count: 0,
                dominant_program_id: None,
                dominant_program_color: None,
            });
        }
        current += chrono::Duration::days(1);
    }

    Ok(Json(HeatmapResponse { days }))
}

/// GET /api/dashboard/activity-pulse — return ActivityPulse metrics.
async fn get_activity_pulse(
    State(state): State<SharedState>,
) -> Result<Json<ActivityPulse>, AppError> {
    let conn = state.pool.get()?;

    let today = Local::now().date_naive();
    let days_since_sunday = today.weekday().num_days_from_sunday();
    let week_sunday = today - chrono::Duration::days(days_since_sunday as i64);
    let week_saturday = week_sunday + chrono::Duration::days(6);

    let entries_this_week: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entries WHERE entry_date >= ?1 AND entry_date <= ?2",
        rusqlite::params![week_sunday.to_string(), week_saturday.to_string()],
        |row| row.get(0),
    )?;

    let tasks_completed_this_week: i64 = conn.query_row(
        "SELECT COUNT(*) FROM scheduled_item_instances \
         WHERE status IN ('completed', 'auto_completed') \
         AND due_date >= ?1 AND due_date <= ?2",
        rusqlite::params![week_sunday.to_string(), week_saturday.to_string()],
        |row| row.get(0),
    )?;

    let last_entry_date: Option<String> = conn
        .query_row("SELECT MAX(entry_date) FROM entries", [], |row| row.get(0))
        .unwrap_or(None);

    let days_since = last_entry_date.as_ref().and_then(|d| {
        NaiveDate::parse_from_str(&d[..10.min(d.len())], "%Y-%m-%d")
            .ok()
            .map(|last| (today - last).num_days())
    });

    let time_since_last_entry = match days_since {
        Some(0) => "today".to_string(),
        Some(1) => "1 day ago".to_string(),
        Some(n) => format!("{} days ago", n),
        None => "no entries".to_string(),
    };

    Ok(Json(ActivityPulse {
        entries_this_week,
        tasks_completed_this_week,
        time_since_last_entry,
    }))
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Unit tests for the `get_dashboard` handler field population.
    //!
    //! Covers Requirements 4.1–4.11 in `requirements.md`:
    //!
    //! - 4.1  `recent_entries` returns up to 10 entries ordered by
    //!        `entry_date DESC, created_at DESC, id DESC`.
    //! - 4.2  `open_todos` returns up to 20 action_item entries with
    //!        `status IN ('in_progress', 'ongoing')`.
    //! - 4.3  `open_todos_count` is the uncapped total count with the same
    //!        filter.
    //! - 4.4  `weekly_highlight` returns the single `is_weekly_highlight=1`
    //!        entry in the current Sun-Sat week (local timezone), else null.
    //! - 4.5  `gap_dates` returns the YYYY-MM-DD dates in the current
    //!        Sun-Sat week that have zero entries.
    //! - 4.6  `program_activity` returns one object per active program with
    //!        `program_id`, `program_name`, `entries_this_week`, and
    //!        `scheduled_completion_rate`.
    //! - 4.7  `due_today` returns `{ count, items }` (up to 5 items) when
    //!        pending instances exist today, else null.
    //! - 4.10 JSON shape preservation — fields that should be null stay
    //!        null; fields that should be `[]` stay `[]` (not null).
    //! - 4.11 Any database error triggers HTTP 500 with no partial payload.
    //!
    //! Follows the same test-state/router/`tower::ServiceExt::oneshot`
    //! pattern used in `routes/scheduled.rs` and `routes/data.rs`.

    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
    use chrono::{Datelike, Duration, Local, NaiveDate};
    use std::sync::Arc;
    use tokio::sync::watch;
    use tower::util::ServiceExt;

    // ─── Test fixtures ─────────────────────────────────────────────────────

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
        // acceptable in tests, matches the pattern used in scheduled.rs/data.rs.
        std::mem::forget(dir);

        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    /// Compute (week_sunday, week_saturday) for the current local date — the
    /// same derivation the handler uses so the tests stay in sync on any day.
    fn current_week_bounds() -> (NaiveDate, NaiveDate) {
        let today = Local::now().date_naive();
        let days_since_sunday = today.weekday().num_days_from_sunday() as i64;
        let sunday = today - Duration::days(days_since_sunday);
        let saturday = sunday + Duration::days(6);
        (sunday, saturday)
    }

    /// Today's date in local time, matching the handler.
    fn today_local() -> NaiveDate {
        Local::now().date_naive()
    }

    /// Insert a program. Returns the new id.
    fn insert_program(state: &SharedState, name: &str, status: &str, sort_order: i64) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO programs (name, status, sort_order) VALUES (?1, ?2, ?3) RETURNING id",
            rusqlite::params![name, status, sort_order],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Insert an entry. Accepts common filters via arguments so each test
    /// can shape the row it needs. `program_id` is optional.
    ///
    /// All fields match columns on the `entries` table.
    #[allow(clippy::too_many_arguments)]
    fn insert_entry(
        state: &SharedState,
        entry_date: &str,
        entry_type: &str,
        work_type: &str,
        title: &str,
        status: &str,
        is_weekly_highlight: i64,
        program_id: Option<i64>,
    ) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO entries \
                 (entry_date, entry_type, work_type, title, status, is_weekly_highlight, program_id) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
            rusqlite::params![
                entry_date,
                entry_type,
                work_type,
                title,
                status,
                is_weekly_highlight,
                program_id,
            ],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Insert a scheduled item with sane defaults. Returns the new id.
    ///
    /// `item_class` is either "task" or "cadence"; callers that need the
    /// show_on_today flag cleared should pass a program_id and set it
    /// via a direct update if the default (1) is not acceptable.
    fn insert_scheduled_item(
        state: &SharedState,
        name: &str,
        item_class: &str,
        program_id: Option<i64>,
    ) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO scheduled_items \
                 (name, mode, template_entry_type, template_work_type, \
                  template_visibility, item_class, program_id) \
             VALUES (?1, 'recurring', 'operational_rhythm', 'operational_rhythm', \
                     'shareable', ?2, ?3) RETURNING id",
            rusqlite::params![name, item_class, program_id],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Insert an instance for a scheduled item. Returns the new id.
    fn insert_instance(
        state: &SharedState,
        item_id: i64,
        due_date: &str,
        status: &str,
        due_time: Option<&str>,
    ) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO scheduled_item_instances \
                 (scheduled_item_id, due_date, due_time, status) \
             VALUES (?1, ?2, ?3, ?4) RETURNING id",
            rusqlite::params![item_id, due_date, due_time, status],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// GET `/api/dashboard` and return `(status, body_json)`.
    async fn get_dashboard_response(state: SharedState) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/dashboard")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    // ─── Unit tests ────────────────────────────────────────────────────────

    /// Requirement 4.10: on an empty database every collection field is an
    /// empty array (not null) and every nullable field is null (not an empty
    /// object). This locks down the JSON shape the frontend expects.
    #[tokio::test]
    async fn empty_db_preserves_json_shape() {
        let state = test_state();
        let (status, json) = get_dashboard_response(state).await;

        assert_eq!(status, StatusCode::OK);

        // Arrays stay arrays — never null, never missing.
        assert!(json["recent_entries"].is_array());
        assert_eq!(json["recent_entries"].as_array().unwrap().len(), 0);
        assert!(json["open_todos"].is_array());
        assert_eq!(json["open_todos"].as_array().unwrap().len(), 0);
        assert!(json["gap_dates"].is_array());
        // Every day of the week is a gap when there are no entries.
        assert_eq!(json["gap_dates"].as_array().unwrap().len(), 7);
        assert!(json["program_activity"].is_array());
        assert_eq!(json["program_activity"].as_array().unwrap().len(), 0);
        assert!(json["prep_notes"].is_array());

        // Nullable fields — the handler uses
        // `#[serde(skip_serializing_if = "Option::is_none")]` so they are
        // absent in the payload, which the frontend treats identically to
        // JSON null. Assert absence here; both outcomes satisfy 4.10.
        assert!(json.get("weekly_highlight").is_none_or(|v| v.is_null()));
        assert!(json.get("due_today").is_none_or(|v| v.is_null()));
        assert!(json.get("report_ready").is_none_or(|v| v.is_null()));

        // Scalar counts default to zero.
        assert_eq!(json["open_todos_count"], 0);
        assert_eq!(json["entries_this_week"], 0);
    }

    /// Requirement 4.1: `recent_entries` returns up to 10 entries ordered
    /// `entry_date DESC, created_at DESC, id DESC`. Seed 12 entries across
    /// three distinct `entry_date` values and assert the cap plus the order.
    #[tokio::test]
    async fn recent_entries_returns_up_to_10_in_expected_order() {
        let state = test_state();

        // Seed 12 entries. Use three entry_dates so we can verify the primary
        // sort; within each date, multiple inserts give the tie-break a
        // chance to matter (later-inserted → higher id/created_at → first).
        let dates = [
            "2026-01-20",
            "2026-01-19",
            "2026-01-18",
        ];
        let mut ids_in_insert_order: Vec<i64> = Vec::new();
        for i in 0..12 {
            let id = insert_entry(
                &state,
                dates[i % 3],
                "quick_capture",
                "operational_rhythm",
                &format!("Entry {}", i),
                "completed",
                0,
                None,
            );
            ids_in_insert_order.push(id);
        }

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let recent = json["recent_entries"].as_array().unwrap();
        // 4.1: cap at 10.
        assert_eq!(recent.len(), 10);

        // 4.1: ordering — entry_date DESC, then created_at DESC, then id DESC.
        // Collect (entry_date, id) tuples and verify monotonic non-increasing.
        let mut prev_date: Option<String> = None;
        let mut prev_id_within_date: Option<i64> = None;
        for item in recent {
            let date = item["entry_date"].as_str().unwrap().to_string();
            let id = item["id"].as_i64().unwrap();
            if let Some(p_date) = &prev_date {
                assert!(
                    date.as_str() <= p_date.as_str(),
                    "entry_date not sorted descending: saw {} after {}",
                    date,
                    p_date,
                );
                if date == *p_date {
                    let prev_id = prev_id_within_date.unwrap();
                    assert!(
                        id <= prev_id,
                        "id within same entry_date not sorted desc: {} after {}",
                        id,
                        prev_id,
                    );
                }
            }
            prev_id_within_date = if prev_date.as_ref() == Some(&date) {
                Some(id)
            } else {
                Some(id)
            };
            prev_date = Some(date);
        }
    }

    /// Requirement 4.2 & 4.3: `open_todos` filters `action_item` entries with
    /// `status IN ('in_progress','ongoing')` and caps at 20; the uncapped
    /// total appears in `open_todos_count`. Non-matching entries (wrong
    /// type or wrong status) MUST be excluded.
    #[tokio::test]
    async fn open_todos_filters_action_items_by_status() {
        let state = test_state();

        // 5 matching action_items with in_progress/ongoing status — should appear.
        for i in 0..3 {
            insert_entry(
                &state,
                "2026-01-15",
                "action_item",
                "operational_rhythm",
                &format!("Open todo {}", i),
                "in_progress",
                0,
                None,
            );
        }
        for i in 0..2 {
            insert_entry(
                &state,
                "2026-01-14",
                "action_item",
                "operational_rhythm",
                &format!("Ongoing todo {}", i),
                "ongoing",
                0,
                None,
            );
        }

        // Non-matching: completed action_item (should be excluded).
        insert_entry(
            &state,
            "2026-01-15",
            "action_item",
            "operational_rhythm",
            "Done todo",
            "completed",
            0,
            None,
        );

        // Non-matching: quick_capture in_progress (should be excluded — wrong type).
        insert_entry(
            &state,
            "2026-01-15",
            "quick_capture",
            "operational_rhythm",
            "Not an action item",
            "in_progress",
            0,
            None,
        );

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let open = json["open_todos"].as_array().unwrap();
        // 4.2: 5 matching entries, well under the 20 cap.
        assert_eq!(open.len(), 5);
        for item in open {
            assert_eq!(item["entry_type"], "action_item");
            let s = item["status"].as_str().unwrap();
            assert!(
                s == "in_progress" || s == "ongoing",
                "unexpected status in open_todos: {}",
                s,
            );
        }

        // 4.3: uncapped count matches the filter.
        assert_eq!(json["open_todos_count"], 5);
    }

    /// Requirement 4.3: when the matching set exceeds the 20 cap, the array
    /// still holds 20 items but `open_todos_count` reports the true total.
    #[tokio::test]
    async fn open_todos_count_is_uncapped_when_items_exceed_cap() {
        let state = test_state();

        // 25 action_items in_progress — cap is 20, count reports 25.
        for i in 0..25 {
            insert_entry(
                &state,
                "2026-01-15",
                "action_item",
                "operational_rhythm",
                &format!("Todo {}", i),
                "in_progress",
                0,
                None,
            );
        }

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        assert_eq!(json["open_todos"].as_array().unwrap().len(), 20);
        assert_eq!(json["open_todos_count"], 25);
    }

    /// Requirement 4.4: `weekly_highlight` returns the entry with
    /// `is_weekly_highlight = 1` in the current Sun-Sat week. Outside-week
    /// highlights are ignored.
    #[tokio::test]
    async fn weekly_highlight_returns_highlighted_entry_in_current_week() {
        let state = test_state();
        let (sunday, _saturday) = current_week_bounds();

        // Non-highlight this week — should NOT be picked.
        insert_entry(
            &state,
            &sunday.to_string(),
            "quick_capture",
            "operational_rhythm",
            "Normal entry this week",
            "completed",
            0,
            None,
        );

        // Highlight this week — SHOULD be picked.
        let highlight_id = insert_entry(
            &state,
            &sunday.to_string(),
            "milestone",
            "operational_rhythm",
            "The highlight of the week",
            "completed",
            1,
            None,
        );

        // Highlight outside the week (1 week before) — should NOT be picked.
        let outside = sunday - Duration::days(7);
        insert_entry(
            &state,
            &outside.to_string(),
            "milestone",
            "operational_rhythm",
            "Last week's highlight",
            "completed",
            1,
            None,
        );

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let hl = &json["weekly_highlight"];
        assert!(hl.is_object(), "weekly_highlight should be populated");
        assert_eq!(hl["id"], highlight_id);
        assert_eq!(hl["is_weekly_highlight"], 1);
        assert_eq!(hl["title"], "The highlight of the week");
    }

    /// Requirement 4.4: `weekly_highlight` is null (or absent) when no entry
    /// in the current week has `is_weekly_highlight = 1`.
    #[tokio::test]
    async fn weekly_highlight_null_when_none_in_week() {
        let state = test_state();
        let (sunday, _saturday) = current_week_bounds();

        // Entry this week but not highlighted.
        insert_entry(
            &state,
            &sunday.to_string(),
            "quick_capture",
            "operational_rhythm",
            "Not a highlight",
            "completed",
            0,
            None,
        );

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        // Either absent (Option serialized with skip_serializing_if=None) or null.
        assert!(
            json.get("weekly_highlight").is_none_or(|v| v.is_null()),
            "expected weekly_highlight to be null or absent, got {:?}",
            json.get("weekly_highlight"),
        );
    }

    /// Requirement 4.5: `gap_dates` returns the YYYY-MM-DD dates in the
    /// current Sun-Sat week that have zero entries. When the week is fully
    /// empty, every day is a gap. When one day has an entry, that day is
    /// excluded.
    #[tokio::test]
    async fn gap_dates_returns_dates_without_entries_in_current_week() {
        let state = test_state();
        let (sunday, _saturday) = current_week_bounds();

        // Seed entries on Sunday and Wednesday of this week.
        let wednesday = sunday + Duration::days(3);
        insert_entry(
            &state,
            &sunday.to_string(),
            "quick_capture",
            "operational_rhythm",
            "Sunday entry",
            "completed",
            0,
            None,
        );
        insert_entry(
            &state,
            &wednesday.to_string(),
            "quick_capture",
            "operational_rhythm",
            "Wednesday entry",
            "completed",
            0,
            None,
        );

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let gaps: Vec<String> = json["gap_dates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect();

        // Exactly 5 gap days (7 days in week − 2 with entries).
        assert_eq!(gaps.len(), 5);
        // Sunday and Wednesday MUST NOT appear.
        assert!(!gaps.contains(&sunday.to_string()));
        assert!(!gaps.contains(&wednesday.to_string()));
        // Every gap date MUST be within the current week.
        for g in &gaps {
            let parsed = NaiveDate::parse_from_str(g, "%Y-%m-%d").unwrap();
            assert!(
                parsed >= sunday && parsed <= sunday + Duration::days(6),
                "gap date {} outside current week [{}..{}]",
                g,
                sunday,
                sunday + Duration::days(6),
            );
        }
    }

    /// Requirement 4.6: `program_activity` returns one object per active
    /// program with `program_id`, `program_name`, `entries_this_week`, and
    /// `scheduled_completion_rate`. Paused programs are excluded. The rate
    /// is `(completed + auto_completed) / total` over instances with
    /// `due_date >= today - 30 days`, and 0.0 when there are no instances.
    #[tokio::test]
    async fn program_activity_aggregates_per_active_program() {
        let state = test_state();
        let (sunday, _saturday) = current_week_bounds();
        let today = today_local();

        // Active program with activity.
        let active_id = insert_program(&state, "Active Prog", "active", 0);
        // Paused program — MUST NOT appear in program_activity.
        let _paused_id = insert_program(&state, "Paused Prog", "paused", 1);

        // 2 entries this week against the active program.
        insert_entry(
            &state,
            &sunday.to_string(),
            "quick_capture",
            "operational_rhythm",
            "This week 1",
            "completed",
            0,
            Some(active_id),
        );
        insert_entry(
            &state,
            &(sunday + Duration::days(1)).to_string(),
            "quick_capture",
            "operational_rhythm",
            "This week 2",
            "completed",
            0,
            Some(active_id),
        );

        // Scheduled item + instances for completion rate (last 30 days).
        // 4 total: 2 completed, 1 auto_completed, 1 pending → rate 3/4 = 0.75.
        let item_id = insert_scheduled_item(&state, "Daily standup", "cadence", Some(active_id));
        let recent_due = (today - Duration::days(5)).to_string();
        insert_instance(&state, item_id, &recent_due, "completed", None);
        insert_instance(
            &state,
            item_id,
            &(today - Duration::days(6)).to_string(),
            "completed",
            None,
        );
        insert_instance(
            &state,
            item_id,
            &(today - Duration::days(7)).to_string(),
            "auto_completed",
            None,
        );
        insert_instance(
            &state,
            item_id,
            &(today - Duration::days(8)).to_string(),
            "pending",
            None,
        );

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let pa = json["program_activity"].as_array().unwrap();
        // Only the active program is present.
        assert_eq!(pa.len(), 1);
        let row = &pa[0];
        assert_eq!(row["program_id"], active_id);
        assert_eq!(row["program_name"], "Active Prog");
        assert_eq!(row["entries_this_week"], 2);
        // 3 (completed + auto_completed) / 4 (total) = 0.75.
        let rate = row["scheduled_completion_rate"].as_f64().unwrap();
        assert!(
            (rate - 0.75).abs() < 1e-9,
            "expected completion rate 0.75, got {}",
            rate,
        );
    }

    /// Requirement 4.6: an active program with zero scheduled instances has
    /// `scheduled_completion_rate = 0.0` (no division-by-zero; no null).
    #[tokio::test]
    async fn program_activity_rate_is_zero_when_no_instances() {
        let state = test_state();
        let id = insert_program(&state, "Fresh Prog", "active", 0);

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let pa = json["program_activity"].as_array().unwrap();
        assert_eq!(pa.len(), 1);
        assert_eq!(pa[0]["program_id"], id);
        assert_eq!(pa[0]["entries_this_week"], 0);
        let rate = pa[0]["scheduled_completion_rate"].as_f64().unwrap();
        assert_eq!(rate, 0.0);
    }

    /// Requirement 4.7: `due_today` returns `{ count, items }` when pending
    /// instances exist for today. The `items` array is capped at 5 and
    /// ordered by `due_time ASC NULLS LAST, scheduled_item_id ASC`.
    #[tokio::test]
    async fn due_today_returns_count_and_up_to_5_items() {
        let state = test_state();
        let today = today_local().to_string();

        // 6 task items, all pending today — count should be 6, items 5.
        let mut item_ids: Vec<i64> = Vec::new();
        for i in 0..6 {
            let id = insert_scheduled_item(&state, &format!("Task {}", i), "task", None);
            item_ids.push(id);
            // Give earlier items later due_times so we can verify ordering
            // by due_time ASC.
            let due_time = format!("{:02}:00", 23 - i);
            insert_instance(&state, id, &today, "pending", Some(&due_time));
        }

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        let due = &json["due_today"];
        assert!(due.is_object(), "due_today should be populated");
        assert_eq!(due["count"], 6);
        let items = due["items"].as_array().unwrap();
        assert_eq!(items.len(), 5);

        // Ordering: due_time ASC — so earliest time (18:00) comes first.
        let times: Vec<&str> = items
            .iter()
            .map(|i| i["due_time"].as_str().unwrap())
            .collect();
        let mut sorted = times.clone();
        sorted.sort();
        assert_eq!(
            times, sorted,
            "items not ordered by due_time ASC",
        );

        for item in items {
            assert_eq!(item["due_date"], today);
            assert_eq!(item["status"], "pending");
        }
    }

    /// Requirement 4.7: `due_today` is null (or absent) when no pending
    /// instances are due today.
    #[tokio::test]
    async fn due_today_is_null_when_no_pending_instances() {
        let state = test_state();
        let today = today_local().to_string();

        // Seed a completed instance today — should NOT count as "due today".
        let item_id = insert_scheduled_item(&state, "Done task", "task", None);
        insert_instance(&state, item_id, &today, "completed", None);

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::OK);

        assert!(
            json.get("due_today").is_none_or(|v| v.is_null()),
            "expected due_today to be null or absent, got {:?}",
            json.get("due_today"),
        );
    }

    /// Requirement 4.11: if any query in the dashboard handler hits a
    /// database error, the response MUST be HTTP 500 with no partial
    /// payload. Simulated here by dropping the `entries` table before the
    /// request — the first entry-dependent query fails with a
    /// `rusqlite::Error::SqliteFailure`, which `AppError::Database` maps
    /// to 500 with `{"detail": "Database error"}`.
    ///
    /// The underlying r2d2 pool already runs each connection in WAL mode
    /// with foreign-key enforcement; handler queries use the pooled
    /// connection directly (no explicit `BEGIN`), so propagating the
    /// error via `?` short-circuits before any payload is constructed.
    /// No explicit rollback step is needed because no write has started.
    #[tokio::test]
    async fn db_error_returns_500_with_no_partial_payload() {
        let state = test_state();

        // Drop a table the handler reads to force a `rusqlite` error when
        // any entry query runs. `scheduled_item_instances` is referenced
        // early in the handler (tasks_completed_this_week), so the failure
        // happens before any field-population work starts.
        {
            let conn = state.pool.get().unwrap();
            conn.execute("DROP TABLE scheduled_item_instances", [])
                .unwrap();
        }

        let (status, json) = get_dashboard_response(state).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        // 4.11: no partial payload — only the error envelope is returned.
        assert_eq!(json["detail"], "Database error");
        // Assert none of the dashboard fields leaked into the error body.
        assert!(json.get("recent_entries").is_none());
        assert!(json.get("open_todos").is_none());
        assert!(json.get("gap_dates").is_none());
    }
}
