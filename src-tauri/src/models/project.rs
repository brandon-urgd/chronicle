//! Project models — Create, Update, and Response structs for the projects domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

use super::entry::EntryResponse;

// ─── Progress Log ───────────────────────────────────────────────────────────

/// Response for a project progress log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectProgressLogResponse {
    pub id: i64,
    pub project_id: i64,
    pub created_at: String,
    pub note: String,
    pub status_at_time: String,
}

// ─── Project Response ───────────────────────────────────────────────────────

/// Full project response matching the Python `ProjectResponse` Pydantic model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectResponse {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metrics: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_end_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_end_date: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goal_title: Option<String>,
    pub is_accomplishment: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_name: Option<String>,
    pub entries: Vec<EntryResponse>,
    pub progress_log: Vec<ProjectProgressLogResponse>,
}

// ─── Create Project ─────────────────────────────────────────────────────────

/// Request body for creating a new project.
///
/// Required fields: name.
/// Optional fields default to sensible values matching the Python backend.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateProject {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub metrics: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_end_date: Option<String>,
    #[serde(default = "default_project_status")]
    pub status: String,
    #[serde(default)]
    pub goal_id: Option<i64>,
    #[serde(default)]
    pub is_accomplishment: i64,
    #[serde(default)]
    pub program_id: Option<i64>,
}

// ─── Update Project ─────────────────────────────────────────────────────────

/// Request body for updating an existing project (partial update — all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProject {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub metrics: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_end_date: Option<String>,
    #[serde(default)]
    pub actual_end_date: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub goal_id: Option<i64>,
    #[serde(default)]
    pub is_accomplishment: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
}

// ─── Progress Log Create ────────────────────────────────────────────────────

/// Request body for adding a progress log entry to a project.
#[derive(Debug, Clone, Deserialize)]
pub struct ProjectProgressLogCreate {
    pub note: String,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_project_status() -> String {
    "planning".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_project_deserialization_minimal() {
        let json = r#"{"name": "Chronicle Rewrite"}"#;
        let project: CreateProject = serde_json::from_str(json).unwrap();
        assert_eq!(project.name, "Chronicle Rewrite");
        assert_eq!(project.status, "planning");
        assert_eq!(project.is_accomplishment, 0);
        assert!(project.description.is_none());
        assert!(project.metrics.is_none());
        assert!(project.start_date.is_none());
        assert!(project.target_end_date.is_none());
        assert!(project.goal_id.is_none());
        assert!(project.program_id.is_none());
    }

    #[test]
    fn test_create_project_deserialization_full() {
        let json = r#"{
            "name": "Chronicle Rewrite",
            "description": "Rewrite backend in Rust",
            "metrics": "Startup < 1s",
            "start_date": "2025-01-01",
            "target_end_date": "2025-03-31",
            "status": "active",
            "goal_id": 5,
            "is_accomplishment": 1,
            "program_id": 3
        }"#;
        let project: CreateProject = serde_json::from_str(json).unwrap();
        assert_eq!(project.name, "Chronicle Rewrite");
        assert_eq!(project.description, Some("Rewrite backend in Rust".to_string()));
        assert_eq!(project.metrics, Some("Startup < 1s".to_string()));
        assert_eq!(project.start_date, Some("2025-01-01".to_string()));
        assert_eq!(project.target_end_date, Some("2025-03-31".to_string()));
        assert_eq!(project.status, "active");
        assert_eq!(project.goal_id, Some(5));
        assert_eq!(project.is_accomplishment, 1);
        assert_eq!(project.program_id, Some(3));
    }

    #[test]
    fn test_update_project_deserialization_partial() {
        let json = r#"{"name": "Updated Project", "status": "completed", "actual_end_date": "2025-02-28"}"#;
        let update: UpdateProject = serde_json::from_str(json).unwrap();
        assert_eq!(update.name, Some("Updated Project".to_string()));
        assert_eq!(update.status, Some("completed".to_string()));
        assert_eq!(update.actual_end_date, Some("2025-02-28".to_string()));
        assert!(update.description.is_none());
        assert!(update.metrics.is_none());
        assert!(update.start_date.is_none());
        assert!(update.target_end_date.is_none());
        assert!(update.goal_id.is_none());
        assert!(update.is_accomplishment.is_none());
        assert!(update.program_id.is_none());
    }

    #[test]
    fn test_project_response_serialization() {
        let response = ProjectResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
            name: "Chronicle Rewrite".to_string(),
            description: None,
            metrics: None,
            start_date: None,
            target_end_date: None,
            actual_end_date: None,
            status: "planning".to_string(),
            goal_id: None,
            goal_title: None,
            is_accomplishment: 0,
            program_id: None,
            program_name: None,
            entries: vec![],
            progress_log: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "Chronicle Rewrite");
        assert_eq!(json["status"], "planning");
        assert_eq!(json["is_accomplishment"], 0);
        // Optional None fields should be omitted
        assert!(json.get("description").is_none());
        assert!(json.get("metrics").is_none());
        assert!(json.get("start_date").is_none());
        assert!(json.get("goal_id").is_none());
        assert!(json.get("program_id").is_none());
        assert!(json.get("program_name").is_none());
        // Required collections always present
        assert!(json.get("entries").is_some());
        assert!(json.get("progress_log").is_some());
    }

    #[test]
    fn test_project_response_serialization_with_data() {
        let response = ProjectResponse {
            id: 7,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T12:00:00".to_string(),
            name: "API Rewrite".to_string(),
            description: Some("Full rewrite".to_string()),
            metrics: Some("Latency < 50ms".to_string()),
            start_date: Some("2025-01-01".to_string()),
            target_end_date: Some("2025-03-31".to_string()),
            actual_end_date: None,
            status: "active".to_string(),
            goal_id: Some(5),
            goal_title: Some("Improve performance".to_string()),
            is_accomplishment: 1,
            program_id: Some(3),
            program_name: Some("ACO AI".to_string()),
            entries: vec![],
            progress_log: vec![ProjectProgressLogResponse {
                id: 1,
                project_id: 7,
                created_at: "2025-01-15T10:00:00".to_string(),
                note: "Sprint 1 complete".to_string(),
                status_at_time: "active".to_string(),
            }],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 7);
        assert_eq!(json["goal_id"], 5);
        assert_eq!(json["goal_title"], "Improve performance");
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["program_name"], "ACO AI");
        assert_eq!(json["is_accomplishment"], 1);

        let logs = json["progress_log"].as_array().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["note"], "Sprint 1 complete");
        assert_eq!(logs[0]["project_id"], 7);
    }

    #[test]
    fn test_project_progress_log_create_deserialization() {
        let json = r#"{"note": "Completed database migration"}"#;
        let create: ProjectProgressLogCreate = serde_json::from_str(json).unwrap();
        assert_eq!(create.note, "Completed database migration");
    }
}
