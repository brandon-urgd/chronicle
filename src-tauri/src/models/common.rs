//! Common/shared models — types used across multiple route domains.
//!
//! Includes error responses, ID responses, report presets/drafts, review sessions,
//! prep notes, dashboard, backup, version, and query models.

use serde::{Deserialize, Serialize};

// ─── Standard Responses ─────────────────────────────────────────────────────

/// Standard error response matching FastAPI HTTPException format.
#[derive(Debug, Clone, Serialize)]
pub struct ErrorResponse {
    pub detail: String,
}

/// Generic ID response for create operations.
#[derive(Debug, Clone, Serialize)]
pub struct IdResponse {
    pub id: i64,
}

// ─── Report Presets ─────────────────────────────────────────────────────────

/// Report preset response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportPresetResponse {
    pub id: i64,
    pub created_at: String,
    pub name: String,
    pub template_type: String,
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    pub sections: String,
    pub is_default: i64,
}

/// Request body for creating a report preset.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateReportPreset {
    pub name: String,
    #[serde(default = "default_template_type")]
    pub template_type: String,
    #[serde(default = "default_scope")]
    pub scope: String,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default = "default_sections")]
    pub sections: String,
    #[serde(default)]
    pub is_default: i64,
}

/// Request body for updating a report preset (partial update).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateReportPreset {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub template_type: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub sections: Option<String>,
    #[serde(default)]
    pub is_default: Option<i64>,
}

// ─── Report Drafts ──────────────────────────────────────────────────────────

/// Report draft response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportDraftResponse {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preset_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_range_start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_range_end: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Request body for creating a report draft.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateReportDraft {
    pub title: String,
    pub content: String,
    #[serde(default = "default_draft_status")]
    pub status: String,
    #[serde(default)]
    pub preset_id: Option<i64>,
    #[serde(default)]
    pub date_range_start: Option<String>,
    #[serde(default)]
    pub date_range_end: Option<String>,
}

/// Request body for updating a report draft (partial update).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateReportDraft {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

// ─── Review Sessions ────────────────────────────────────────────────────────

/// Review session response including nested review notes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSessionResponse {
    pub id: i64,
    pub review_date: String,
    pub date_range_start: String,
    pub date_range_end: String,
    pub review_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_notes: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    pub notes: Vec<ReviewNoteResponse>,
}

/// Review note response (nested within review session).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewNoteResponse {
    pub id: i64,
    pub review_session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    pub note_text: String,
    pub created_at: String,
}

/// Request body for creating a review session.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateReviewSession {
    pub review_date: String,
    pub date_range_start: String,
    pub date_range_end: String,
    pub review_type: String,
    #[serde(default)]
    pub session_notes: Option<String>,
    #[serde(default)]
    pub program_id: Option<i64>,
}

/// Request body for creating a review note.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateReviewNote {
    #[serde(default)]
    pub review_session_id: Option<i64>,
    #[serde(default)]
    pub parent_type: Option<String>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    pub note_text: String,
}

// ─── Prep Notes ─────────────────────────────────────────────────────────────

/// Prep note response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrepNoteResponse {
    pub id: i64,
    pub text: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_at: Option<String>,
}

/// Request body for creating a prep note.
#[derive(Debug, Clone, Deserialize)]
pub struct CreatePrepNote {
    pub text: String,
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

/// Dashboard aggregate response.
#[derive(Debug, Clone, Serialize)]
pub struct DashboardResponse {
    pub entries_this_week: i64,
    pub entries_this_month: i64,
    pub entries_this_quarter: i64,
    pub active_projects: i64,
    pub goals_on_track: i64,
    pub goals_at_risk: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_since_last_entry: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weekly_highlight: Option<serde_json::Value>,
    pub recent_entries: Vec<serde_json::Value>,
    pub gap_dates: Vec<String>,
    pub operational_rhythm_count: i64,
    pub open_todos: Vec<serde_json::Value>,
    pub open_todos_count: i64,
    pub program_activity: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_today: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_pulse: Option<ActivityPulse>,
    pub prep_notes: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_ready: Option<ReportReady>,
}

/// Activity pulse metrics for the dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct ActivityPulse {
    pub entries_this_week: i64,
    pub tasks_completed_this_week: i64,
    pub time_since_last_entry: String,
}

/// Report ready indicator for the dashboard.
#[derive(Debug, Clone, Serialize)]
pub struct ReportReady {
    pub draft_id: i64,
    pub title: String,
}

/// Heatmap entry for activity visualization.
#[derive(Debug, Clone, Serialize)]
pub struct HeatmapEntry {
    pub date: String,
    pub count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_program_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_program_color: Option<String>,
}

/// Heatmap response wrapping a list of heatmap entries.
#[derive(Debug, Clone, Serialize)]
pub struct HeatmapResponse {
    pub days: Vec<HeatmapEntry>,
}

// ─── Backup ─────────────────────────────────────────────────────────────────

/// Backup file info for the backup list endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    pub filename: String,
    pub size: i64,
    pub created_at: String,
}

// ─── Version ────────────────────────────────────────────────────────────────

/// Version response for the /api/version endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct VersionResponse {
    pub app_version: String,
    pub schema_version: String,
}

// ─── Query ──────────────────────────────────────────────────────────────────

/// Request body for the read-only SQL query endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct QueryRequest {
    pub sql: String,
}

/// Response for the read-only SQL query endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct QueryResponse {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

// ─── Stakeholder (full CRUD) ────────────────────────────────────────────────

/// Request body for creating a stakeholder.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateStakeholder {
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Request body for updating a stakeholder (partial update).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateStakeholder {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Stakeholder summary response (includes project associations).
#[derive(Debug, Clone, Serialize)]
pub struct StakeholderSummaryResponse {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    pub project_count: i64,
    pub project_names: Vec<String>,
}

// ─── Lessons (full CRUD) ────────────────────────────────────────────────────

/// Request body for creating a lesson learned.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateLesson {
    pub title: String,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub lesson: Option<String>,
    #[serde(default)]
    pub application: Option<String>,
    #[serde(default)]
    pub source_entry_id: Option<i64>,
    #[serde(default)]
    pub source_project_id: Option<i64>,
    #[serde(default)]
    pub date_range_start: Option<String>,
    #[serde(default)]
    pub date_range_end: Option<String>,
    #[serde(default)]
    pub date_range_label: Option<String>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

/// Request body for updating a lesson learned (partial update).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateLesson {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
    #[serde(default)]
    pub lesson: Option<String>,
    #[serde(default)]
    pub application: Option<String>,
    #[serde(default)]
    pub source_entry_id: Option<i64>,
    #[serde(default)]
    pub source_project_id: Option<i64>,
    #[serde(default)]
    pub date_range_start: Option<String>,
    #[serde(default)]
    pub date_range_end: Option<String>,
    #[serde(default)]
    pub date_range_label: Option<String>,
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
}

// ─── Tags (full CRUD) ───────────────────────────────────────────────────────

/// Request body for creating a tag.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateTag {
    pub name: String,
}

/// Request body for updating a tag.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTag {
    pub name: String,
}

// ─── Links (full CRUD) ──────────────────────────────────────────────────────

/// Request body for creating a link.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateLink {
    pub parent_type: String,
    pub parent_id: i64,
    pub url: String,
    #[serde(default)]
    pub label: Option<String>,
}

// ─── Scheduled Item Completion/Skip ─────────────────────────────────────────

/// Request body for completing a scheduled item instance.
#[derive(Debug, Clone, Deserialize)]
pub struct CompleteRequest {
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
}

/// Request body for skipping a scheduled item instance.
#[derive(Debug, Clone, Deserialize)]
pub struct SkipRequest {
    pub due_date: String,
    #[serde(default)]
    pub reason: Option<String>,
}

/// Response for the due-today endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct DueTodayResponse {
    pub today: Vec<serde_json::Value>,
    pub overdue: Vec<serde_json::Value>,
    pub completed_today: i64,
    pub pending_today: i64,
    pub skipped_today: i64,
}

// ─── Progress Log (shared create) ──────────────────────────────────────────

/// Generic request body for adding a progress log entry.
#[derive(Debug, Clone, Deserialize)]
pub struct ProgressLogCreate {
    pub note: String,
    #[serde(default)]
    pub status_at_time: Option<String>,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_template_type() -> String {
    "modular".to_string()
}

fn default_scope() -> String {
    "week".to_string()
}

fn default_sections() -> String {
    "{}".to_string()
}

fn default_draft_status() -> String {
    "draft".to_string()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_response_serialization() {
        let resp = ErrorResponse {
            detail: "Entry not found".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["detail"], "Entry not found");
    }

    #[test]
    fn test_id_response_serialization() {
        let resp = IdResponse { id: 42 };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], 42);
    }

    #[test]
    fn test_report_preset_response_serialization() {
        let resp = ReportPresetResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            name: "Weekly Update".to_string(),
            template_type: "modular".to_string(),
            scope: "week".to_string(),
            program_id: Some(3),
            sections: "{}".to_string(),
            is_default: 1,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "Weekly Update");
        assert_eq!(json["template_type"], "modular");
        assert_eq!(json["scope"], "week");
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["is_default"], 1);
    }

    #[test]
    fn test_report_preset_response_null_program() {
        let resp = ReportPresetResponse {
            id: 2,
            created_at: "2025-01-15T10:00:00".to_string(),
            name: "All Programs".to_string(),
            template_type: "leadership_update".to_string(),
            scope: "month".to_string(),
            program_id: None,
            sections: r#"{"executive_summary": true}"#.to_string(),
            is_default: 0,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("program_id").is_none());
    }

    #[test]
    fn test_create_report_preset_deserialization_minimal() {
        let json = r#"{"name": "My Preset"}"#;
        let preset: CreateReportPreset = serde_json::from_str(json).unwrap();
        assert_eq!(preset.name, "My Preset");
        assert_eq!(preset.template_type, "modular");
        assert_eq!(preset.scope, "week");
        assert_eq!(preset.sections, "{}");
        assert_eq!(preset.is_default, 0);
        assert!(preset.program_id.is_none());
    }

    #[test]
    fn test_update_report_preset_deserialization_partial() {
        let json = r#"{"name": "Updated Name", "is_default": 1}"#;
        let update: UpdateReportPreset = serde_json::from_str(json).unwrap();
        assert_eq!(update.name, Some("Updated Name".to_string()));
        assert_eq!(update.is_default, Some(1));
        assert!(update.template_type.is_none());
        assert!(update.scope.is_none());
        assert!(update.program_id.is_none());
        assert!(update.sections.is_none());
    }

    #[test]
    fn test_report_draft_response_serialization() {
        let resp = ReportDraftResponse {
            id: 1,
            title: "Weekly Report".to_string(),
            content: "# Report\n\nContent".to_string(),
            status: "draft".to_string(),
            preset_id: Some(2),
            date_range_start: Some("2025-01-13".to_string()),
            date_range_end: Some("2025-01-19".to_string()),
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T12:00:00".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["title"], "Weekly Report");
        assert_eq!(json["status"], "draft");
        assert_eq!(json["preset_id"], 2);
        assert_eq!(json["date_range_start"], "2025-01-13");
    }

    #[test]
    fn test_report_draft_response_null_optionals() {
        let resp = ReportDraftResponse {
            id: 3,
            title: "Quick Draft".to_string(),
            content: "Notes".to_string(),
            status: "draft".to_string(),
            preset_id: None,
            date_range_start: None,
            date_range_end: None,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("preset_id").is_none());
        assert!(json.get("date_range_start").is_none());
        assert!(json.get("date_range_end").is_none());
    }

    #[test]
    fn test_create_report_draft_deserialization() {
        let json = r##"{
            "title": "New Draft",
            "content": "# Content",
            "preset_id": 1,
            "date_range_start": "2025-01-01",
            "date_range_end": "2025-01-31"
        }"##;
        let draft: CreateReportDraft = serde_json::from_str(json).unwrap();
        assert_eq!(draft.title, "New Draft");
        assert_eq!(draft.content, "# Content");
        assert_eq!(draft.status, "draft");
        assert_eq!(draft.preset_id, Some(1));
        assert_eq!(draft.date_range_start, Some("2025-01-01".to_string()));
    }

    #[test]
    fn test_update_report_draft_deserialization_partial() {
        let json = r#"{"status": "ready"}"#;
        let update: UpdateReportDraft = serde_json::from_str(json).unwrap();
        assert_eq!(update.status, Some("ready".to_string()));
        assert!(update.title.is_none());
        assert!(update.content.is_none());
    }

    #[test]
    fn test_review_session_response_serialization() {
        let resp = ReviewSessionResponse {
            id: 1,
            review_date: "2025-01-19".to_string(),
            date_range_start: "2025-01-13".to_string(),
            date_range_end: "2025-01-19".to_string(),
            review_type: "weekly".to_string(),
            session_notes: Some("Good week overall".to_string()),
            created_at: "2025-01-19T10:00:00".to_string(),
            program_id: Some(3),
            notes: vec![ReviewNoteResponse {
                id: 1,
                review_session_id: 1,
                parent_type: Some("entry".to_string()),
                parent_id: Some(42),
                note_text: "Great progress on this entry".to_string(),
                created_at: "2025-01-19T10:05:00".to_string(),
            }],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["review_type"], "weekly");
        assert_eq!(json["session_notes"], "Good week overall");
        assert_eq!(json["program_id"], 3);
        let notes = json["notes"].as_array().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0]["note_text"], "Great progress on this entry");
        assert_eq!(notes[0]["parent_type"], "entry");
        assert_eq!(notes[0]["parent_id"], 42);
    }

    #[test]
    fn test_review_session_null_optionals() {
        let resp = ReviewSessionResponse {
            id: 2,
            review_date: "2025-01-26".to_string(),
            date_range_start: "2025-01-20".to_string(),
            date_range_end: "2025-01-26".to_string(),
            review_type: "weekly".to_string(),
            session_notes: None,
            created_at: "2025-01-26T10:00:00".to_string(),
            program_id: None,
            notes: vec![],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert!(json.get("session_notes").is_none());
        assert!(json.get("program_id").is_none());
    }

    #[test]
    fn test_review_note_null_parent() {
        let note = ReviewNoteResponse {
            id: 5,
            review_session_id: 2,
            parent_type: None,
            parent_id: None,
            note_text: "General observation".to_string(),
            created_at: "2025-01-26T10:00:00".to_string(),
        };
        let json = serde_json::to_value(&note).unwrap();
        assert!(json.get("parent_type").is_none());
        assert!(json.get("parent_id").is_none());
        assert_eq!(json["note_text"], "General observation");
    }

    #[test]
    fn test_create_review_session_deserialization() {
        let json = r#"{
            "review_date": "2025-01-19",
            "date_range_start": "2025-01-13",
            "date_range_end": "2025-01-19",
            "review_type": "weekly",
            "session_notes": "Notes here",
            "program_id": 3
        }"#;
        let session: CreateReviewSession = serde_json::from_str(json).unwrap();
        assert_eq!(session.review_date, "2025-01-19");
        assert_eq!(session.review_type, "weekly");
        assert_eq!(session.session_notes, Some("Notes here".to_string()));
        assert_eq!(session.program_id, Some(3));
    }

    #[test]
    fn test_create_review_note_deserialization() {
        let json = r#"{"note_text": "Important observation", "parent_type": "goal", "parent_id": 7}"#;
        let note: CreateReviewNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.note_text, "Important observation");
        assert_eq!(note.parent_type, Some("goal".to_string()));
        assert_eq!(note.parent_id, Some(7));
        assert!(note.review_session_id.is_none());
    }

    #[test]
    fn test_prep_note_response_serialization() {
        let resp = PrepNoteResponse {
            id: 1,
            text: "Discuss timeline with manager".to_string(),
            created_at: "2025-01-15T10:00:00".to_string(),
            dismissed_at: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["text"], "Discuss timeline with manager");
        assert!(json.get("dismissed_at").is_none());
    }

    #[test]
    fn test_prep_note_response_dismissed() {
        let resp = PrepNoteResponse {
            id: 2,
            text: "Old note".to_string(),
            created_at: "2025-01-10T10:00:00".to_string(),
            dismissed_at: Some("2025-01-15T14:00:00".to_string()),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["dismissed_at"], "2025-01-15T14:00:00");
    }

    #[test]
    fn test_create_prep_note_deserialization() {
        let json = r#"{"text": "Follow up on deployment"}"#;
        let note: CreatePrepNote = serde_json::from_str(json).unwrap();
        assert_eq!(note.text, "Follow up on deployment");
    }

    #[test]
    fn test_backup_info_serialization() {
        let info = BackupInfo {
            filename: "chronicle_backup_2025-01-15_100000.db".to_string(),
            size: 1048576,
            created_at: "2025-01-15T10:00:00".to_string(),
        };
        let json = serde_json::to_value(&info).unwrap();
        assert_eq!(json["filename"], "chronicle_backup_2025-01-15_100000.db");
        assert_eq!(json["size"], 1048576);
    }

    #[test]
    fn test_version_response_serialization() {
        let resp = VersionResponse {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            schema_version: "3".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["app_version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(json["schema_version"], "3");
    }

    #[test]
    fn test_query_request_deserialization() {
        let json = r#"{"sql": "SELECT * FROM entries LIMIT 10"}"#;
        let req: QueryRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.sql, "SELECT * FROM entries LIMIT 10");
    }

    #[test]
    fn test_query_response_serialization() {
        let resp = QueryResponse {
            columns: vec!["id".to_string(), "title".to_string()],
            rows: vec![
                vec![serde_json::json!(1), serde_json::json!("First entry")],
                vec![serde_json::json!(2), serde_json::json!("Second entry")],
            ],
        };
        let json = serde_json::to_value(&resp).unwrap();
        let cols = json["columns"].as_array().unwrap();
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0], "id");
        assert_eq!(cols[1], "title");
        let rows = json["rows"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0], 1);
        assert_eq!(rows[0][1], "First entry");
    }

    #[test]
    fn test_create_stakeholder_deserialization() {
        let json = r#"{"name": "Alice", "email": "alice@example.com", "role": "PM"}"#;
        let s: CreateStakeholder = serde_json::from_str(json).unwrap();
        assert_eq!(s.name, "Alice");
        assert_eq!(s.email, Some("alice@example.com".to_string()));
        assert_eq!(s.role, Some("PM".to_string()));
        assert!(s.notes.is_none());
    }

    #[test]
    fn test_update_stakeholder_deserialization_partial() {
        let json = r#"{"role": "Tech Lead"}"#;
        let s: UpdateStakeholder = serde_json::from_str(json).unwrap();
        assert!(s.name.is_none());
        assert!(s.email.is_none());
        assert_eq!(s.role, Some("Tech Lead".to_string()));
        assert!(s.notes.is_none());
    }

    #[test]
    fn test_create_lesson_deserialization() {
        let json = r#"{
            "title": "Always test edge cases",
            "context": "During the API rewrite",
            "lesson": "Edge cases caused 80% of bugs",
            "tag_ids": [1, 3]
        }"#;
        let l: CreateLesson = serde_json::from_str(json).unwrap();
        assert_eq!(l.title, "Always test edge cases");
        assert_eq!(l.context, Some("During the API rewrite".to_string()));
        assert_eq!(l.lesson, Some("Edge cases caused 80% of bugs".to_string()));
        assert!(l.application.is_none());
        assert_eq!(l.tag_ids, vec![1, 3]);
    }

    #[test]
    fn test_create_tag_deserialization() {
        let json = r#"{"name": "rust"}"#;
        let tag: CreateTag = serde_json::from_str(json).unwrap();
        assert_eq!(tag.name, "rust");
    }

    #[test]
    fn test_create_link_deserialization() {
        let json = r#"{"parent_type": "entry", "parent_id": 5, "url": "https://example.com", "label": "Reference"}"#;
        let link: CreateLink = serde_json::from_str(json).unwrap();
        assert_eq!(link.parent_type, "entry");
        assert_eq!(link.parent_id, 5);
        assert_eq!(link.url, "https://example.com");
        assert_eq!(link.label, Some("Reference".to_string()));
    }

    #[test]
    fn test_complete_request_deserialization() {
        let json = r#"{"due_date": "2025-01-15", "notes": "Done early"}"#;
        let req: CompleteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.due_date, Some("2025-01-15".to_string()));
        assert_eq!(req.notes, Some("Done early".to_string()));
        assert!(req.description.is_none());
    }

    #[test]
    fn test_skip_request_deserialization() {
        let json = r#"{"due_date": "2025-01-15", "reason": "Holiday"}"#;
        let req: SkipRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.due_date, "2025-01-15");
        assert_eq!(req.reason, Some("Holiday".to_string()));
    }

    #[test]
    fn test_heatmap_entry_serialization() {
        let entry = HeatmapEntry {
            date: "2025-01-15".to_string(),
            count: 5,
            dominant_program_id: Some(3),
            dominant_program_color: Some("#4A90D9".to_string()),
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["date"], "2025-01-15");
        assert_eq!(json["count"], 5);
        assert_eq!(json["dominant_program_id"], 3);
        assert_eq!(json["dominant_program_color"], "#4A90D9");
    }

    #[test]
    fn test_heatmap_entry_null_program() {
        let entry = HeatmapEntry {
            date: "2025-01-15".to_string(),
            count: 2,
            dominant_program_id: None,
            dominant_program_color: None,
        };
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json["count"], 2);
        assert!(json.get("dominant_program_id").is_none());
        assert!(json.get("dominant_program_color").is_none());
    }

    #[test]
    fn test_due_today_response_serialization() {
        let resp = DueTodayResponse {
            today: vec![serde_json::json!({"id": 1, "name": "Daily standup"})],
            overdue: vec![],
            completed_today: 2,
            pending_today: 1,
            skipped_today: 0,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["completed_today"], 2);
        assert_eq!(json["pending_today"], 1);
        assert_eq!(json["skipped_today"], 0);
        assert_eq!(json["today"].as_array().unwrap().len(), 1);
        assert_eq!(json["overdue"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_progress_log_create_deserialization() {
        let json = r#"{"note": "Making progress", "status_at_time": "on_track"}"#;
        let log: ProgressLogCreate = serde_json::from_str(json).unwrap();
        assert_eq!(log.note, "Making progress");
        assert_eq!(log.status_at_time, Some("on_track".to_string()));
    }

    #[test]
    fn test_progress_log_create_minimal() {
        let json = r#"{"note": "Quick update"}"#;
        let log: ProgressLogCreate = serde_json::from_str(json).unwrap();
        assert_eq!(log.note, "Quick update");
        assert!(log.status_at_time.is_none());
    }
}
