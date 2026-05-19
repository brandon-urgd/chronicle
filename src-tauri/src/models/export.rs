//! Export models — Request and Response structs for the export/report generation domain.
//!
//! Field names match the Python Pydantic models exactly (snake_case).

use serde::{Deserialize, Serialize};

// ─── Export Request ─────────────────────────────────────────────────────────

/// Request body for generating an export/report.
///
/// Matches the Python `ExportRequest` Pydantic model.
#[derive(Debug, Clone, Deserialize)]
pub struct ExportRequest {
    pub template_type: String,
    #[serde(default)]
    pub date_range_start: Option<String>,
    #[serde(default)]
    pub date_range_end: Option<String>,
    #[serde(default)]
    pub fiscal_year: Option<i64>,
    #[serde(default)]
    pub program_id: Option<i64>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub sections: Option<ModularReportSections>,
    #[serde(default)]
    pub filters: Option<serde_json::Value>,
}

// ─── Export Response ────────────────────────────────────────────────────────

/// Response body for a generated export/report.
///
/// Matches the Python `ExportResponse` Pydantic model.
#[derive(Debug, Clone, Serialize)]
pub struct ExportResponse {
    pub markdown: String,
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured: Option<serde_json::Value>,
}

// ─── Modular Report Sections ────────────────────────────────────────────────

/// Configuration for which sections to include in a modular report.
///
/// Matches the Python `ModularReportSections` Pydantic model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModularReportSections {
    #[serde(default = "default_true")]
    pub executive_summary: bool,
    #[serde(default = "default_true")]
    pub program_sections: bool,
    #[serde(default = "default_true")]
    pub goals_with_smart: bool,
    #[serde(default = "default_true")]
    pub projects_with_status: bool,
    #[serde(default = "default_true")]
    pub key_entries: bool,
    #[serde(default = "default_true")]
    pub operational_cadence: bool,
    #[serde(default)]
    pub decisions_log: bool,
    #[serde(default = "default_true")]
    pub other_work: bool,
    #[serde(default)]
    pub lessons_learned: bool,
    #[serde(default)]
    pub progress_log: bool,
    #[serde(default)]
    pub risks_next_steps: bool,
    #[serde(default)]
    pub open_tasks: bool,
}

// ─── Data Management ────────────────────────────────────────────────────────

/// Response for a data export operation.
#[derive(Debug, Clone, Serialize)]
pub struct DataExportResponse {
    pub filename: String,
    pub message: String,
}

/// Response for a data import operation.
#[derive(Debug, Clone, Serialize)]
pub struct DataImportResponse {
    pub message: String,
    pub tables_imported: i64,
}

/// Response for a data validation operation.
#[derive(Debug, Clone, Serialize)]
pub struct DataValidateResponse {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<serde_json::Value>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

/// Request body for importing data.
#[derive(Debug, Clone, Deserialize)]
pub struct ImportRequest {
    pub data: serde_json::Value,
}

// ─── Default value helpers ──────────────────────────────────────────────────

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_export_request_deserialization_minimal() {
        let json = r#"{"template_type": "leadership_update"}"#;
        let req: ExportRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.template_type, "leadership_update");
        assert!(req.date_range_start.is_none());
        assert!(req.date_range_end.is_none());
        assert!(req.fiscal_year.is_none());
        assert!(req.program_id.is_none());
        assert!(req.scope.is_none());
        assert!(req.sections.is_none());
        assert!(req.filters.is_none());
    }

    #[test]
    fn test_export_request_deserialization_full() {
        let json = r#"{
            "template_type": "modular",
            "date_range_start": "2025-01-01",
            "date_range_end": "2025-01-31",
            "fiscal_year": 2025,
            "program_id": 3,
            "scope": "month",
            "sections": {
                "executive_summary": true,
                "decisions_log": true,
                "lessons_learned": false
            },
            "filters": {"project_id": 5}
        }"#;
        let req: ExportRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.template_type, "modular");
        assert_eq!(req.date_range_start, Some("2025-01-01".to_string()));
        assert_eq!(req.date_range_end, Some("2025-01-31".to_string()));
        assert_eq!(req.fiscal_year, Some(2025));
        assert_eq!(req.program_id, Some(3));
        assert_eq!(req.scope, Some("month".to_string()));
        let sections = req.sections.unwrap();
        assert!(sections.executive_summary);
        assert!(sections.decisions_log);
        assert!(!sections.lessons_learned);
    }

    #[test]
    fn test_export_response_serialization() {
        let resp = ExportResponse {
            markdown: "# Report\n\nContent here".to_string(),
            filename: "report_2025-01.md".to_string(),
            structured: None,
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["markdown"], "# Report\n\nContent here");
        assert_eq!(json["filename"], "report_2025-01.md");
        assert!(json.get("structured").is_none());
    }

    #[test]
    fn test_export_response_serialization_with_structured() {
        let resp = ExportResponse {
            markdown: "# Report".to_string(),
            filename: "report.md".to_string(),
            structured: Some(serde_json::json!({"key": "value"})),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["structured"]["key"], "value");
    }

    #[test]
    fn test_modular_report_sections_defaults() {
        let json = r#"{}"#;
        let sections: ModularReportSections = serde_json::from_str(json).unwrap();
        assert!(sections.executive_summary);
        assert!(sections.program_sections);
        assert!(sections.goals_with_smart);
        assert!(sections.projects_with_status);
        assert!(sections.key_entries);
        assert!(sections.operational_cadence);
        assert!(!sections.decisions_log);
        assert!(sections.other_work);
        assert!(!sections.lessons_learned);
        assert!(!sections.progress_log);
        assert!(!sections.risks_next_steps);
        assert!(!sections.open_tasks);
    }

    #[test]
    fn test_import_request_deserialization() {
        let json = r#"{"data": {"entries": [], "programs": []}}"#;
        let req: ImportRequest = serde_json::from_str(json).unwrap();
        assert!(req.data.is_object());
    }

    #[test]
    fn test_data_export_response_serialization() {
        let resp = DataExportResponse {
            filename: "chronicle_backup_2025-01-15.json".to_string(),
            message: "Export completed successfully".to_string(),
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["filename"], "chronicle_backup_2025-01-15.json");
        assert_eq!(json["message"], "Export completed successfully");
    }

    #[test]
    fn test_data_validate_response_serialization() {
        let resp = DataValidateResponse {
            valid: true,
            summary: Some(serde_json::json!({"entries": 42})),
            warnings: vec!["Minor issue".to_string()],
            errors: vec![],
        };
        let json = serde_json::to_value(&resp).unwrap();
        assert_eq!(json["valid"], true);
        assert_eq!(json["summary"]["entries"], 42);
        assert_eq!(json["warnings"][0], "Minor issue");
        assert_eq!(json["errors"].as_array().unwrap().len(), 0);
    }
}
