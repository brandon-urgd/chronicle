//! Settings models — Request and Response structs for the settings domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

// ─── Settings Response ──────────────────────────────────────────────────────

/// Response for the settings endpoint — key-value map of all settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsResponse {
    pub settings: serde_json::Value,
}

// ─── Update Settings ────────────────────────────────────────────────────────

/// Request body for batch-updating settings.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateSettings {
    pub settings: serde_json::Value,
}

// ─── Setup Status ───────────────────────────────────────────────────────────

/// Response for the setup status endpoint.
///
/// Indicates whether the user has completed initial setup by checking
/// if key entities exist in the database.
#[derive(Debug, Clone, Serialize)]
pub struct SetupStatusResponse {
    /// True when the user has at least one program, goal, entry, or scheduled item.
    /// This is the field the frontend uses to decide whether to show the Welcome screen.
    pub setup_completed: bool,
    pub has_programs: bool,
    pub has_goals: bool,
    pub has_entries: bool,
    pub has_scheduled_items: bool,
}

// ─── Data Location ──────────────────────────────────────────────────────────

/// Request body for changing the data directory location.
#[derive(Debug, Clone, Deserialize)]
pub struct DataLocationRequest {
    pub path: String,
}

/// Response for the data location endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct DataLocationResponse {
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_response_serialization() {
        let resp = SettingsResponse {
            settings: serde_json::json!({
                "fiscal_year_start_month": "10",
                "theme": "dark",
                "schema_version": "2"
            }),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["settings"]["fiscal_year_start_month"], "10");
        assert_eq!(json["settings"]["theme"], "dark");
        assert_eq!(json["settings"]["schema_version"], "2");
    }

    #[test]
    fn test_update_settings_deserialization() {
        let json = r#"{"settings": {"theme": "light", "fiscal_year_start_month": "1"}}"#;
        let update: UpdateSettings = serde_json::from_str(json).unwrap();
        assert_eq!(update.settings["theme"], "light");
        assert_eq!(update.settings["fiscal_year_start_month"], "1");
    }

    #[test]
    fn test_setup_status_response_serialization() {
        let resp = SetupStatusResponse {
            setup_completed: true,
            has_programs: true,
            has_goals: true,
            has_entries: false,
            has_scheduled_items: false,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["setup_completed"], true);
        assert_eq!(json["has_programs"], true);
        assert_eq!(json["has_goals"], true);
        assert_eq!(json["has_entries"], false);
        assert_eq!(json["has_scheduled_items"], false);
    }

    #[test]
    fn test_data_location_request_deserialization() {
        let json = r#"{"path": "C:\\Users\\Brandon\\Documents\\Chronicle"}"#;
        let req: DataLocationRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.path, "C:\\Users\\Brandon\\Documents\\Chronicle");
    }

    #[test]
    fn test_data_location_response_serialization() {
        let resp = DataLocationResponse {
            path: "C:\\Users\\Brandon\\AppData\\Roaming\\Chronicle".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["path"], "C:\\Users\\Brandon\\AppData\\Roaming\\Chronicle");
    }
}
