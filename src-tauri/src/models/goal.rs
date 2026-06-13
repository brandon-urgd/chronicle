//! Goal models — Create, Update, and Response structs for the goals domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

use super::project::ProjectResponse;

// ─── Progress Log ───────────────────────────────────────────────────────────

/// Response for a goal progress log entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalProgressLogResponse {
    pub id: i64,
    pub goal_id: i64,
    pub created_at: String,
    pub note: String,
    pub status_at_time: String,
}

// ─── Goal Response ──────────────────────────────────────────────────────────

/// Full goal response matching the Python `GoalResponse` Pydantic model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalResponse {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specific: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub achievable: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relevant: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_bound: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fiscal_year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quarter: Option<i64>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_date: Option<String>,
    pub is_accomplishment: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_name: Option<String>,
    #[serde(default)]
    pub linked_projects_count: i64,
    pub progress_log: Vec<GoalProgressLogResponse>,
    pub projects: Vec<ProjectResponse>,
}

// ─── Create Goal ────────────────────────────────────────────────────────────

/// Request body for creating a new goal.
///
/// Required fields: title.
/// Optional fields default to sensible values matching the Python backend.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateGoal {
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub specific: Option<String>,
    #[serde(default)]
    pub measurable: Option<String>,
    #[serde(default)]
    pub achievable: Option<String>,
    #[serde(default)]
    pub relevant: Option<String>,
    #[serde(default)]
    pub time_bound: Option<String>,
    #[serde(default)]
    pub fiscal_year: Option<i64>,
    #[serde(default)]
    pub quarter: Option<i64>,
    #[serde(default = "default_goal_status")]
    pub status: String,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub is_accomplishment: i64,
    #[serde(default)]
    pub program_id: Option<i64>,
}

// ─── Update Goal ────────────────────────────────────────────────────────────

/// Request body for updating an existing goal (partial update — all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateGoal {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub specific: Option<String>,
    #[serde(default)]
    pub measurable: Option<String>,
    #[serde(default)]
    pub achievable: Option<String>,
    #[serde(default)]
    pub relevant: Option<String>,
    #[serde(default)]
    pub time_bound: Option<String>,
    #[serde(default)]
    pub fiscal_year: Option<i64>,
    #[serde(default)]
    pub quarter: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub is_accomplishment: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
}

// ─── Progress Log Create ────────────────────────────────────────────────────

/// Request body for adding a progress log entry to a goal.
#[derive(Debug, Clone, Deserialize)]
pub struct GoalProgressLogCreate {
    pub note: String,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_goal_status() -> String {
    "on_track".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_goal_deserialization_minimal() {
        let json = r#"{"title": "Deliver Rust backend"}"#;
        let goal: CreateGoal = serde_json::from_str(json).unwrap();
        assert_eq!(goal.title, "Deliver Rust backend");
        assert_eq!(goal.status, "on_track");
        assert_eq!(goal.is_accomplishment, 0);
        assert!(goal.description.is_none());
        assert!(goal.specific.is_none());
        assert!(goal.measurable.is_none());
        assert!(goal.achievable.is_none());
        assert!(goal.relevant.is_none());
        assert!(goal.time_bound.is_none());
        assert!(goal.fiscal_year.is_none());
        assert!(goal.quarter.is_none());
        assert!(goal.target_date.is_none());
        assert!(goal.program_id.is_none());
    }

    #[test]
    fn test_create_goal_deserialization_full() {
        let json = r#"{
            "title": "Deliver Rust backend",
            "description": "Rewrite Python backend in Rust",
            "specific": "Replace FastAPI with axum",
            "measurable": "Sub-second startup time",
            "achievable": "Team has Rust experience",
            "relevant": "Improves user experience",
            "time_bound": "Q1 2025",
            "fiscal_year": 2025,
            "quarter": 1,
            "status": "at_risk",
            "target_date": "2025-03-31",
            "is_accomplishment": 1,
            "program_id": 3
        }"#;
        let goal: CreateGoal = serde_json::from_str(json).unwrap();
        assert_eq!(goal.title, "Deliver Rust backend");
        assert_eq!(goal.description, Some("Rewrite Python backend in Rust".to_string()));
        assert_eq!(goal.specific, Some("Replace FastAPI with axum".to_string()));
        assert_eq!(goal.measurable, Some("Sub-second startup time".to_string()));
        assert_eq!(goal.achievable, Some("Team has Rust experience".to_string()));
        assert_eq!(goal.relevant, Some("Improves user experience".to_string()));
        assert_eq!(goal.time_bound, Some("Q1 2025".to_string()));
        assert_eq!(goal.fiscal_year, Some(2025));
        assert_eq!(goal.quarter, Some(1));
        assert_eq!(goal.status, "at_risk");
        assert_eq!(goal.target_date, Some("2025-03-31".to_string()));
        assert_eq!(goal.is_accomplishment, 1);
        assert_eq!(goal.program_id, Some(3));
    }

    #[test]
    fn test_update_goal_deserialization_partial() {
        let json = r#"{"title": "Updated goal", "status": "completed"}"#;
        let update: UpdateGoal = serde_json::from_str(json).unwrap();
        assert_eq!(update.title, Some("Updated goal".to_string()));
        assert_eq!(update.status, Some("completed".to_string()));
        assert!(update.description.is_none());
        assert!(update.specific.is_none());
        assert!(update.fiscal_year.is_none());
        assert!(update.program_id.is_none());
    }

    #[test]
    fn test_goal_response_serialization() {
        let response = GoalResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
            title: "Deliver Rust backend".to_string(),
            description: None,
            specific: None,
            measurable: None,
            achievable: None,
            relevant: None,
            time_bound: None,
            fiscal_year: None,
            quarter: None,
            status: "on_track".to_string(),
            target_date: None,
            is_accomplishment: 0,
            program_id: None,
            program_name: None,
            linked_projects_count: 0,
            progress_log: vec![],
            projects: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["title"], "Deliver Rust backend");
        assert_eq!(json["status"], "on_track");
        assert_eq!(json["is_accomplishment"], 0);
        assert_eq!(json["linked_projects_count"], 0);
        // Optional None fields should be omitted
        assert!(json.get("description").is_none());
        assert!(json.get("specific").is_none());
        assert!(json.get("fiscal_year").is_none());
        assert!(json.get("program_id").is_none());
        assert!(json.get("program_name").is_none());
        // Required collections always present
        assert!(json.get("progress_log").is_some());
        assert!(json.get("projects").is_some());
    }

    #[test]
    fn test_goal_response_serialization_with_data() {
        let response = GoalResponse {
            id: 5,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T12:00:00".to_string(),
            title: "Improve startup time".to_string(),
            description: Some("Reduce cold start".to_string()),
            specific: Some("Sub-second startup".to_string()),
            measurable: Some("< 1s measured".to_string()),
            achievable: Some("Rust rewrite".to_string()),
            relevant: Some("User experience".to_string()),
            time_bound: Some("Q1 2025".to_string()),
            fiscal_year: Some(2025),
            quarter: Some(1),
            status: "on_track".to_string(),
            target_date: Some("2025-03-31".to_string()),
            is_accomplishment: 1,
            program_id: Some(3),
            program_name: Some("ACO AI".to_string()),
            linked_projects_count: 2,
            progress_log: vec![GoalProgressLogResponse {
                id: 1,
                goal_id: 5,
                created_at: "2025-01-15T10:00:00".to_string(),
                note: "Making progress".to_string(),
                status_at_time: "on_track".to_string(),
            }],
            projects: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 5);
        assert_eq!(json["fiscal_year"], 2025);
        assert_eq!(json["quarter"], 1);
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["program_name"], "ACO AI");
        assert_eq!(json["linked_projects_count"], 2);
        assert_eq!(json["is_accomplishment"], 1);

        let logs = json["progress_log"].as_array().unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["note"], "Making progress");
        assert_eq!(logs[0]["goal_id"], 5);
    }

    #[test]
    fn test_goal_progress_log_create_deserialization() {
        let json = r#"{"note": "Completed phase 1"}"#;
        let create: GoalProgressLogCreate = serde_json::from_str(json).unwrap();
        assert_eq!(create.note, "Completed phase 1");
    }
}
