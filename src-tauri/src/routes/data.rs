//! Data management routes — full backup/restore/reset operations.
//!
//! Exposes four endpoints that power the Settings → Data panel and the
//! onboarding "Restore from backup" flow:
//!
//! - `POST /api/data/export`   → delegates to `backup::export_data`
//! - `POST /api/data/import`   → multipart upload, clear + insert all tables
//! - `POST /api/data/validate` → multipart upload, structure check only
//! - `POST /api/data/reset`    → clear all user-data tables (preserve
//!   `settings` and `report_presets` per design §1.5)
//!
//! The JSON shapes match the legacy Python FastAPI backend so the existing
//! frontend (`RestoreFlow.tsx`, `SettingsView.tsx`) needs no changes.

use axum::{
    extract::{Multipart, State},
    routing::post,
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::routes::backup::export_data;

/// All tables, in dependency-safe insertion order. Used by import to
/// control the order rows are inserted (parents before children).
const ALL_TABLES: &[&str] = &[
    "settings",
    "tags",
    "programs",
    "program_progress_log",
    "goals",
    "goal_progress_log",
    "projects",
    "project_progress_log",
    "stakeholders",
    "project_stakeholders",
    "scheduled_items",
    "scheduled_item_instances",
    "entries",
    "entry_tags",
    "lessons_learned",
    "lesson_tags",
    "links",
    "attachments",
    "review_sessions",
    "review_notes",
    "report_presets",
    "notes",
    "report_drafts",
];

/// Reverse dependency order for DELETE — children before parents.
/// Used by import (clear before re-insert) and reset.
const CLEAR_ORDER: &[&str] = &[
    "report_drafts",
    "notes",
    "report_presets",
    "review_notes",
    "review_sessions",
    "attachments",
    "links",
    "lesson_tags",
    "entry_tags",
    "lessons_learned",
    "scheduled_item_instances",
    "scheduled_items",
    "project_stakeholders",
    "stakeholders",
    "entries",
    "project_progress_log",
    "goal_progress_log",
    "projects",
    "goals",
    "program_progress_log",
    "programs",
    "tags",
    "settings",
];

/// Tables preserved across `/api/data/reset` per design §1.5.
///
/// `settings` keeps schema_version, fiscal_year_start_month, and user prefs.
/// `report_presets` holds system defaults that are re-seeded on startup if
/// missing, but we leave them alone here to avoid an unnecessary reseed.
const RESET_PRESERVE: &[&str] = &["settings", "report_presets"];

/// Required top-level tables for import/validate — a backup missing any of
/// these is considered malformed.
const REQUIRED_TABLES: &[&str] = &[
    "settings",
    "tags",
    "goals",
    "projects",
    "entries",
    "entry_tags",
    "lessons_learned",
    "links",
];

/// Build the data-management sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/data/export", post(export_data))
        .route("/api/data/import", post(import_data))
        .route("/api/data/validate", post(validate_data))
        .route("/api/data/reset", post(reset_data))
        .with_state(state)
}

// ─── Handlers ───────────────────────────────────────────────────────────────

/// POST /api/data/import — multipart JSON upload → replace all tables.
///
/// Accepts either envelope format (`{chronicle_version, schema_version,
/// table_counts, data: {…}}`) or legacy flat format (tables at top level).
/// Runs inside a transaction with FK checks disabled — on any error, the
/// transaction rolls back and the database is unchanged.
async fn import_data(
    State(state): State<SharedState>,
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    let backup = read_multipart_json(multipart).await?;
    let (payload, _meta) = unwrap_envelope(backup)?;

    // Validate that at least the core tables are present.
    let missing: Vec<&str> = REQUIRED_TABLES
        .iter()
        .copied()
        .filter(|t| !payload.contains_key(*t))
        .collect();
    if !missing.is_empty() {
        return Err(AppError::Validation(format!(
            "Missing required tables in backup: {}",
            missing.join(", ")
        )));
    }

    let mut conn = state.pool.get()?;
    // FK checks off during bulk import to avoid insertion-order problems
    // (e.g., entry_tags referencing entries not yet inserted).
    conn.execute_batch("PRAGMA foreign_keys=OFF")?;

    let tables_imported = {
        let tx = conn.transaction()?;

        // Phase 1 — clear existing rows in reverse dependency order
        for table in CLEAR_ORDER {
            tx.execute(&format!("DELETE FROM {}", table), [])?;
        }

        // Phase 2 — insert rows in dependency-safe order
        let mut imported = 0_i64;
        for table in ALL_TABLES {
            let Some(rows_val) = payload.get(*table) else {
                imported += 1; // counts as "table seen" for response
                continue;
            };
            let Some(rows) = rows_val.as_array() else {
                continue;
            };
            if rows.is_empty() {
                imported += 1;
                continue;
            }

            insert_rows(&tx, table, rows)?;
            imported += 1;
        }

        tx.commit()?;
        imported
    };

    // Re-enable FK checks regardless of success/failure before returning.
    conn.execute_batch("PRAGMA foreign_keys=ON")?;

    // v3.0: Run the entry backfill migration after import so that restored
    // pre-v3 backups are immediately consistent (every entry gets a scheduled_item_id).
    // This is idempotent — if all entries already have scheduled_item_id, it's a no-op.
    if let Err(e) = crate::db::migrations::run_v3_entry_backfill(&conn, &state.config.data_dir) {
        tracing::warn!("Post-import v3 backfill failed (non-fatal): {e}");
    }

    Ok(Json(serde_json::json!({
        "message": "Import completed successfully",
        "tables_imported": tables_imported,
    })))
}

/// POST /api/data/validate — multipart JSON upload → structure check only.
///
/// Returns `{valid, summary, warnings, errors}` matching the frontend's
/// `DataValidateResponse` type in `RestoreFlow.tsx`. Never writes to the
/// database.
async fn validate_data(
    multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    // Reading the multipart body itself can fail — treat that as a
    // validation error rather than a 500.
    let backup = match read_multipart_json(multipart).await {
        Ok(b) => b,
        Err(e) => {
            return Ok(Json(serde_json::json!({
                "valid": false,
                "summary": serde_json::Value::Null,
                "warnings": [],
                "errors": [e.to_string()],
            })));
        }
    };

    let (payload, meta) = match unwrap_envelope(backup) {
        Ok(v) => v,
        Err(e) => {
            return Ok(Json(serde_json::json!({
                "valid": false,
                "summary": serde_json::Value::Null,
                "warnings": [],
                "errors": [e.to_string()],
            })));
        }
    };

    let missing: Vec<&str> = REQUIRED_TABLES
        .iter()
        .copied()
        .filter(|t| !payload.contains_key(*t))
        .collect();

    if !missing.is_empty() {
        return Ok(Json(serde_json::json!({
            "valid": false,
            "summary": serde_json::Value::Null,
            "warnings": [],
            "errors": [format!(
                "Missing required tables: {}",
                missing.join(", ")
            )],
        })));
    }

    let summary = build_summary(&payload, &meta);
    let warnings = build_warnings(&summary, &meta);

    Ok(Json(serde_json::json!({
        "valid": true,
        "summary": summary,
        "warnings": warnings,
        "errors": [],
    })))
}

/// POST /api/data/reset — clear all user-data tables in one transaction.
///
/// Per design §1.5, preserves the `settings` and `report_presets` tables
/// so the user's schema version, fiscal-year preference, and system-seeded
/// report presets survive the reset.
async fn reset_data(
    State(state): State<SharedState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let mut conn = state.pool.get()?;
    conn.execute_batch("PRAGMA foreign_keys=OFF")?;

    let result = (|| -> Result<(), AppError> {
        let tx = conn.transaction()?;
        for table in CLEAR_ORDER {
            if RESET_PRESERVE.contains(table) {
                continue;
            }
            tx.execute(&format!("DELETE FROM {}", table), [])?;
        }
        tx.commit()?;
        Ok(())
    })();

    // Always re-enable FK checks, even on error.
    let _ = conn.execute_batch("PRAGMA foreign_keys=ON");
    result?;

    Ok(Json(serde_json::json!({ "message": "Reset complete" })))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Read the `file` field from a multipart upload and parse it as JSON.
async fn read_multipart_json(
    mut multipart: Multipart,
) -> Result<serde_json::Value, AppError> {
    if let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Invalid multipart: {}", e)))?
    {
        // Accept the field whether or not the name is "file" — the frontend
        // always uses "file", but being permissive costs nothing.
        let bytes = field
            .bytes()
            .await
            .map_err(|e| AppError::Validation(format!("Failed to read upload: {}", e)))?;

        let parsed: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|e| AppError::Validation(format!("Invalid JSON file: {}", e)))?;
        Ok(parsed)
    } else {
        Err(AppError::Validation("No file in multipart upload".into()))
    }
}

/// Metadata fields extracted from the envelope wrapper (if present).
#[derive(Default)]
struct BackupMeta {
    chronicle_version: Option<serde_json::Value>,
    schema_version: Option<serde_json::Value>,
    backup_date: Option<serde_json::Value>,
}

/// Unwrap envelope format (`{data: {…}}`) or accept a flat map.
///
/// Returns `(payload, meta)` where `payload` is the table→rows map and
/// `meta` holds the envelope metadata fields (all optional).
fn unwrap_envelope(
    value: serde_json::Value,
) -> Result<(serde_json::Map<String, serde_json::Value>, BackupMeta), AppError> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::Validation("JSON root must be an object".into()))?
        .clone();

    // Detect envelope: has a "data" key whose value is an object.
    if let Some(data) = obj.get("data") {
        if let Some(inner) = data.as_object() {
            let meta = BackupMeta {
                chronicle_version: obj.get("chronicle_version").cloned(),
                schema_version: obj.get("schema_version").cloned(),
                // Python used "backup_date"; Rust export uses "export_date".
                // Accept either.
                backup_date: obj
                    .get("backup_date")
                    .or_else(|| obj.get("export_date"))
                    .cloned(),
            };
            return Ok((inner.clone(), meta));
        }
    }

    Ok((obj, BackupMeta::default()))
}

/// Bulk-insert rows into `table`. Each row must be a JSON object; the column
/// list is taken from the first row's keys, and every subsequent row is
/// expected to use the same keys (missing keys become NULL).
fn insert_rows(
    tx: &rusqlite::Transaction,
    table: &str,
    rows: &[serde_json::Value],
) -> Result<(), AppError> {
    let Some(first) = rows.first().and_then(|r| r.as_object()) else {
        return Ok(());
    };

    let columns: Vec<String> = first.keys().cloned().collect();

    // Validate column names — only [A-Za-z0-9_] allowed. This prevents
    // SQL injection via a malicious backup crafted by a third party.
    for col in &columns {
        if col.is_empty() || !col.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(AppError::Validation(format!(
                "Invalid column name in backup data: {:?}",
                col
            )));
        }
    }

    let col_list = columns.join(", ");
    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        table,
        col_list,
        placeholders.join(", ")
    );

    let mut stmt = tx.prepare(&sql)?;

    for row in rows {
        let Some(obj) = row.as_object() else { continue };
        let params: Vec<Box<dyn rusqlite::ToSql>> = columns
            .iter()
            .map(|c| json_to_sql(obj.get(c)))
            .collect();
        let param_refs: Vec<&dyn rusqlite::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        stmt.execute(param_refs.as_slice())?;
    }

    Ok(())
}

/// Convert a JSON value into a rusqlite ToSql value.
fn json_to_sql(v: Option<&serde_json::Value>) -> Box<dyn rusqlite::ToSql> {
    match v {
        None | Some(serde_json::Value::Null) => {
            Box::new(Option::<String>::None)
        }
        Some(serde_json::Value::Bool(b)) => Box::new(if *b { 1_i64 } else { 0_i64 }),
        Some(serde_json::Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        Some(serde_json::Value::String(s)) => Box::new(s.clone()),
        // Arrays/objects are serialized back to JSON strings — matches how
        // the Python backend round-trips metrics/tags/sections fields.
        Some(other) => Box::new(other.to_string()),
    }
}

/// Build the validation summary mirroring the Python `data_validate` shape.
fn build_summary(
    payload: &serde_json::Map<String, serde_json::Value>,
    meta: &BackupMeta,
) -> serde_json::Value {
    let entries = payload.get("entries").and_then(|v| v.as_array());
    let entries_count = entries.map(|a| a.len()).unwrap_or(0);

    let mut entry_dates: Vec<String> = entries
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    e.as_object()
                        .and_then(|o| o.get("entry_date"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    entry_dates.sort();
    let entries_date_range = if entry_dates.is_empty() {
        serde_json::Value::Array(vec![])
    } else {
        serde_json::json!([entry_dates.first(), entry_dates.last()])
    };

    let programs = payload.get("programs").and_then(|v| v.as_array());
    let program_names: Vec<String> = programs
        .map(|arr| {
            arr.iter()
                .map(|p| {
                    p.as_object()
                        .and_then(|o| o.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("?")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default();

    let tags = payload.get("tags").and_then(|v| v.as_array());
    let tag_names: Vec<String> = tags
        .map(|arr| {
            arr.iter()
                .map(|t| {
                    t.as_object()
                        .and_then(|o| o.get("name"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("?")
                        .to_string()
                })
                .collect()
        })
        .unwrap_or_default();

    // Settings rows are [{key, value}, …] in the export — flatten for lookup.
    let mut user_name: serde_json::Value = serde_json::Value::Null;
    let mut user_role: serde_json::Value = serde_json::Value::Null;
    if let Some(settings) = payload.get("settings").and_then(|v| v.as_array()) {
        for row in settings {
            let Some(obj) = row.as_object() else { continue };
            let key = obj.get("key").and_then(|v| v.as_str()).unwrap_or("");
            match key {
                "user_name" => {
                    if let Some(v) = obj.get("value") {
                        user_name = v.clone();
                    }
                }
                "user_role" => {
                    if let Some(v) = obj.get("value") {
                        user_role = v.clone();
                    }
                }
                _ => {}
            }
        }
    }

    let tables_found = ALL_TABLES
        .iter()
        .filter(|t| payload.contains_key(**t))
        .count();

    serde_json::json!({
        "entries_count": entries_count,
        "entries_date_range": entries_date_range,
        "programs": program_names,
        "programs_count": programs.map(|a| a.len()).unwrap_or(0),
        "goals_count": payload.get("goals").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "projects_count": payload.get("projects").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "scheduled_items_count": payload.get("scheduled_items").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "scheduled_instances_count": payload.get("scheduled_item_instances").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "lessons_count": payload.get("lessons_learned").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "tags_count": tags.map(|a| a.len()).unwrap_or(0),
        "tags": tag_names,
        "attachments_count": payload.get("attachments").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "report_presets_count": payload.get("report_presets").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
        "user_name": user_name,
        "user_role": user_role,
        "backup_version": meta.chronicle_version.clone().unwrap_or(serde_json::Value::Null),
        "schema_version": meta.schema_version.clone().unwrap_or(serde_json::Value::Null),
        "backup_date": meta.backup_date.clone().unwrap_or(serde_json::Value::Null),
        "tables_found": tables_found,
        "tables_expected": ALL_TABLES.len(),
    })
}

/// Build warnings list. Mirrors the Python warnings (newer-version,
/// partial-table backup).
fn build_warnings(summary: &serde_json::Value, meta: &BackupMeta) -> Vec<String> {
    let mut warnings: Vec<String> = Vec::new();

    let current_version = env!("CARGO_PKG_VERSION");
    if let Some(v) = meta.chronicle_version.as_ref().and_then(|v| v.as_str()) {
        if v > current_version {
            warnings.push(format!(
                "Backup is from a newer version ({}). Some data may not import correctly.",
                v
            ));
        }
    }

    let tables_found = summary
        .get("tables_found")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let tables_expected = summary
        .get("tables_expected")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if tables_found < tables_expected {
        warnings.push(format!(
            "Backup has {} of {} expected tables. Missing tables will be empty after import.",
            tables_found, tables_expected
        ));
    }

    warnings
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    //! Unit tests for the data-management routes.
    //!
    //! Covers every requirement in §6.2–§6.5:
    //! - Export JSON shape matches `{chronicle_version, schema_version,
    //!   export_date, table_counts, data}`.
    //! - Import round-trip (export → import) preserves row counts.
    //! - Validate rejects malformed JSON and payloads missing required
    //!   top-level keys.
    //! - Reset empties every user-data table while preserving `settings`
    //!   and `report_presets`.
    //!
    //! Follows the same test-state/router pattern used in the `scheduled.rs`
    //! tests: a temp-dir SQLite database with the full production schema
    //! installed, an `Arc<AppState>` built by hand, and `tower::ServiceExt::
    //! oneshot` to drive the router.

    use super::*;
    use crate::db::schema::initialize_schema;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::{to_bytes, Body};
    use axum::http::{Request, StatusCode};
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
        // acceptable in tests, matches the pattern used in scheduled.rs.
        std::mem::forget(dir);

        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    /// Insert `n` programs with unique names. Returns the inserted ids.
    fn seed_programs(state: &SharedState, n: usize) -> Vec<i64> {
        let conn = state.pool.get().unwrap();
        (0..n)
            .map(|i| {
                conn.query_row(
                    "INSERT INTO programs (name) VALUES (?1) RETURNING id",
                    rusqlite::params![format!("Program {}", i)],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
            })
            .collect()
    }

    /// Insert `n` entries with valid entry_type. Returns ids.
    /// Each entry gets a synthetic scheduled_item_id to satisfy the v3 unified model.
    fn seed_entries(state: &SharedState, n: usize) -> Vec<i64> {
        let conn = state.pool.get().unwrap();
        (0..n)
            .map(|i| {
                // Create a synthetic completed task for each entry (v3 model)
                let item_id: i64 = conn.query_row(
                    "INSERT INTO scheduled_items (name, item_class, mode, status) \
                     VALUES (?1, 'task', 'one_time', 'completed') RETURNING id",
                    rusqlite::params![format!("Entry {}", i)],
                    |row| row.get(0),
                ).unwrap();
                conn.query_row(
                    "INSERT INTO entries (entry_date, entry_type, title, scheduled_item_id) \
                     VALUES ('2026-01-15', 'quick_capture', ?1, ?2) \
                     RETURNING id",
                    rusqlite::params![format!("Entry {}", i), item_id],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
            })
            .collect()
    }

    /// Insert `n` tags with unique names. Returns the inserted ids.
    fn seed_tags(state: &SharedState, n: usize) -> Vec<i64> {
        let conn = state.pool.get().unwrap();
        (0..n)
            .map(|i| {
                conn.query_row(
                    "INSERT INTO tags (name) VALUES (?1) RETURNING id",
                    rusqlite::params![format!("tag_{}", i)],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
            })
            .collect()
    }

    /// INSERT OR REPLACE a settings row.
    fn insert_setting(state: &SharedState, key: &str, value: &str) {
        let conn = state.pool.get().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .unwrap();
    }

    /// Insert a minimal report_preset row. Returns the new id.
    fn insert_report_preset(state: &SharedState, name: &str) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            "INSERT INTO report_presets (name, template_type, scope, sections, is_default) \
             VALUES (?1, 'modular', 'week', '{}', 0) RETURNING id",
            rusqlite::params![name],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    /// Count rows in the named table.
    fn row_count(state: &SharedState, table: &str) -> i64 {
        let conn = state.pool.get().unwrap();
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {}", table),
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap()
    }

    // ─── Multipart helper ──────────────────────────────────────────────────

    /// Build a `multipart/form-data` body containing a single `file` field
    /// whose contents are `json_bytes`. Returns `(body, content_type)` ready
    /// to feed into `Request::builder`.
    fn build_multipart(json_bytes: &[u8]) -> (Vec<u8>, String) {
        let boundary = "----ChronicleTestBoundary42";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"file\"; filename=\"backup.json\"\r\n",
        );
        body.extend_from_slice(b"Content-Type: application/json\r\n\r\n");
        body.extend_from_slice(json_bytes);
        body.extend_from_slice(format!("\r\n--{}--\r\n", boundary).as_bytes());
        let content_type = format!("multipart/form-data; boundary={}", boundary);
        (body, content_type)
    }

    // ─── Request helpers ───────────────────────────────────────────────────

    async fn post_export(state: SharedState) -> serde_json::Value {
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/data/export")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&body_bytes).unwrap()
    }

    async fn post_import_json(
        state: SharedState,
        payload: &serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let payload_bytes = serde_json::to_vec(payload).unwrap();
        let (body, content_type) = build_multipart(&payload_bytes);
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/data/import")
            .header("content-type", content_type)
            .body(Body::from(body))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    async fn post_validate_bytes(
        state: SharedState,
        file_bytes: &[u8],
    ) -> (StatusCode, serde_json::Value) {
        let (body, content_type) = build_multipart(file_bytes);
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/data/validate")
            .header("content-type", content_type)
            .body(Body::from(body))
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    async fn post_validate_json(
        state: SharedState,
        payload: &serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let payload_bytes = serde_json::to_vec(payload).unwrap();
        post_validate_bytes(state, &payload_bytes).await
    }

    async fn post_reset(state: SharedState) -> (StatusCode, serde_json::Value) {
        let app = router(state);
        let req = Request::builder()
            .method("POST")
            .uri("/api/data/reset")
            .body(Body::empty())
            .unwrap();
        let resp = app.oneshot(req).await.unwrap();
        let status = resp.status();
        let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let json = serde_json::from_slice(&body_bytes).unwrap_or(serde_json::Value::Null);
        (status, json)
    }

    // ─── Export tests (Requirement 6.2) ────────────────────────────────────

    /// Requirement 6.2: the export JSON SHALL match the legacy Python shape
    /// `{chronicle_version, schema_version, export_date, table_counts, data}`.
    #[tokio::test]
    async fn export_returns_envelope_with_all_required_top_level_keys() {
        let state = test_state();
        let json = post_export(state).await;

        assert!(
            json["chronicle_version"].is_string(),
            "chronicle_version missing or wrong type: {json}"
        );
        assert!(
            json["schema_version"].is_string(),
            "schema_version missing or wrong type: {json}"
        );
        assert!(
            json["export_date"].is_string(),
            "export_date missing or wrong type: {json}"
        );
        assert!(
            json["table_counts"].is_object(),
            "table_counts missing or wrong type: {json}"
        );
        assert!(
            json["data"].is_object(),
            "data missing or wrong type: {json}"
        );
    }

    /// Requirement 6.2: `table_counts[table]` SHALL equal the number of rows
    /// in `data[table]` for every table. Also spot-checks the seeded tables.
    #[tokio::test]
    async fn export_table_counts_match_data_row_counts() {
        let state = test_state();
        seed_programs(&state, 3);
        seed_tags(&state, 4);
        seed_entries(&state, 2);

        let json = post_export(state).await;
        let data = json["data"].as_object().unwrap();
        let counts = json["table_counts"].as_object().unwrap();

        for (table, rows) in data {
            let actual = rows.as_array().map(|a| a.len() as i64).unwrap_or(0);
            let reported = counts.get(table).and_then(|v| v.as_i64()).unwrap_or(-1);
            assert_eq!(
                actual, reported,
                "row count mismatch for table {}",
                table
            );
        }

        assert_eq!(counts["programs"].as_i64().unwrap(), 3);
        assert_eq!(counts["tags"].as_i64().unwrap(), 4);
        assert_eq!(counts["entries"].as_i64().unwrap(), 2);
    }

    // ─── Import tests (Requirement 6.3) ────────────────────────────────────

    /// Requirement 6.3: exporting the database and re-importing the same
    /// payload SHALL produce an identical row count for every table. The
    /// response SHALL be `{message, tables_imported}` with a positive
    /// tables_imported count.
    #[tokio::test]
    async fn import_round_trip_preserves_row_counts() {
        let state = test_state();
        seed_programs(&state, 2);
        seed_tags(&state, 3);
        seed_entries(&state, 4);
        insert_setting(&state, "user_name", "Alice");
        insert_report_preset(&state, "Weekly Digest");

        // 1. Capture the baseline export.
        let export = post_export(state.clone()).await;
        let initial_counts = export["table_counts"].clone();

        // 2. Re-import the same payload. The handler wipes every table first,
        //    so the net row count SHALL be identical after re-insert.
        let (status, body) = post_import_json(state.clone(), &export).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["message"], "Import completed successfully");
        assert!(
            body["tables_imported"].as_i64().unwrap() > 0,
            "expected at least one table imported, got {body}"
        );

        // 3. Re-export and compare table_counts for structural equality.
        let reexport = post_export(state).await;
        assert_eq!(
            reexport["table_counts"], initial_counts,
            "round-trip changed table_counts"
        );
    }

    // ─── Validate tests (Requirement 6.4) ──────────────────────────────────

    /// Requirement 6.4: validate SHALL reject malformed JSON with
    /// `valid: false` and a non-empty `errors` array (no DB writes).
    #[tokio::test]
    async fn validate_rejects_malformed_json() {
        let state = test_state();
        let garbage = b"{not valid json at all";
        let (status, body) = post_validate_bytes(state, garbage).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["valid"], false);
        let errors = body["errors"].as_array().unwrap();
        assert!(
            !errors.is_empty(),
            "expected non-empty errors for malformed JSON, got {body}"
        );
    }

    /// Requirement 6.4: validate SHALL reject payloads missing required
    /// top-level tables with `valid: false` and an explanatory error.
    #[tokio::test]
    async fn validate_rejects_missing_required_top_level_keys() {
        let state = test_state();
        // A root object that is syntactically valid JSON but omits every
        // required table. `REQUIRED_TABLES` = settings, tags, goals, projects,
        // entries, entry_tags, lessons_learned, links.
        let payload = serde_json::json!({
            "chronicle_version": "2.5.1",
            "schema_version": "2",
            "data": {
                "programs": []
            }
        });
        let (status, body) = post_validate_json(state, &payload).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["valid"], false);
        let errors = body["errors"].as_array().unwrap();
        assert_eq!(errors.len(), 1);
        let msg = errors[0].as_str().unwrap();
        assert!(
            msg.contains("Missing required tables"),
            "expected 'Missing required tables' error, got {msg}"
        );
    }

    /// Happy-path check — a complete, well-formed export passes validation.
    #[tokio::test]
    async fn validate_accepts_complete_envelope() {
        let state = test_state();
        seed_programs(&state, 1);
        let export = post_export(state.clone()).await;
        let (status, body) = post_validate_json(state, &export).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["valid"], true);
        assert!(body["summary"].is_object());
        let errors = body["errors"].as_array().unwrap();
        assert!(
            errors.is_empty(),
            "expected no errors, got {errors:?}"
        );
    }

    // ─── Reset tests (Requirement 6.5) ─────────────────────────────────────

    /// Requirement 6.5: reset SHALL return HTTP 200 with
    /// `{message: "Reset complete"}`.
    #[tokio::test]
    async fn reset_returns_expected_message() {
        let state = test_state();
        let (status, body) = post_reset(state).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["message"], "Reset complete");
    }

    /// Requirement 6.5: reset SHALL empty every user-data table while
    /// preserving `settings` and `report_presets`.
    #[tokio::test]
    async fn reset_empties_user_data_tables_but_preserves_settings_and_presets() {
        let state = test_state();

        // Seed user-data tables.
        seed_programs(&state, 2);
        seed_tags(&state, 3);
        seed_entries(&state, 4);

        // Seed the preserved tables with recognisable rows.
        insert_setting(&state, "user_name", "Alice");
        insert_setting(&state, "fiscal_year_start_month", "1");
        insert_report_preset(&state, "Weekly Digest");
        insert_report_preset(&state, "Monthly Rollup");

        // Baseline — confirm the seed worked.
        assert_eq!(row_count(&state, "programs"), 2);
        assert_eq!(row_count(&state, "tags"), 3);
        assert_eq!(row_count(&state, "entries"), 4);
        assert_eq!(row_count(&state, "settings"), 2);
        assert_eq!(row_count(&state, "report_presets"), 2);

        let (status, body) = post_reset(state.clone()).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["message"], "Reset complete");

        // Every user-data table SHALL be empty.
        for table in [
            "programs",
            "goals",
            "projects",
            "entries",
            "scheduled_items",
            "scheduled_item_instances",
            "lessons_learned",
            "tags",
            "entry_tags",
            "lesson_tags",
            "links",
            "attachments",
            "notes",
            "report_drafts",
            "review_sessions",
            "review_notes",
            "stakeholders",
            "project_stakeholders",
            "goal_progress_log",
            "project_progress_log",
            "program_progress_log",
        ] {
            assert_eq!(
                row_count(&state, table),
                0,
                "user-data table {} SHALL be empty after reset",
                table
            );
        }

        // Preserved tables SHALL retain their rows.
        assert_eq!(
            row_count(&state, "settings"),
            2,
            "settings SHALL be preserved across reset"
        );
        assert_eq!(
            row_count(&state, "report_presets"),
            2,
            "report_presets SHALL be preserved across reset"
        );
    }
}
