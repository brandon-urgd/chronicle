//! Backup routes: auto/manual backup, list backups, restore/import placeholders, export.
//!
//! Implements 6 routes matching the Python FastAPI backend.

use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Local};
use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::BackupInfo;

/// Backup is considered stale when the most recent file is older than this
/// many calendar days (per Requirement 6.6).
const BACKUP_STALE_THRESHOLD_DAYS: i64 = 7;

/// Build the backup sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/backup/auto", post(backup_auto))
        .route("/api/backup/manual", post(backup_manual))
        .route("/api/backup/status", get(get_backup_status))
        .route("/api/backups", get(list_backups))
        .route("/api/restore", post(restore_placeholder))
        .route("/api/import", post(import_placeholder))
        .route("/api/export", post(export_data))
        .with_state(state)
}

/// POST /api/backup/auto — create a timestamped auto-backup of the database.
async fn backup_auto(
    State(state): State<SharedState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = create_backup(&state, "auto");
    match result {
        Ok(info) => Ok(Json(serde_json::json!({
            "success": true,
            "filename": info.filename,
            "backup_date": info.created_at,
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "success": false,
            "error": e.to_string(),
        }))),
    }
}

/// POST /api/backup/manual — create a timestamped manual backup of the database.
async fn backup_manual(
    State(state): State<SharedState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = create_backup(&state, "manual");
    match result {
        Ok(info) => Ok(Json(serde_json::json!({
            "success": true,
            "filename": info.filename,
            "backup_date": info.created_at,
        }))),
        Err(e) => Ok(Json(serde_json::json!({
            "success": false,
            "error": e.to_string(),
        }))),
    }
}

/// GET /api/backup/status — summary of the backup directory for the
/// frontend's BackupIndicator.
///
/// Returns per Requirement 6.6:
/// - `last_backup_date`: ISO 8601 modification time of the newest backup
///   file, or `null` when no backups exist.
/// - `days_since_last_backup`: integer number of calendar days between the
///   newest backup's modification time and "now" in Local_Timezone, or
///   `null` when no backups exist.
/// - `backup_count`: total number of `chronicle_*.db` files in `backups/`.
/// - `is_stale`: `true` when no backups exist OR when
///   `days_since_last_backup > 7`.
///
/// Also emits `stale` (alias of `is_stale`) and `last_backup_filename` so
/// the existing `BackupIndicator.tsx` component continues to work without
/// frontend changes.
async fn get_backup_status(
    State(state): State<SharedState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let backups_dir = state.config.data_dir.join("backups");
    let newest = find_newest_backup(&backups_dir)?;
    let backup_count = newest.as_ref().map(|n| n.total_count).unwrap_or(0);

    let (last_backup_date, last_backup_filename, days_since_last_backup, is_stale) = match newest {
        Some(info) => {
            let days = days_since(info.modified, SystemTime::now());
            let stale = days > BACKUP_STALE_THRESHOLD_DAYS;
            (
                Some(format_local_iso(info.modified)),
                Some(info.filename),
                Some(days),
                stale,
            )
        }
        None => (None, None, None, true),
    };

    Ok(Json(serde_json::json!({
        "last_backup_date": last_backup_date,
        "last_backup_filename": last_backup_filename,
        "days_since_last_backup": days_since_last_backup,
        "backup_count": backup_count,
        "is_stale": is_stale,
        // Alias retained for frontend compatibility.
        "stale": is_stale,
    })))
}

/// GET /api/backups — list available backup files in the backups/ directory.
async fn list_backups(
    State(state): State<SharedState>,
) -> Result<Json<Vec<BackupInfo>>, AppError> {
    let backups_dir = state.config.data_dir.join("backups");

    if !backups_dir.is_dir() {
        return Ok(Json(vec![]));
    }

    let mut backups: Vec<BackupInfo> = Vec::new();

    let entries = fs::read_dir(&backups_dir).map_err(|e| {
        AppError::Internal(format!("Failed to read backups directory: {}", e))
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                let metadata = fs::metadata(&path).ok();
                let size = metadata.as_ref().map(|m| m.len() as i64).unwrap_or(0);
                let created_at = metadata
                    .and_then(|m| m.modified().ok())
                    .map(|t| {
                        let datetime: chrono::DateTime<Local> = t.into();
                        datetime.format("%Y-%m-%dT%H:%M:%S").to_string()
                    })
                    .unwrap_or_default();

                backups.push(BackupInfo {
                    filename: filename.to_string(),
                    size,
                    created_at,
                });
            }
        }
    }

    // Sort by filename descending (most recent first)
    backups.sort_by(|a, b| b.filename.cmp(&a.filename));

    Ok(Json(backups))
}

/// POST /api/restore — placeholder (501 Not Implemented).
async fn restore_placeholder() -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "detail": "Restore functionality not yet implemented"
        })),
    ))
}

/// POST /api/import — placeholder (501 Not Implemented).
async fn import_placeholder() -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "detail": "Import functionality not yet implemented"
        })),
    ))
}

/// POST /api/export — full data export as JSON (query all tables).
///
/// Public so `data.rs` can register the same handler at `/api/data/export`.
pub async fn export_data(
    State(state): State<SharedState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let conn = state.pool.get()?;

    let tables = [
        "programs",
        "goals",
        "projects",
        "entries",
        "scheduled_items",
        "scheduled_item_instances",
        "goal_progress_log",
        "project_progress_log",
        "program_progress_log",
        "lessons_learned",
        "tags",
        "entry_tags",
        "lesson_tags",
        "links",
        "attachments",
        "settings",
        "review_sessions",
        "review_notes",
        "stakeholders",
        "project_stakeholders",
        "report_presets",
        "notes",
        "report_drafts",
    ];

    let mut data = serde_json::Map::new();
    let mut table_counts = serde_json::Map::new();

    for table in &tables {
        let rows = export_table(&conn, table)?;
        table_counts.insert(
            table.to_string(),
            serde_json::Value::Number(serde_json::Number::from(rows.len() as i64)),
        );
        data.insert(table.to_string(), serde_json::Value::Array(rows));
    }

    let export = serde_json::json!({
        "chronicle_version": env!("CARGO_PKG_VERSION"),
        "schema_version": "3",
        "export_date": Local::now().format("%Y-%m-%dT%H:%M:%S").to_string(),
        "table_counts": table_counts,
        "data": data,
    });

    Ok(Json(export))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Summary of the newest backup file discovered in a backups directory.
struct NewestBackup {
    filename: String,
    modified: SystemTime,
    /// Total count of matching backup files in the directory (including
    /// this one). Tracked here so callers only walk the directory once.
    total_count: i64,
}

/// Scan `backups_dir` for `chronicle_*.db` files and return the one with
/// the most recent modification time, along with the total match count.
///
/// Returns `Ok(None)` when the directory does not exist or contains no
/// matching files. Returns `Err(AppError::Io)` only when the directory
/// exists but cannot be read.
fn find_newest_backup(backups_dir: &PathBuf) -> Result<Option<NewestBackup>, AppError> {
    if !backups_dir.is_dir() {
        return Ok(None);
    }

    let entries = fs::read_dir(backups_dir)?;

    let mut total_count: i64 = 0;
    let mut newest: Option<(String, SystemTime)> = None;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(filename) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };

        if !is_backup_filename(filename) {
            continue;
        }

        total_count += 1;

        let Ok(meta) = fs::metadata(&path) else { continue };
        let Ok(modified) = meta.modified() else { continue };

        match &newest {
            Some((_, existing)) if *existing >= modified => {}
            _ => newest = Some((filename.to_string(), modified)),
        }
    }

    Ok(newest.map(|(filename, modified)| NewestBackup {
        filename,
        modified,
        total_count,
    }))
}

/// Whether `filename` looks like a Chronicle backup file (matches the
/// shape produced by `create_backup`: `chronicle_<prefix>_<timestamp>.db`).
fn is_backup_filename(filename: &str) -> bool {
    filename.starts_with("chronicle_") && filename.ends_with(".db")
}

/// Format a `SystemTime` as a local-timezone ISO 8601 string, matching the
/// existing `BackupInfo.created_at` format used by `/api/backups`.
fn format_local_iso(t: SystemTime) -> String {
    let datetime: DateTime<Local> = t.into();
    datetime.format("%Y-%m-%dT%H:%M:%S").to_string()
}

/// Calendar-day difference between `past` and `now` in the local timezone.
///
/// Clamped to `0` when `past` is in the future (clock skew between the
/// filesystem and the app process) so we never return a negative day
/// count to the frontend.
fn days_since(past: SystemTime, now: SystemTime) -> i64 {
    let past_local: DateTime<Local> = past.into();
    let now_local: DateTime<Local> = now.into();
    let past_day = past_local.date_naive();
    let now_day = now_local.date_naive();
    let diff = now_day.signed_duration_since(past_day).num_days();
    diff.max(0)
}

/// Create a backup by copying the database file to the backups/ directory.
fn create_backup(state: &SharedState, prefix: &str) -> Result<BackupInfo, AppError> {
    let backups_dir = state.config.data_dir.join("backups");
    fs::create_dir_all(&backups_dir)?;

    let now = Local::now();
    let filename = format!(
        "chronicle_{}_{}.db",
        prefix,
        now.format("%Y%m%d_%H%M%S")
    );
    let dest_path = backups_dir.join(&filename);

    // Copy the database file
    let db_path = &state.config.db_path;
    if db_path.exists() {
        fs::copy(db_path, &dest_path)?;
    } else {
        return Err(AppError::Internal("Database file not found".to_string()));
    }

    let size = fs::metadata(&dest_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);

    Ok(BackupInfo {
        filename,
        size,
        created_at: now.format("%Y-%m-%dT%H:%M:%S").to_string(),
    })
}

/// Export all rows from a table as a Vec of JSON objects.
fn export_table(
    conn: &rusqlite::Connection,
    table: &str,
) -> Result<Vec<serde_json::Value>, AppError> {
    // Use a safe table name (all our tables are known constants)
    let sql = format!("SELECT * FROM {}", table);
    let mut stmt = conn.prepare(&sql)?;

    let column_count = stmt.column_count();
    let column_names: Vec<String> = (0..column_count)
        .map(|i| stmt.column_name(i).unwrap_or("").to_string())
        .collect();

    let rows = stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, col_name) in column_names.iter().enumerate() {
            let value = match row.get_ref(i) {
                Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                Ok(rusqlite::types::ValueRef::Integer(n)) => {
                    serde_json::Value::Number(serde_json::Number::from(n))
                }
                Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::Number::from_f64(f)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null),
                Ok(rusqlite::types::ValueRef::Text(t)) => {
                    serde_json::Value::String(String::from_utf8_lossy(t).into_owned())
                }
                Ok(rusqlite::types::ValueRef::Blob(b)) => {
                    serde_json::Value::String(base64_encode(b))
                }
                Err(_) => serde_json::Value::Null,
            };
            obj.insert(col_name.clone(), value);
        }
        Ok(serde_json::Value::Object(obj))
    })?;

    let result: Vec<serde_json::Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(result)
}

/// Simple base64 encoding for blob data in exports.
fn base64_encode(data: &[u8]) -> String {
    
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Unit tests for the backup status endpoint (Requirement 6.6).
    //!
    //! Follows the same test-state/router pattern used in `data.rs` and
    //! `scheduled.rs`: a temp-dir SQLite database with the full production
    //! schema installed, an `Arc<AppState>` built by hand, and
    //! `tower::ServiceExt::oneshot` to drive the router.

    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::watch;
    use tower::util::ServiceExt;

    // ─── Test fixtures ─────────────────────────────────────────────────────

    /// Build a `SharedState` backed by a temp-dir SQLite database with the
    /// full production schema initialized. Matches the pattern used in
    /// `data.rs` and `scheduled.rs`.
    fn test_state() -> SharedState {
        let dir = tempfile::tempdir().unwrap();
        let config = AppConfig {
            db_path: dir.path().join("test.db"),
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };
        let pool = init_pool(&config).unwrap();

        let conn = pool.get().unwrap();
        initialize_schema(&conn).unwrap();
        drop(conn);

        // Keep the temp dir alive for the lifetime of the pool by leaking
        // it — the same trick used elsewhere in the crate's tests.
        std::mem::forget(dir);

        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    /// Write a file at `<data_dir>/backups/<name>` with trivial contents so
    /// it shows up in `fs::read_dir`. Creates the `backups/` directory on
    /// demand.
    fn write_backup_file(state: &SharedState, name: &str) -> PathBuf {
        let backups_dir = state.config.data_dir.join("backups");
        fs::create_dir_all(&backups_dir).unwrap();
        let path = backups_dir.join(name);
        fs::write(&path, b"dummy backup contents").unwrap();
        path
    }

    /// GET `/api/backup/status` and return `(status, body_json)`.
    async fn get_status(state: SharedState) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("GET")
            .uri("/api/backup/status")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    // ─── Handler tests ─────────────────────────────────────────────────────

    /// Requirement 6.6: when no backups exist, all fields SHALL be null
    /// except `is_stale=true` and `backup_count=0`. Covers the "fresh
    /// install" case where `backups/` has not been created yet.
    #[tokio::test]
    async fn backup_status_with_no_backups_directory_returns_nulls_and_is_stale() {
        let state = test_state();
        // Deliberately do NOT create the backups/ directory.

        let (status, body) = get_status(state).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["last_backup_date"].is_null());
        assert!(body["last_backup_filename"].is_null());
        assert!(body["days_since_last_backup"].is_null());
        assert_eq!(body["backup_count"].as_i64().unwrap(), 0);
        assert_eq!(body["is_stale"].as_bool().unwrap(), true);
        // Frontend alias preserved.
        assert_eq!(body["stale"].as_bool().unwrap(), true);
    }

    /// Same contract as the previous test, but the `backups/` directory
    /// exists and is simply empty — ensures we don't treat an empty dir
    /// differently from a missing one.
    #[tokio::test]
    async fn backup_status_with_empty_backups_directory_returns_nulls_and_is_stale() {
        let state = test_state();
        fs::create_dir_all(state.config.data_dir.join("backups")).unwrap();

        let (status, body) = get_status(state).await;

        assert_eq!(status, StatusCode::OK);
        assert!(body["last_backup_date"].is_null());
        assert!(body["last_backup_filename"].is_null());
        assert!(body["days_since_last_backup"].is_null());
        assert_eq!(body["backup_count"].as_i64().unwrap(), 0);
        assert_eq!(body["is_stale"].as_bool().unwrap(), true);
    }

    /// Requirement 6.6 happy path: when fresh backups exist, the handler
    /// SHALL return the newest filename, a non-null date, a small
    /// `days_since_last_backup`, a matching `backup_count`, and
    /// `is_stale=false`.
    #[tokio::test]
    async fn backup_status_with_recent_backups_reports_count_and_not_stale() {
        let state = test_state();
        write_backup_file(&state, "chronicle_auto_20250101_100000.db");
        // Ensure mtimes are distinct so the "newest" pick is deterministic.
        std::thread::sleep(Duration::from_millis(20));
        write_backup_file(&state, "chronicle_manual_20250102_090000.db");
        std::thread::sleep(Duration::from_millis(20));
        let newest_path = write_backup_file(&state, "chronicle_auto_20250102_150000.db");

        let (status, body) = get_status(state).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["backup_count"].as_i64().unwrap(), 3);
        assert_eq!(
            body["is_stale"].as_bool().unwrap(),
            false,
            "backups written seconds ago SHALL NOT be marked stale"
        );
        assert_eq!(body["stale"].as_bool().unwrap(), false);
        assert_eq!(
            body["last_backup_filename"].as_str().unwrap(),
            newest_path.file_name().unwrap().to_str().unwrap(),
            "last_backup_filename SHALL be the most-recently-modified file"
        );
        // Files written moments ago are on the same local calendar day as
        // "now", so the day difference is 0.
        assert_eq!(body["days_since_last_backup"].as_i64().unwrap(), 0);
        let iso = body["last_backup_date"].as_str().unwrap();
        assert!(
            iso.len() >= 19 && iso.contains('T'),
            "last_backup_date SHALL be ISO 8601, got {iso}"
        );
    }

    /// Non-backup files in the `backups/` directory SHALL NOT inflate the
    /// count or be picked as the newest file.
    #[tokio::test]
    async fn backup_status_ignores_non_backup_files() {
        let state = test_state();
        // Only one valid backup.
        write_backup_file(&state, "chronicle_auto_20250101_100000.db");
        // These should all be ignored by `is_backup_filename`.
        write_backup_file(&state, "README.txt");
        write_backup_file(&state, "notes.db");
        write_backup_file(&state, "chronicle_auto_20250101_100000.db.tmp");

        let (status, body) = get_status(state).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body["backup_count"].as_i64().unwrap(),
            1,
            "non-backup files SHALL NOT count toward backup_count"
        );
        assert_eq!(
            body["last_backup_filename"].as_str().unwrap(),
            "chronicle_auto_20250101_100000.db"
        );
    }

    // ─── Helper tests ──────────────────────────────────────────────────────

    /// `is_backup_filename` accepts the shape `create_backup` produces and
    /// rejects everything else.
    #[test]
    fn is_backup_filename_matches_create_backup_output() {
        assert!(is_backup_filename("chronicle_auto_20250101_100000.db"));
        assert!(is_backup_filename("chronicle_manual_20261231_235959.db"));

        assert!(!is_backup_filename("chronicle_auto_20250101_100000.db.tmp"));
        assert!(!is_backup_filename("notes.db"));
        assert!(!is_backup_filename("chronicle.log"));
        assert!(!is_backup_filename("README.txt"));
        assert!(!is_backup_filename(""));
    }

    /// `days_since` SHALL return calendar-day differences in local time
    /// and SHALL clamp negative diffs (clock skew) to zero.
    #[test]
    fn days_since_returns_calendar_day_difference() {
        let now = SystemTime::now();

        // Same instant → 0 days.
        assert_eq!(days_since(now, now), 0);

        // 10 days in the past → ~10 days (allow ±1 for midnight crossings
        // between the `past` and `now` evaluations in the implementation).
        let past = now - Duration::from_secs(10 * 86_400);
        let diff = days_since(past, now);
        assert!(
            (9..=11).contains(&diff),
            "expected ~10 days, got {diff}"
        );

        // "Past" is actually in the future → clamped to 0.
        let future = now + Duration::from_secs(2 * 86_400);
        assert_eq!(
            days_since(future, now),
            0,
            "future timestamps SHALL clamp to 0"
        );
    }

    /// `find_newest_backup` returns `None` when the directory does not
    /// exist, matching the "fresh install" branch of the handler.
    #[test]
    fn find_newest_backup_missing_dir_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let result = find_newest_backup(&missing).unwrap();
        assert!(result.is_none());
    }

    /// `find_newest_backup` picks the most-recently-modified matching file
    /// and reports the total count of matching files.
    #[test]
    fn find_newest_backup_picks_most_recent_file() {
        let dir = tempfile::tempdir().unwrap();
        let backups_dir = dir.path().to_path_buf();

        fs::write(backups_dir.join("chronicle_auto_a.db"), b"a").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(backups_dir.join("chronicle_auto_b.db"), b"b").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::write(backups_dir.join("chronicle_manual_c.db"), b"c").unwrap();
        // Non-backup file — should be ignored.
        fs::write(backups_dir.join("unrelated.txt"), b"x").unwrap();

        let newest = find_newest_backup(&backups_dir).unwrap().unwrap();
        assert_eq!(newest.filename, "chronicle_manual_c.db");
        assert_eq!(newest.total_count, 3);
    }
}
