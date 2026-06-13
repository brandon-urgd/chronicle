//! Entry models — Create, Update, and Response structs for the entries domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

// ─── Joined / Nested Response Types ─────────────────────────────────────────

/// Response for a link record (polymorphic parent: entry, project, goal, lesson, program).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkResponse {
    pub id: i64,
    pub parent_type: String,
    pub parent_id: i64,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub created_at: String,
}

/// Response for an attachment record (polymorphic parent: entry, project, goal, lesson, program).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentResponse {
    pub id: i64,
    pub parent_type: String,
    pub parent_id: i64,
    pub filename: String,
    pub original_name: String,
    pub file_size: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub created_at: String,
}

/// Response for a tag record (used in entry and lesson responses).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagResponse {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

// ─── Entry Response ─────────────────────────────────────────────────────────

/// Full entry response matching the lean v3.1 schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryResponse {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub entry_date: String,
    pub entry_type: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scheduled_item_id: Option<i64>,
    pub status: String,
    pub visibility: String,
    pub is_accomplishment: i64,
    pub is_weekly_highlight: i64,
    pub is_pinned: i64,
    /// Joined tags (TagResponse objects matching Python API).
    pub tags: Vec<TagResponse>,
}

// ─── Create Entry ───────────────────────────────────────────────────────────

/// Request body for creating a new entry.
///
/// Required fields: entry_type, title.
/// Optional fields default to sensible values matching the Python backend.
/// Unrecognized fields (including removed fields like work_type, impact, etc.)
/// are silently ignored via serde default behavior.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateEntry {
    /// Defaults to today if not provided (handled at route level).
    #[serde(default)]
    pub entry_date: Option<String>,
    pub entry_type: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub scheduled_item_id: Option<i64>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_visibility")]
    pub visibility: String,
    #[serde(default)]
    pub is_accomplishment: i64,
    #[serde(default)]
    pub is_weekly_highlight: i64,
    #[serde(default)]
    pub is_pinned: i64,
    /// Tag IDs to associate with this entry (matching Python's `tag_ids` field).
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

// ─── Update Entry ───────────────────────────────────────────────────────────

/// Request body for updating an existing entry (partial update — all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateEntry {
    #[serde(default)]
    pub entry_date: Option<String>,
    #[serde(default)]
    pub entry_type: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub scheduled_item_id: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub is_accomplishment: Option<i64>,
    #[serde(default)]
    pub is_weekly_highlight: Option<i64>,
    #[serde(default)]
    pub is_pinned: Option<i64>,
    /// Tag IDs to replace existing tags (matching Python's `tag_ids` field).
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_status() -> String {
    "completed".to_string()
}

fn default_visibility() -> String {
    "shareable".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_entry_deserialization_minimal() {
        let json = r#"{
            "entry_type": "quick_capture",
            "title": "Test entry"
        }"#;
        let entry: CreateEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.entry_type, "quick_capture");
        assert_eq!(entry.title, "Test entry");
        assert_eq!(entry.status, "completed");
        assert_eq!(entry.visibility, "shareable");
        assert_eq!(entry.is_accomplishment, 0);
        assert_eq!(entry.is_weekly_highlight, 0);
        assert_eq!(entry.is_pinned, 0);
        assert!(entry.tag_ids.is_empty());
        assert!(entry.entry_date.is_none());
        assert!(entry.description.is_none());
    }

    #[test]
    fn test_create_entry_deserialization_full() {
        let json = r#"{
            "entry_date": "2025-01-15",
            "entry_type": "project_update",
            "title": "Completed milestone",
            "description": "Finished the API rewrite",
            "project_id": 5,
            "program_id": 3,
            "scheduled_item_id": 12,
            "status": "in_progress",
            "visibility": "personal",
            "is_accomplishment": 1,
            "is_weekly_highlight": 1,
            "is_pinned": 1,
            "tag_ids": [1, 2, 3]
        }"#;
        let entry: CreateEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.entry_date, Some("2025-01-15".to_string()));
        assert_eq!(entry.entry_type, "project_update");
        assert_eq!(entry.title, "Completed milestone");
        assert_eq!(entry.description, Some("Finished the API rewrite".to_string()));
        assert_eq!(entry.project_id, Some(5));
        assert_eq!(entry.program_id, Some(3));
        assert_eq!(entry.scheduled_item_id, Some(12));
        assert_eq!(entry.status, "in_progress");
        assert_eq!(entry.visibility, "personal");
        assert_eq!(entry.is_accomplishment, 1);
        assert_eq!(entry.is_weekly_highlight, 1);
        assert_eq!(entry.is_pinned, 1);
        assert_eq!(entry.tag_ids, vec![1, 2, 3]);
    }

    #[test]
    fn test_create_entry_ignores_unknown_fields() {
        // Removed fields (work_type, impact, metrics, outcome, is_lesson_learned)
        // should be silently ignored.
        let json = r#"{
            "entry_type": "quick_capture",
            "title": "Test entry",
            "work_type": "project",
            "impact": "Some impact text",
            "metrics": "50%",
            "outcome": "Success",
            "is_lesson_learned": 1
        }"#;
        let entry: CreateEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.entry_type, "quick_capture");
        assert_eq!(entry.title, "Test entry");
    }

    #[test]
    fn test_update_entry_deserialization_partial() {
        let json = r#"{
            "title": "Updated title",
            "is_pinned": 1
        }"#;
        let update: UpdateEntry = serde_json::from_str(json).unwrap();
        assert_eq!(update.title, Some("Updated title".to_string()));
        assert_eq!(update.is_pinned, Some(1));
        assert!(update.entry_date.is_none());
        assert!(update.entry_type.is_none());
        assert!(update.description.is_none());
        assert!(update.tag_ids.is_none());
    }

    #[test]
    fn test_update_entry_ignores_unknown_fields() {
        let json = r#"{
            "title": "Updated",
            "work_type": "project",
            "impact": "text",
            "metrics": "x",
            "outcome": "y",
            "is_lesson_learned": 1
        }"#;
        let update: UpdateEntry = serde_json::from_str(json).unwrap();
        assert_eq!(update.title, Some("Updated".to_string()));
    }

    #[test]
    fn test_entry_response_serialization() {
        let response = EntryResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
            entry_date: "2025-01-15".to_string(),
            entry_type: "quick_capture".to_string(),
            title: "Test".to_string(),
            description: None,
            project_id: None,
            project_name: None,
            program_id: None,
            program_name: None,
            scheduled_item_id: None,
            status: "completed".to_string(),
            visibility: "shareable".to_string(),
            is_accomplishment: 0,
            is_weekly_highlight: 0,
            is_pinned: 0,
            tags: vec![],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["title"], "Test");
        assert_eq!(json["status"], "completed");
        // Optional None fields should be omitted
        assert!(json.get("description").is_none());
        assert!(json.get("project_id").is_none());
        assert!(json.get("program_name").is_none());
        // Removed fields must NOT appear
        assert!(json.get("impact").is_none());
        assert!(json.get("work_type").is_none());
        assert!(json.get("metrics").is_none());
        assert!(json.get("outcome").is_none());
        assert!(json.get("is_lesson_learned").is_none());
        assert!(json.get("links").is_none());
        assert!(json.get("attachments").is_none());
        // Required fields always present
        assert!(json.get("tags").is_some());
    }

    #[test]
    fn test_entry_response_serialization_with_joined_data() {
        let response = EntryResponse {
            id: 42,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T12:00:00".to_string(),
            entry_date: "2025-01-15".to_string(),
            entry_type: "project_update".to_string(),
            title: "Big update".to_string(),
            description: Some("Details here".to_string()),
            project_id: Some(5),
            project_name: Some("Chronicle Rewrite".to_string()),
            program_id: Some(3),
            program_name: Some("ACO AI".to_string()),
            scheduled_item_id: None,
            status: "completed".to_string(),
            visibility: "shareable".to_string(),
            is_accomplishment: 1,
            is_weekly_highlight: 1,
            is_pinned: 0,
            tags: vec![
                TagResponse {
                    id: 1,
                    name: "rust".to_string(),
                    created_at: "2025-01-01T00:00:00".to_string(),
                },
                TagResponse {
                    id: 2,
                    name: "backend".to_string(),
                    created_at: "2025-01-01T00:00:00".to_string(),
                },
            ],
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 42);
        assert_eq!(json["project_id"], 5);
        assert_eq!(json["project_name"], "Chronicle Rewrite");
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["program_name"], "ACO AI");
        assert_eq!(json["is_accomplishment"], 1);
        assert_eq!(json["is_weekly_highlight"], 1);

        // Tags
        let tags = json["tags"].as_array().unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0]["name"], "rust");
        assert_eq!(tags[1]["name"], "backend");
    }

    #[test]
    fn test_link_response_serialization_null_label() {
        let link = LinkResponse {
            id: 1,
            parent_type: "entry".to_string(),
            parent_id: 5,
            url: "https://example.com".to_string(),
            label: None,
            created_at: "2025-01-15T10:00:00".to_string(),
        };

        let json = serde_json::to_value(&link).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["url"], "https://example.com");
        // label should be omitted when None
        assert!(json.get("label").is_none());
    }

    #[test]
    fn test_attachment_response_serialization_null_mime() {
        let attachment = AttachmentResponse {
            id: 1,
            parent_type: "project".to_string(),
            parent_id: 3,
            filename: "stored_file.bin".to_string(),
            original_name: "data.bin".to_string(),
            file_size: 2048,
            mime_type: None,
            created_at: "2025-01-15T10:00:00".to_string(),
        };

        let json = serde_json::to_value(&attachment).unwrap();
        assert_eq!(json["filename"], "stored_file.bin");
        assert_eq!(json["file_size"], 2048);
        // mime_type should be omitted when None
        assert!(json.get("mime_type").is_none());
    }
}
