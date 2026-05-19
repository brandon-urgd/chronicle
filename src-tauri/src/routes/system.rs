//! System routes: health, version, shutdown, query, diagnostics.
//!
//! These endpoints support lifecycle management and diagnostics.

use std::fmt::Write as _;

use axum::{
    extract::State,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

use crate::db::SharedState;
use crate::error::AppError;
use crate::models::common::{QueryRequest, QueryResponse, VersionResponse};

/// Build the system sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/version", get(version))
        .route("/api/shutdown", post(shutdown))
        .route("/api/query", post(query))
        .route("/api/diagnostics", get(diagnostics))
        .with_state(state)
}

/// GET /api/health → {"status": "ok"}
///
/// Used by the frontend and Tauri shell to verify backend readiness.
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

/// GET /api/version → {"app_version": "3.0.0", "schema_version": N}
///
/// Reads the app version from `CARGO_PKG_VERSION` (Cargo.toml) at compile time
/// and reads schema_version from the settings table.
async fn version(State(state): State<SharedState>) -> Result<Json<VersionResponse>, AppError> {
    let conn = state.pool.get()?;

    let schema_version: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    Ok(Json(VersionResponse {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        schema_version,
    }))
}

/// POST /api/shutdown → trigger graceful shutdown
///
/// Sends true to the shutdown signal and performs a WAL checkpoint before responding.
async fn shutdown(State(state): State<SharedState>) -> Result<Json<serde_json::Value>, AppError> {
    // Signal shutdown
    let _ = state.shutdown_tx.send(true);

    // WAL checkpoint to flush pending writes
    let conn = state.pool.get()?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
        .map_err(AppError::Database)?;

    Ok(Json(serde_json::json!({ "status": "shutting_down" })))
}

/// Validate that a SQL string is a read-only SELECT statement.
/// Returns Ok(()) if valid, or an error message string if rejected.
fn validate_query_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim();

    // Must start with SELECT (case-insensitive)
    if !trimmed.to_uppercase().starts_with("SELECT") {
        return Err("Only SELECT statements are allowed".to_string());
    }

    // Reject mutation keywords (case-insensitive)
    let upper_sql = trimmed.to_uppercase();
    let forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE"];
    for keyword in &forbidden {
        if let Some(rest) = upper_sql.strip_prefix("SELECT") {
            if rest.contains(keyword) {
                return Err(format!("SQL contains forbidden keyword: {}", keyword));
            }
        }
    }

    Ok(())
}

/// POST /api/query → execute read-only SELECT statements
///
/// Validates that the SQL is a SELECT statement and rejects any mutation keywords.
async fn query(
    State(state): State<SharedState>,
    Json(request): Json<QueryRequest>,
) -> Result<Json<QueryResponse>, AppError> {
    let sql = request.sql.trim().to_string();

    // Validate using the extracted helper
    validate_query_sql(&sql).map_err(AppError::Validation)?;

    let conn = state.pool.get()?;

    let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;

    // Get column names
    let columns: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| c.to_string())
        .collect();

    let column_count = columns.len();

    // Execute and collect rows
    let rows: Vec<Vec<serde_json::Value>> = stmt
        .query_map([], |row| {
            let mut values = Vec::with_capacity(column_count);
            for i in 0..column_count {
                let value = match row.get_ref(i) {
                    Ok(rusqlite::types::ValueRef::Integer(n)) => {
                        serde_json::Value::Number(serde_json::Number::from(n))
                    }
                    Ok(rusqlite::types::ValueRef::Real(f)) => serde_json::Number::from_f64(f)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null),
                    Ok(rusqlite::types::ValueRef::Text(t)) => {
                        serde_json::Value::String(String::from_utf8_lossy(t).to_string())
                    }
                    Ok(rusqlite::types::ValueRef::Blob(_)) => serde_json::Value::Null,
                    Ok(rusqlite::types::ValueRef::Null) => serde_json::Value::Null,
                    Err(_) => serde_json::Value::Null,
                };
                values.push(value);
            }
            Ok(values)
        })
        .map_err(AppError::Database)?
        .filter_map(|r| r.ok())
        .collect();

    Ok(Json(QueryResponse { columns, rows }))
}

/// GET /api/diagnostics → plain-text diagnostic bundle
///
/// Returns a human-readable text bundle suitable for pasting into Slack or email,
/// containing app/schema version, OS and architecture, the data directory path,
/// row counts for the main tables, and the last 50 lines of today's log file.
///
/// Content is scoped to the Chronicle data directory per Requirement 10.5 — no
/// paths outside the data directory, user name, or email are emitted.
async fn diagnostics(State(state): State<SharedState>) -> Result<Response, AppError> {
    let conn = state.pool.get()?;

    // Schema version — same lookup as GET /api/version.
    let schema_version: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "0".to_string());

    // Row counts for the six primary user-data tables. Errors short-circuit
    // to 500 via AppError::Database so the caller sees a consistent shape.
    let counts = collect_row_counts(&conn)?;

    // Today's log tail. This is best-effort: a missing or unreadable file
    // returns a placeholder note rather than failing the whole endpoint.
    let log_tail = read_log_tail(&state.config.data_dir, 50);

    let body = format_diagnostic_bundle(
        env!("CARGO_PKG_VERSION"),
        &schema_version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        &state.config.data_dir.display().to_string(),
        &counts,
        &log_tail,
    );

    let mut response = body.into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/plain; charset=utf-8"),
    );
    Ok(response)
}

/// Table row counts rendered in the diagnostic bundle.
#[derive(Debug, Default, Clone)]
struct RowCounts {
    programs: i64,
    goals: i64,
    projects: i64,
    entries: i64,
    scheduled_items: i64,
    scheduled_item_instances: i64,
}

/// Query row counts for the six primary user-data tables.
///
/// Missing tables (shouldn't happen post-migration but kept for robustness)
/// are reported as 0 rather than failing.
fn collect_row_counts(conn: &rusqlite::Connection) -> Result<RowCounts, AppError> {
    fn count(conn: &rusqlite::Connection, table: &str) -> Result<i64, AppError> {
        let sql = format!("SELECT COUNT(*) FROM {}", table);
        match conn.query_row(&sql, [], |row| row.get::<_, i64>(0)) {
            Ok(n) => Ok(n),
            Err(rusqlite::Error::SqliteFailure(_, Some(msg))) if msg.contains("no such table") => {
                Ok(0)
            }
            Err(e) => Err(AppError::Database(e)),
        }
    }

    Ok(RowCounts {
        programs: count(conn, "programs")?,
        goals: count(conn, "goals")?,
        projects: count(conn, "projects")?,
        entries: count(conn, "entries")?,
        scheduled_items: count(conn, "scheduled_items")?,
        scheduled_item_instances: count(conn, "scheduled_item_instances")?,
    })
}

/// Read the last `n` lines of today's Chronicle log file, formatted as a
/// single string. Returns a placeholder if the file is missing or unreadable.
///
/// The log file name matches the rolling appender's `chronicle.YYYY-MM-DD.log`
/// pattern. UTC is used to match `tracing_appender::rolling` which rolls on
/// UTC day boundaries.
fn read_log_tail(data_dir: &std::path::Path, n: usize) -> String {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let log_path = data_dir.join(format!("chronicle.{}.log", today));

    let contents = match std::fs::read_to_string(&log_path) {
        Ok(s) => s,
        Err(_) => return format!("(log file not available: chronicle.{}.log)", today),
    };

    // Preserve original line order; take last n lines only.
    let lines: Vec<&str> = contents.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// Render the diagnostic bundle as a Slack-friendly plain-text block.
///
/// Kept in a pure helper so it can be unit-tested (task 8.3) without spinning
/// up a database or filesystem.
#[allow(clippy::too_many_arguments)]
fn format_diagnostic_bundle(
    app_version: &str,
    schema_version: &str,
    os: &str,
    arch: &str,
    data_dir: &str,
    counts: &RowCounts,
    log_tail: &str,
) -> String {
    let generated = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    let mut out = String::with_capacity(1024);
    let _ = writeln!(out, "Chronicle Diagnostic Bundle");
    let _ = writeln!(out, "Generated: {}", generated);
    out.push('\n');
    let _ = writeln!(out, "== Version ==");
    let _ = writeln!(out, "App version: {}", app_version);
    let _ = writeln!(out, "Schema version: {}", schema_version);
    out.push('\n');
    let _ = writeln!(out, "== System ==");
    let _ = writeln!(out, "OS: {}", os);
    let _ = writeln!(out, "Arch: {}", arch);
    out.push('\n');
    let _ = writeln!(out, "== Data ==");
    let _ = writeln!(out, "Data directory: {}", data_dir);
    let _ = writeln!(out, "Programs: {}", counts.programs);
    let _ = writeln!(out, "Goals: {}", counts.goals);
    let _ = writeln!(out, "Projects: {}", counts.projects);
    let _ = writeln!(out, "Entries: {}", counts.entries);
    let _ = writeln!(out, "Scheduled items: {}", counts.scheduled_items);
    let _ = writeln!(
        out,
        "Scheduled item instances: {}",
        counts.scheduled_item_instances
    );
    out.push('\n');
    let _ = writeln!(out, "== Recent Log (last 50 lines) ==");
    out.push_str(log_tail);
    if !log_tail.ends_with('\n') {
        out.push('\n');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::Body;
    use axum::http::Request;
    use proptest::prelude::*;
    use std::sync::Arc;
    use tokio::sync::watch;
    use tower::util::ServiceExt;

    fn test_state() -> SharedState {
        let dir = tempfile::tempdir().unwrap();
        let config = AppConfig {
            db_path: dir.path().join("test.db"),
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };
        let pool = init_pool(&config).unwrap();

        // Create settings table and insert schema_version for tests
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '2');",
        )
        .unwrap();

        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    #[tokio::test]
    async fn health_returns_ok() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .uri("/api/health")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
    }

    #[tokio::test]
    async fn version_returns_app_and_schema_version() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .uri("/api/version")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["app_version"], env!("CARGO_PKG_VERSION"));
        // schema_version depends on whether migrations have run in the test DB
        assert!(json["schema_version"].is_string(), "schema_version should be a string");
    }

    #[tokio::test]
    async fn shutdown_returns_shutting_down() {
        let state = test_state();
        // Subscribe to the state's shutdown signal to verify it was sent
        let rx = state.shutdown_tx.subscribe();

        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/shutdown")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "shutting_down");

        // Verify shutdown signal was sent
        assert_eq!(*rx.borrow(), true);
    }

    #[tokio::test]
    async fn query_select_returns_results() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"sql": "SELECT key, value FROM settings"}"#,
            ))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["columns"], serde_json::json!(["key", "value"]));
        assert!(!json["rows"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn query_rejects_insert() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"sql": "INSERT INTO settings (key, value) VALUES ('x', 'y')"}"#,
            ))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn query_rejects_delete() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"sql": "DELETE FROM settings"}"#))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn query_rejects_drop() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(r#"{"sql": "DROP TABLE settings"}"#))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn query_rejects_update() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"sql": "UPDATE settings SET value = 'x' WHERE key = 'y'"}"#,
            ))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn query_case_insensitive_select() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"sql": "  select key from settings  "}"#,
            ))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn diagnostics_returns_text_plain_with_all_sections() {
        let state = test_state();
        let app = router(state);

        let req = Request::builder()
            .uri("/api/diagnostics")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Content-Type must be text/plain (Requirement 10.4 — plain-text bundle).
        let content_type = resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(
            content_type.starts_with("text/plain"),
            "expected text/plain content-type, got {:?}",
            content_type
        );

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();

        // Requirement 10.3: bundle contains all required section headers
        assert!(body.contains("== Version =="), "missing Version section\n{}", body);
        assert!(body.contains("== System =="), "missing System section\n{}", body);
        assert!(body.contains("== Data =="), "missing Data section\n{}", body);
        assert!(
            body.contains("== Recent Log (last 50 lines) =="),
            "missing Recent Log section\n{}",
            body
        );

        // Requirement 10.3: app version, schema version, OS, arch
        assert!(
            body.contains(&format!("App version: {}", env!("CARGO_PKG_VERSION"))),
            "missing app version\n{}",
            body
        );
        assert!(body.contains("Schema version: 2"), "missing schema version\n{}", body);
        assert!(
            body.contains(&format!("OS: {}", std::env::consts::OS)),
            "missing OS\n{}",
            body
        );
        assert!(
            body.contains(&format!("Arch: {}", std::env::consts::ARCH)),
            "missing arch\n{}",
            body
        );

        // Requirement 10.3: data directory and row counts for key tables.
        // Tables don't exist in the test DB so counts report 0, which still
        // satisfies the "row counts are present" contract.
        assert!(body.contains("Data directory:"), "missing data directory\n{}", body);
        assert!(body.contains("Programs: 0"), "missing programs count\n{}", body);
        assert!(body.contains("Goals: 0"), "missing goals count\n{}", body);
        assert!(body.contains("Projects: 0"), "missing projects count\n{}", body);
        assert!(body.contains("Entries: 0"), "missing entries count\n{}", body);
        assert!(
            body.contains("Scheduled items: 0"),
            "missing scheduled items count\n{}",
            body
        );
        assert!(
            body.contains("Scheduled item instances: 0"),
            "missing scheduled item instances count\n{}",
            body
        );
    }

    #[tokio::test]
    async fn diagnostics_reflects_actual_row_counts() {
        let state = test_state();

        // Seed the tables the diagnostic bundle reads so we can assert the counts
        // come from the database rather than a hardcoded zero.
        {
            let conn = state.pool.get().unwrap();
            conn.execute_batch(
                "CREATE TABLE programs (id INTEGER PRIMARY KEY);
                 CREATE TABLE goals (id INTEGER PRIMARY KEY);
                 CREATE TABLE projects (id INTEGER PRIMARY KEY);
                 CREATE TABLE entries (id INTEGER PRIMARY KEY);
                 CREATE TABLE scheduled_items (id INTEGER PRIMARY KEY);
                 CREATE TABLE scheduled_item_instances (id INTEGER PRIMARY KEY);
                 INSERT INTO programs (id) VALUES (1), (2), (3);
                 INSERT INTO goals (id) VALUES (1), (2);
                 INSERT INTO entries (id) VALUES (1), (2), (3), (4), (5);",
            )
            .unwrap();
        }

        let app = router(state);

        let req = Request::builder()
            .uri("/api/diagnostics")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        let body_bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body_bytes.to_vec()).unwrap();

        assert!(body.contains("Programs: 3"), "expected 3 programs in\n{}", body);
        assert!(body.contains("Goals: 2"), "expected 2 goals in\n{}", body);
        assert!(body.contains("Projects: 0"), "expected 0 projects in\n{}", body);
        assert!(body.contains("Entries: 5"), "expected 5 entries in\n{}", body);
    }

    #[tokio::test]
    async fn query_rejects_select_with_subquery_insert() {
        let state = test_state();
        let app = router(state);

        // A SELECT that contains INSERT in a subquery-like pattern should be rejected
        let req = Request::builder()
            .method("POST")
            .uri("/api/query")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"sql": "SELECT * FROM settings; INSERT INTO settings VALUES ('a','b')"}"#,
            ))
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    // ─── Property-Based Tests ───────────────────────────────────────────────

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // Feature: rust-backend-rewrite, Property 13: Read-Only Query Endpoint Rejects Mutations
        // **Validates: Requirements 7.3**
        //
        // Any SQL string that starts with a mutation keyword (INSERT, UPDATE, DELETE,
        // DROP, ALTER, CREATE) must be rejected by the validation logic.
        #[test]
        fn prop_query_rejects_mutation_statements(
            keyword in prop::sample::select(vec![
                "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
                "insert", "update", "delete", "drop", "alter", "create",
                "Insert", "Update", "Delete", "Drop", "Alter", "Create",
            ]),
            rest in "[a-zA-Z_ ,()0-9'\"]{1,80}"
        ) {
            let sql = format!("{} {}", keyword, rest);
            let result = validate_query_sql(&sql);
            prop_assert!(
                result.is_err(),
                "Expected rejection for mutation SQL: '{}', but got Ok(())",
                sql
            );
        }

        // Feature: rust-backend-rewrite, Property 13: Read-Only Query Endpoint Rejects Mutations
        // **Validates: Requirements 7.3**
        //
        // Any SQL string starting with SELECT (with optional leading whitespace)
        // that does NOT contain forbidden keywords in the body should NOT be
        // rejected by the validation logic.
        #[test]
        fn prop_query_accepts_select_statements(
            leading_space in "[ \\t]{0,5}",
            // Generate column-like identifiers that won't accidentally contain
            // forbidden keywords (use only lowercase letters a-f to avoid spelling
            // INSERT, UPDATE, DELETE, DROP, ALTER, CREATE)
            columns in "[a-f]{1,10}(, [a-f]{1,10}){0,3}",
            table in "[a-f]{1,15}"
        ) {
            let sql = format!("{}SELECT {} FROM {}", leading_space, columns, table);
            let result = validate_query_sql(&sql);
            prop_assert!(
                result.is_ok(),
                "Expected acceptance for SELECT SQL: '{}', but got Err({:?})",
                sql,
                result.err()
            );
        }

        // Feature: rust-backend-rewrite, Property 13: Read-Only Query Endpoint Rejects Mutations
        // **Validates: Requirements 7.3**
        //
        // Mutation keywords with leading whitespace should still be rejected.
        #[test]
        fn prop_query_rejects_mutations_with_whitespace(
            leading_space in "[ \\t]{1,10}",
            keyword in prop::sample::select(vec![
                "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
            ]),
            rest in "[a-zA-Z_ ]{1,40}"
        ) {
            let sql = format!("{}{} {}", leading_space, keyword, rest);
            let result = validate_query_sql(&sql);
            prop_assert!(
                result.is_err(),
                "Expected rejection for whitespace-prefixed mutation SQL: '{}', but got Ok(())",
                sql
            );
        }
    }
}
