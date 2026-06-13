//! Property-based tests for entry API response shapes and input handling.
//!
//! # Feature: chronicle-v3.1-leanout, Property 4/5
//!
//! These tests verify that:
//! - Property 4: API responses never contain removed fields
//! - Property 5: API silently ignores unrecognized input fields from the removed set
//!
//! **Validates: Requirements 8.1–8.5**

use crate::db::schema::initialize_schema;
use crate::db::{init_pool, AppConfig, AppState, SharedState};
use crate::models::entry::{CreateEntry, EntryResponse};
use crate::routes::entries::router;
use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use proptest::prelude::*;
use std::sync::Arc;
use tokio::sync::watch;
use tower::util::ServiceExt;

// ─── Removed field sets (from design doc) ──────────────────────────────────

/// Fields removed from entry responses in v3.1.
const REMOVED_ENTRY_RESPONSE_FIELDS: &[&str] = &[
    "impact",
    "work_type",
    "metrics",
    "outcome",
    "is_lesson_learned",
    "links",
    "attachments",
    "stakeholders",
];

/// Fields removed from entry create/update input in v3.1.
const REMOVED_ENTRY_INPUT_FIELDS: &[&str] = &[
    "work_type",
    "impact",
    "metrics",
    "outcome",
    "is_lesson_learned",
];

// ─── Test helpers ──────────────────────────────────────────────────────────

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

    let conn = pool.get().unwrap();
    initialize_schema(&conn).unwrap();
    drop(conn);

    // Keep the temp dir alive for the lifetime of the pool.
    std::mem::forget(dir);

    let (shutdown_tx, _) = watch::channel(false);
    Arc::new(AppState {
        pool,
        config,
        shutdown_tx,
    })
}

/// Insert an entry directly via SQL and return the new entry id.
fn insert_entry(state: &SharedState, entry_type: &str, title: &str, description: Option<&str>) -> i64 {
    let conn = state.pool.get().unwrap();
    conn.query_row(
        "INSERT INTO entries (entry_date, entry_type, title, description) \
         VALUES ('2025-06-15', ?1, ?2, ?3) RETURNING id",
        rusqlite::params![entry_type, title, description],
        |row| row.get::<_, i64>(0),
    )
    .unwrap()
}

// ─── Proptest strategies ───────────────────────────────────────────────────

/// Strategy for valid entry_type values.
fn entry_type_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("quick_capture".to_string()),
        Just("project_update".to_string()),
        Just("operational_rhythm".to_string()),
        Just("milestone".to_string()),
        Just("decision".to_string()),
        Just("recognition".to_string()),
    ]
}

/// Strategy for valid visibility values.
fn visibility_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("shareable".to_string()),
        Just("personal".to_string()),
    ]
}

/// Strategy for valid status values.
fn status_strategy() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("completed".to_string()),
        Just("in_progress".to_string()),
        Just("ongoing".to_string()),
        Just("paused".to_string()),
    ]
}

/// Strategy for generating a safe title string (non-empty, printable ASCII).
fn title_strategy() -> impl Strategy<Value = String> {
    "[a-zA-Z0-9 ]{1,50}"
}

/// Strategy for generating optional description text.
fn description_strategy() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        "[a-zA-Z0-9 .!?,]{1,200}".prop_map(Some),
    ]
}

/// Strategy for a random subset of removed field names to inject into a payload.
fn removed_fields_subset_strategy() -> impl Strategy<Value = Vec<&'static str>> {
    proptest::sample::subsequence(REMOVED_ENTRY_INPUT_FIELDS, 1..=5)
}

/// Strategy for generating a random value to assign to a removed field.
fn removed_field_value_strategy() -> impl Strategy<Value = serde_json::Value> {
    prop_oneof![
        Just(serde_json::Value::String("some_value".to_string())),
        Just(serde_json::Value::Number(serde_json::Number::from(1))),
        Just(serde_json::Value::Bool(true)),
        Just(serde_json::Value::Null),
        "[a-zA-Z0-9]{1,20}".prop_map(|s| serde_json::Value::String(s)),
    ]
}

// ─── Property-Based Tests ──────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    // Feature: chronicle-v3.1-leanout, Property 4: API Responses Exclude Removed Fields
    // **Validates: Requirements 8.1, 8.2, 8.3**
    //
    // For any generated entry data, when serialized to JSON via the EntryResponse
    // struct, the output SHALL NOT contain any key from the removed field set:
    // {impact, work_type, metrics, outcome, is_lesson_learned, links, attachments, stakeholders}.
    #[test]
    fn prop_entry_response_excludes_removed_fields(
        entry_type in entry_type_strategy(),
        title in title_strategy(),
        description in description_strategy(),
        status in status_strategy(),
        visibility in visibility_strategy(),
        is_accomplishment in 0i64..=1,
        is_weekly_highlight in 0i64..=1,
        is_pinned in 0i64..=1,
    ) {
        let response = EntryResponse {
            id: 1,
            created_at: "2025-06-15T10:00:00".to_string(),
            updated_at: "2025-06-15T10:00:00".to_string(),
            entry_date: "2025-06-15".to_string(),
            entry_type,
            title,
            description,
            project_id: Some(1),
            project_name: Some("Test Project".to_string()),
            program_id: Some(2),
            program_name: Some("Test Program".to_string()),
            scheduled_item_id: None,
            status,
            visibility,
            is_accomplishment,
            is_weekly_highlight,
            is_pinned,
            tags: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        let obj = json.as_object().unwrap();

        for removed_field in REMOVED_ENTRY_RESPONSE_FIELDS {
            prop_assert!(
                !obj.contains_key(*removed_field),
                "EntryResponse JSON contains removed field '{}'. Keys present: {:?}",
                removed_field,
                obj.keys().collect::<Vec<_>>()
            );
        }
    }

    // Feature: chronicle-v3.1-leanout, Property 5: API Ignores Unrecognized Input Fields
    // **Validates: Requirements 8.4, 8.5**
    //
    // For any generated payload with random extra fields from the removed set,
    // the serde deserialization SHALL succeed (fields are ignored) AND the
    // GET response for a persisted entry SHALL NOT contain removed fields.
    #[test]
    fn prop_api_ignores_removed_input_fields(
        entry_type in entry_type_strategy(),
        title in title_strategy(),
        description in description_strategy(),
        removed_fields in removed_fields_subset_strategy(),
        removed_value in removed_field_value_strategy(),
    ) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result: Result<(), TestCaseError> = rt.block_on(async {
            // Part A: Verify CreateEntry deserialization ignores removed fields.
            let mut payload = serde_json::json!({
                "entry_type": entry_type,
                "title": title,
            });
            if let Some(desc) = &description {
                payload["description"] = serde_json::Value::String(desc.clone());
            }
            // Inject removed fields into the payload.
            for field in &removed_fields {
                payload[*field] = removed_value.clone();
            }

            let payload_str = serde_json::to_string(&payload).unwrap();
            let deserialized: Result<CreateEntry, _> = serde_json::from_str(&payload_str);
            prop_assert!(
                deserialized.is_ok(),
                "CreateEntry deserialization failed with removed fields {:?}: {:?}",
                removed_fields,
                deserialized.err()
            );

            let create_entry = deserialized.unwrap();
            prop_assert_eq!(&create_entry.entry_type, &entry_type);
            prop_assert_eq!(&create_entry.title, &title);

            // Part B: Insert an entry via SQL and verify GET response excludes removed fields.
            let state = test_state();
            let entry_id = insert_entry(
                &state,
                &entry_type,
                &title,
                description.as_deref(),
            );

            let app = router(state.clone());
            let req = Request::builder()
                .method("GET")
                .uri(format!("/api/entries/{}", entry_id))
                .body(Body::empty())
                .unwrap();
            let resp = app.oneshot(req).await.unwrap();
            prop_assert_eq!(
                resp.status(),
                StatusCode::OK,
                "GET /api/entries/{} returned {}",
                entry_id,
                resp.status().as_u16()
            );

            let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
            let response_json: serde_json::Value =
                serde_json::from_slice(&body_bytes).unwrap();
            let response_obj = response_json.as_object().unwrap();

            // Verify no removed fields appear in the GET response.
            for removed_field in REMOVED_ENTRY_RESPONSE_FIELDS {
                prop_assert!(
                    !response_obj.contains_key(*removed_field),
                    "GET response for entry {} contains removed field '{}'. Keys: {:?}",
                    entry_id,
                    removed_field,
                    response_obj.keys().collect::<Vec<_>>()
                );
            }

            Ok(())
        });
        result?;
    }
}

// ─── Unit tests ────────────────────────────────────────────────────────────

#[test]
fn test_create_entry_struct_ignores_all_removed_fields() {
    // Verify at the serde level that CreateEntry ignores every removed field.
    let json = r#"{
        "entry_type": "milestone",
        "title": "Test",
        "work_type": "project",
        "impact": "High impact text",
        "metrics": "100% coverage",
        "outcome": "Success",
        "is_lesson_learned": 1
    }"#;
    let entry: CreateEntry = serde_json::from_str(json).unwrap();
    assert_eq!(entry.entry_type, "milestone");
    assert_eq!(entry.title, "Test");
}

#[tokio::test]
async fn test_get_entry_response_excludes_removed_fields() {
    let state = test_state();
    let entry_id = insert_entry(&state, "quick_capture", "Integration check", Some("details"));

    let app = router(state.clone());
    let req = Request::builder()
        .method("GET")
        .uri(format!("/api/entries/{}", entry_id))
        .body(Body::empty())
        .unwrap();

    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);

    let body_bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    let obj = json.as_object().unwrap();

    // None of the removed fields should be in the response.
    for field in REMOVED_ENTRY_RESPONSE_FIELDS {
        assert!(
            !obj.contains_key(*field),
            "Response unexpectedly contains removed field '{}'",
            field
        );
    }

    // Required fields must be present.
    assert!(obj.contains_key("id"));
    assert!(obj.contains_key("entry_type"));
    assert!(obj.contains_key("title"));
    assert!(obj.contains_key("status"));
    assert!(obj.contains_key("tags"));
}
