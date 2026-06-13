//! Program models — Create, Update, and Response structs for the programs domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

use super::entry::{AttachmentResponse, LinkResponse};

// ─── Progress Log ───────────────────────────────────────────────────────────

/// Response for a program progress log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramProgressLogResponse {
    pub id: i64,
    pub program_id: i64,
    pub created_at: String,
    pub note: String,
    pub status_at_time: String,
}

// ─── Program Metrics ────────────────────────────────────────────────────────

/// Computed metrics for a program (populated at query time).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProgramMetrics {
    #[serde(default)]
    pub total_entries: i64,
    #[serde(default)]
    pub active_goals: i64,
    #[serde(default)]
    pub total_goals: i64,
    #[serde(default)]
    pub active_projects: i64,
    #[serde(default)]
    pub total_projects: i64,
    #[serde(default)]
    pub goals_on_track: i64,
    #[serde(default)]
    pub goals_at_risk: i64,
    #[serde(default)]
    pub scheduled_items_count: i64,
    #[serde(default)]
    pub scheduled_completion_rate: f64,
}

// ─── Program Response ───────────────────────────────────────────────────────

/// Full program response matching the Python `ProgramResponse` Pydantic model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgramResponse {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub program_type: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub sort_order: i64,
    pub metrics: ProgramMetrics,
    pub goals: Vec<super::goal::GoalResponse>,
    pub progress_log: Vec<ProgramProgressLogResponse>,
    pub links: Vec<LinkResponse>,
    pub attachments: Vec<AttachmentResponse>,
}

// ─── Create Program ─────────────────────────────────────────────────────────

/// Request body for creating a new program.
///
/// Required fields: name.
/// Optional fields default to sensible values matching the Python backend.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateProgram {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_program_type")]
    pub program_type: String,
    #[serde(default = "default_program_status")]
    pub status: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub sort_order: i64,
}

// ─── Update Program ─────────────────────────────────────────────────────────

/// Request body for updating an existing program (partial update — all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProgram {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub program_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

// ─── Progress Log Create ────────────────────────────────────────────────────

/// Request body for adding a progress log entry to a program.
#[derive(Debug, Clone, Deserialize)]
pub struct ProgressLogCreate {
    pub note: String,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_program_type() -> String {
    "Primary".to_string()
}

fn default_program_status() -> String {
    "active".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_program_deserialization_minimal() {
        let json = r#"{"name": "ACO AI"}"#;
        let program: CreateProgram = serde_json::from_str(json).unwrap();
        assert_eq!(program.name, "ACO AI");
        assert_eq!(program.program_type, "Primary");
        assert_eq!(program.status, "active");
        assert_eq!(program.sort_order, 0);
        assert!(program.description.is_none());
        assert!(program.owner.is_none());
        assert!(program.color.is_none());
    }

    #[test]
    fn test_create_program_deserialization_full() {
        let json = r##"{
            "name": "ACO AI",
            "description": "AI program for ACO",
            "program_type": "Secondary",
            "status": "paused",
            "owner": "Brandon",
            "color": "#FF5733",
            "sort_order": 5
        }"##;
        let program: CreateProgram = serde_json::from_str(json).unwrap();
        assert_eq!(program.name, "ACO AI");
        assert_eq!(program.description, Some("AI program for ACO".to_string()));
        assert_eq!(program.program_type, "Secondary");
        assert_eq!(program.status, "paused");
        assert_eq!(program.owner, Some("Brandon".to_string()));
        assert_eq!(program.color, Some("#FF5733".to_string()));
        assert_eq!(program.sort_order, 5);
    }

    #[test]
    fn test_update_program_deserialization_partial() {
        let json = r#"{"name": "Updated Name", "status": "sunset"}"#;
        let update: UpdateProgram = serde_json::from_str(json).unwrap();
        assert_eq!(update.name, Some("Updated Name".to_string()));
        assert_eq!(update.status, Some("sunset".to_string()));
        assert!(update.description.is_none());
        assert!(update.program_type.is_none());
        assert!(update.owner.is_none());
        assert!(update.color.is_none());
        assert!(update.sort_order.is_none());
    }

    #[test]
    fn test_program_response_serialization() {
        let response = ProgramResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
            name: "ACO AI".to_string(),
            description: None,
            program_type: "Primary".to_string(),
            status: "active".to_string(),
            owner: None,
            color: None,
            sort_order: 0,
            metrics: ProgramMetrics::default(),
            goals: vec![],
            progress_log: vec![],
            links: vec![],
            attachments: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "ACO AI");
        assert_eq!(json["program_type"], "Primary");
        assert_eq!(json["status"], "active");
        assert_eq!(json["sort_order"], 0);
        // Optional None fields should be omitted
        assert!(json.get("description").is_none());
        assert!(json.get("owner").is_none());
        assert!(json.get("color").is_none());
        // Metrics defaults
        assert_eq!(json["metrics"]["total_entries"], 0);
        assert_eq!(json["metrics"]["scheduled_completion_rate"], 0.0);
    }

    #[test]
    fn test_program_progress_log_response_serialization() {
        let log = ProgramProgressLogResponse {
            id: 1,
            program_id: 3,
            created_at: "2025-01-15T10:00:00".to_string(),
            note: "On track for Q1 delivery".to_string(),
            status_at_time: "active".to_string(),
        };

        let json = serde_json::to_value(&log).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["note"], "On track for Q1 delivery");
        assert_eq!(json["status_at_time"], "active");
    }

    #[test]
    fn test_progress_log_create_deserialization() {
        let json = r#"{"note": "Completed milestone 3"}"#;
        let create: ProgressLogCreate = serde_json::from_str(json).unwrap();
        assert_eq!(create.note, "Completed milestone 3");
    }
}
