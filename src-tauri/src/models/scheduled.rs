//! Scheduled item and instance models — Create, Update, and Response structs.
//!
//! Field names match the Python Pydantic models exactly (snake_case).
//! The schema supports both one-time tasks and recurring cadence items.

use serde::{Deserialize, Serialize};

// ─── Scheduled Instance Response ────────────────────────────────────────────

/// Response for a scheduled item instance (one occurrence of a recurring/one-time item).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledInstanceResponse {
    pub id: i64,
    pub scheduled_item_id: i64,
    pub created_at: String,
    pub due_date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_time: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_id: Option<i64>,
}

// ─── Scheduled Item Response ────────────────────────────────────────────────

/// Full scheduled item response matching the Python `ScheduledItemResponse` Pydantic model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledItemResponse {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recurrence_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_of_week: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_of_month: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub month_of_year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_of_day: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_range_start: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_range_end: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<i64>,
    pub template_entry_type: String,
    pub template_work_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_tags: Option<String>,
    pub template_visibility: String,
    pub quick_complete: i64,
    pub status: String,
    pub sort_order: i64,
    pub item_class: String,
    pub show_on_today: i64,
    pub require_acknowledgment: i64,
    /// Joined instances for this scheduled item.
    pub instances: Vec<ScheduledInstanceResponse>,
    /// Joined program name (resolved from program_id).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program_name: Option<String>,
    /// Joined project name (resolved from project_id).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
}

// ─── Create Scheduled Item ──────────────────────────────────────────────────

/// Request body for creating a new scheduled item.
///
/// Required fields: name.
/// Optional fields default to sensible values matching the schema defaults.
///
/// v3.0: When `auto_complete` is true and `item_class` is 'task', the item is
/// created AND immediately completed in a single transaction, producing an entry.
/// The `completion_details` field provides the entry metadata for this flow.
#[derive(Debug, Clone, Deserialize)]
pub struct CreateScheduledItem {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_mode")]
    pub mode: String,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub recurrence_type: Option<String>,
    #[serde(default)]
    pub day_of_week: Option<i64>,
    #[serde(default)]
    pub day_of_month: Option<i64>,
    #[serde(default)]
    pub month_of_year: Option<i64>,
    #[serde(default)]
    pub time_of_day: Option<String>,
    #[serde(default)]
    pub day_range_start: Option<i64>,
    #[serde(default)]
    pub day_range_end: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default = "default_template_entry_type")]
    pub template_entry_type: String,
    #[serde(default = "default_template_work_type")]
    pub template_work_type: String,
    #[serde(default)]
    pub template_tags: Option<String>,
    #[serde(default = "default_template_visibility")]
    pub template_visibility: String,
    #[serde(default)]
    pub quick_complete: i64,
    #[serde(default)]
    pub sort_order: i64,
    #[serde(default)]
    pub item_class: Option<String>,
    #[serde(default)]
    pub require_acknowledgment: i64,
    /// v3.0: When true, immediately complete the task after creation (Log mode flow).
    #[serde(default)]
    pub auto_complete: bool,
    /// v3.0: Entry details to use when auto_complete is true.
    #[serde(default)]
    pub completion_details: Option<CompletionDetails>,
}

/// Details for the entry created during task completion (v3.0 unified flow).
#[derive(Debug, Clone, Deserialize)]
pub struct CompletionDetails {
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub impact: Option<String>,
    #[serde(default)]
    pub metrics: Option<String>,
    #[serde(default)]
    pub visibility: Option<String>,
    #[serde(default)]
    pub entry_type: Option<String>,
}

// ─── Update Scheduled Item ──────────────────────────────────────────────────

/// Request body for updating an existing scheduled item (partial update — all fields optional).
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateScheduledItem {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub recurrence_type: Option<String>,
    #[serde(default)]
    pub day_of_week: Option<i64>,
    #[serde(default)]
    pub day_of_month: Option<i64>,
    #[serde(default)]
    pub month_of_year: Option<i64>,
    #[serde(default)]
    pub time_of_day: Option<String>,
    #[serde(default)]
    pub day_range_start: Option<i64>,
    #[serde(default)]
    pub day_range_end: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub template_entry_type: Option<String>,
    #[serde(default)]
    pub template_work_type: Option<String>,
    #[serde(default)]
    pub template_tags: Option<String>,
    #[serde(default)]
    pub template_visibility: Option<String>,
    #[serde(default)]
    pub quick_complete: Option<i64>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub item_class: Option<String>,
    #[serde(default)]
    pub show_on_today: Option<i64>,
    #[serde(default)]
    pub require_acknowledgment: Option<i64>,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_mode() -> String {
    "one_time".to_string()
}

fn default_template_entry_type() -> String {
    "operational_rhythm".to_string()
}

fn default_template_work_type() -> String {
    "operational_rhythm".to_string()
}

fn default_template_visibility() -> String {
    "shareable".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_scheduled_item_deserialization_minimal() {
        let json = r#"{"name": "Daily standup"}"#;
        let item: CreateScheduledItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.name, "Daily standup");
        assert_eq!(item.mode, "one_time");
        assert_eq!(item.template_entry_type, "operational_rhythm");
        assert_eq!(item.template_work_type, "operational_rhythm");
        assert_eq!(item.template_visibility, "shareable");
        assert_eq!(item.quick_complete, 0);
        assert_eq!(item.sort_order, 0);
        assert_eq!(item.require_acknowledgment, 0);
        assert!(item.description.is_none());
        assert!(item.due_date.is_none());
        assert!(item.recurrence_type.is_none());
        assert!(item.day_of_week.is_none());
        assert!(item.day_of_month.is_none());
        assert!(item.month_of_year.is_none());
        assert!(item.time_of_day.is_none());
        assert!(item.day_range_start.is_none());
        assert!(item.day_range_end.is_none());
        assert!(item.program_id.is_none());
        assert!(item.project_id.is_none());
        assert!(item.template_tags.is_none());
        assert!(item.item_class.is_none());
    }

    #[test]
    fn test_create_scheduled_item_deserialization_full() {
        let json = r#"{
            "name": "Weekly report",
            "description": "Submit weekly status report",
            "mode": "recurring",
            "due_date": "2025-01-06",
            "recurrence_type": "weekly",
            "day_of_week": 2,
            "day_of_month": null,
            "month_of_year": null,
            "time_of_day": "09:00",
            "day_range_start": 2,
            "day_range_end": 6,
            "program_id": 3,
            "project_id": 5,
            "template_entry_type": "project_update",
            "template_work_type": "project",
            "template_tags": "weekly,report",
            "template_visibility": "personal",
            "quick_complete": 1,
            "sort_order": 10,
            "item_class": "cadence",
            "require_acknowledgment": 1
        }"#;
        let item: CreateScheduledItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.name, "Weekly report");
        assert_eq!(item.description, Some("Submit weekly status report".to_string()));
        assert_eq!(item.mode, "recurring");
        assert_eq!(item.due_date, Some("2025-01-06".to_string()));
        assert_eq!(item.recurrence_type, Some("weekly".to_string()));
        assert_eq!(item.day_of_week, Some(2));
        assert!(item.day_of_month.is_none());
        assert!(item.month_of_year.is_none());
        assert_eq!(item.time_of_day, Some("09:00".to_string()));
        assert_eq!(item.day_range_start, Some(2));
        assert_eq!(item.day_range_end, Some(6));
        assert_eq!(item.program_id, Some(3));
        assert_eq!(item.project_id, Some(5));
        assert_eq!(item.template_entry_type, "project_update");
        assert_eq!(item.template_work_type, "project");
        assert_eq!(item.template_tags, Some("weekly,report".to_string()));
        assert_eq!(item.template_visibility, "personal");
        assert_eq!(item.quick_complete, 1);
        assert_eq!(item.sort_order, 10);
        assert_eq!(item.item_class, Some("cadence".to_string()));
        assert_eq!(item.require_acknowledgment, 1);
    }

    #[test]
    fn test_update_scheduled_item_deserialization_partial() {
        let json = r#"{
            "name": "Updated name",
            "status": "paused",
            "show_on_today": 0
        }"#;
        let update: UpdateScheduledItem = serde_json::from_str(json).unwrap();
        assert_eq!(update.name, Some("Updated name".to_string()));
        assert_eq!(update.status, Some("paused".to_string()));
        assert_eq!(update.show_on_today, Some(0));
        assert!(update.description.is_none());
        assert!(update.mode.is_none());
        assert!(update.due_date.is_none());
        assert!(update.recurrence_type.is_none());
        assert!(update.day_of_week.is_none());
        assert!(update.day_of_month.is_none());
        assert!(update.month_of_year.is_none());
        assert!(update.time_of_day.is_none());
        assert!(update.program_id.is_none());
        assert!(update.project_id.is_none());
        assert!(update.quick_complete.is_none());
        assert!(update.sort_order.is_none());
        assert!(update.item_class.is_none());
        assert!(update.require_acknowledgment.is_none());
    }

    #[test]
    fn test_scheduled_item_response_serialization() {
        let response = ScheduledItemResponse {
            id: 1,
            created_at: "2025-01-15T10:00:00".to_string(),
            updated_at: "2025-01-15T10:00:00".to_string(),
            name: "Daily standup".to_string(),
            description: None,
            mode: "recurring".to_string(),
            due_date: Some("2025-01-06".to_string()),
            recurrence_type: Some("daily".to_string()),
            day_of_week: None,
            day_of_month: None,
            month_of_year: None,
            time_of_day: Some("09:00".to_string()),
            day_range_start: Some(2),
            day_range_end: Some(6),
            program_id: Some(3),
            project_id: None,
            template_entry_type: "operational_rhythm".to_string(),
            template_work_type: "operational_rhythm".to_string(),
            template_tags: None,
            template_visibility: "shareable".to_string(),
            quick_complete: 1,
            status: "active".to_string(),
            sort_order: 0,
            item_class: "cadence".to_string(),
            show_on_today: 1,
            require_acknowledgment: 0,
            instances: vec![],
            program_name: Some("My Program".to_string()),
            project_name: None,
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 1);
        assert_eq!(json["name"], "Daily standup");
        assert_eq!(json["mode"], "recurring");
        assert_eq!(json["recurrence_type"], "daily");
        assert_eq!(json["time_of_day"], "09:00");
        assert_eq!(json["day_range_start"], 2);
        assert_eq!(json["day_range_end"], 6);
        assert_eq!(json["program_id"], 3);
        assert_eq!(json["program_name"], "My Program");
        assert_eq!(json["quick_complete"], 1);
        assert_eq!(json["status"], "active");
        assert_eq!(json["item_class"], "cadence");
        assert_eq!(json["show_on_today"], 1);
        assert_eq!(json["require_acknowledgment"], 0);
        // Optional None fields should be omitted
        assert!(json.get("description").is_none());
        assert!(json.get("day_of_week").is_none());
        assert!(json.get("day_of_month").is_none());
        assert!(json.get("month_of_year").is_none());
        assert!(json.get("project_id").is_none());
        assert!(json.get("template_tags").is_none());
        assert!(json.get("project_name").is_none());
        // Required fields always present
        assert!(json.get("instances").is_some());
    }

    #[test]
    fn test_scheduled_item_response_with_instances() {
        let response = ScheduledItemResponse {
            id: 5,
            created_at: "2025-01-01T00:00:00".to_string(),
            updated_at: "2025-01-15T12:00:00".to_string(),
            name: "Monthly review".to_string(),
            description: Some("Monthly program review".to_string()),
            mode: "recurring".to_string(),
            due_date: Some("2025-01-15".to_string()),
            recurrence_type: Some("monthly".to_string()),
            day_of_week: None,
            day_of_month: Some(15),
            month_of_year: None,
            time_of_day: None,
            day_range_start: None,
            day_range_end: None,
            program_id: Some(3),
            project_id: Some(7),
            template_entry_type: "operational_rhythm".to_string(),
            template_work_type: "operational_rhythm".to_string(),
            template_tags: Some("review,monthly".to_string()),
            template_visibility: "shareable".to_string(),
            quick_complete: 0,
            status: "active".to_string(),
            sort_order: 5,
            item_class: "cadence".to_string(),
            show_on_today: 1,
            require_acknowledgment: 1,
            instances: vec![
                ScheduledInstanceResponse {
                    id: 10,
                    scheduled_item_id: 5,
                    created_at: "2025-01-15T00:00:00".to_string(),
                    due_date: "2025-01-15".to_string(),
                    due_time: Some("14:00".to_string()),
                    status: "completed".to_string(),
                    resolved_at: Some("2025-01-15T14:30:00".to_string()),
                    notes: Some("Completed on time".to_string()),
                    skip_reason: None,
                    entry_id: Some(42),
                },
                ScheduledInstanceResponse {
                    id: 11,
                    scheduled_item_id: 5,
                    created_at: "2025-02-15T00:00:00".to_string(),
                    due_date: "2025-02-15".to_string(),
                    due_time: None,
                    status: "pending".to_string(),
                    resolved_at: None,
                    notes: None,
                    skip_reason: None,
                    entry_id: None,
                },
            ],
            program_name: Some("My Program".to_string()),
            project_name: Some("Chronicle Rewrite".to_string()),
        };

        let json = serde_json::to_value(&response).unwrap();
        assert_eq!(json["id"], 5);
        assert_eq!(json["day_of_month"], 15);
        assert_eq!(json["template_tags"], "review,monthly");
        assert_eq!(json["require_acknowledgment"], 1);
        assert_eq!(json["program_name"], "My Program");
        assert_eq!(json["project_name"], "Chronicle Rewrite");

        // Verify instances
        let instances = json["instances"].as_array().unwrap();
        assert_eq!(instances.len(), 2);

        // First instance — completed
        assert_eq!(instances[0]["id"], 10);
        assert_eq!(instances[0]["scheduled_item_id"], 5);
        assert_eq!(instances[0]["due_date"], "2025-01-15");
        assert_eq!(instances[0]["due_time"], "14:00");
        assert_eq!(instances[0]["status"], "completed");
        assert_eq!(instances[0]["resolved_at"], "2025-01-15T14:30:00");
        assert_eq!(instances[0]["notes"], "Completed on time");
        assert!(instances[0].get("skip_reason").is_none());
        assert_eq!(instances[0]["entry_id"], 42);

        // Second instance — pending
        assert_eq!(instances[1]["id"], 11);
        assert_eq!(instances[1]["status"], "pending");
        assert!(instances[1].get("due_time").is_none());
        assert!(instances[1].get("resolved_at").is_none());
        assert!(instances[1].get("notes").is_none());
        assert!(instances[1].get("entry_id").is_none());
    }

    #[test]
    fn test_scheduled_instance_response_serialization_skipped() {
        let instance = ScheduledInstanceResponse {
            id: 20,
            scheduled_item_id: 3,
            created_at: "2025-01-10T00:00:00".to_string(),
            due_date: "2025-01-10".to_string(),
            due_time: None,
            status: "skipped".to_string(),
            resolved_at: Some("2025-01-10T08:00:00".to_string()),
            notes: None,
            skip_reason: Some("Holiday".to_string()),
            entry_id: None,
        };

        let json = serde_json::to_value(&instance).unwrap();
        assert_eq!(json["id"], 20);
        assert_eq!(json["status"], "skipped");
        assert_eq!(json["skip_reason"], "Holiday");
        assert_eq!(json["resolved_at"], "2025-01-10T08:00:00");
        assert!(json.get("due_time").is_none());
        assert!(json.get("notes").is_none());
        assert!(json.get("entry_id").is_none());
    }
}
