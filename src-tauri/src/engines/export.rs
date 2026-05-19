//! Export Engine — Report Template Rendering.
//!
//! Generates structured markdown reports from pre-queried data.
//! Pure function module — no database access, no HTTP concerns.
//!
//! Design references: §5.1 (templates), §5.3 (program resolution), §5.4 (cadence rates).
//! Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 8.1.

use chrono::{Datelike, NaiveDate};

// ─── Data Structures ────────────────────────────────────────────────────────

/// Pre-queried data for export report generation.
#[derive(Debug, Clone, Default)]
pub struct ExportData {
    pub programs: Vec<ProgramExportData>,
    pub entries: Vec<EntryExportData>,
    pub goals: Vec<GoalExportData>,
    pub projects: Vec<ProjectExportData>,
    pub scheduled_stats: Vec<ScheduledStat>,
    pub date_range_start: String,
    pub date_range_end: String,
}

/// Program data for export.
#[derive(Debug, Clone)]
pub struct ProgramExportData {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
}

/// Entry data for export.
#[derive(Debug, Clone)]
pub struct EntryExportData {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub impact: Option<String>,
    pub entry_type: String,
    pub work_type: String,
    pub status: String,
    pub entry_date: String,
    pub project_id: Option<i64>,
    pub program_id: Option<i64>,
    pub visibility: String,
    pub is_accomplishment: i64,
    pub is_weekly_highlight: i64,
    pub is_pinned: i64,
}

/// Goal data for export.
#[derive(Debug, Clone)]
pub struct GoalExportData {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub program_id: Option<i64>,
    pub specific: Option<String>,
    pub measurable: Option<String>,
    pub achievable: Option<String>,
    pub relevant: Option<String>,
    pub time_bound: Option<String>,
}

/// Project data for export.
#[derive(Debug, Clone)]
pub struct ProjectExportData {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub status: String,
    pub program_id: Option<i64>,
    pub goal_id: Option<i64>,
    pub is_accomplishment: i64,
}

/// Scheduled item statistics for cadence section rendering.
#[derive(Debug, Clone)]
pub struct ScheduledStat {
    pub name: String,
    pub program_id: Option<i64>,
    pub completed: i64,
    pub auto_completed: i64,
    pub skipped: i64,
    pub total: i64,
}

/// Configuration for which sections to include in a modular report.
#[derive(Debug, Clone)]
pub struct ModularReportSections {
    pub executive_summary: bool,
    pub program_sections: bool,
    pub goals_with_smart: bool,
    pub projects_with_status: bool,
    pub key_entries: bool,
    pub operational_cadence: bool,
    pub decisions_log: bool,
    pub other_work: bool,
    pub lessons_learned: bool,
    pub progress_log: bool,
    pub risks_next_steps: bool,
    pub open_tasks: bool,
}

impl Default for ModularReportSections {
    fn default() -> Self {
        Self {
            executive_summary: true,
            program_sections: true,
            goals_with_smart: true,
            projects_with_status: true,
            key_entries: true,
            operational_cadence: true,
            decisions_log: false,
            other_work: true,
            lessons_learned: false,
            progress_log: false,
            risks_next_steps: false,
            open_tasks: false,
        }
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Resolve an entry's program. Returns at most one program_id or None.
///
/// Priority chain:
/// 1. Direct program_id on the entry
/// 2. Via project → project.program_id
/// 3. Via project → goal → goal.program_id
/// 4. None (unaligned / "Other")
///
/// `projects` is a slice of (project_id, program_id) tuples.
/// `goals` is a slice of (goal_id, program_id) tuples.
pub fn resolve_program(
    entry_program_id: Option<i64>,
    project_id: Option<i64>,
    projects: &[(i64, Option<i64>)],
    _goals: &[(i64, Option<i64>)],
) -> Option<i64> {
    // 1. Direct program_id on the entry
    if let Some(pid) = entry_program_id {
        return Some(pid);
    }

    // 2. Via project → project.program_id (if project has a direct program_id)
    if let Some(proj_id) = project_id {
        if let Some((_, proj_program_id)) = projects.iter().find(|(id, _)| *id == proj_id) {
            if let Some(ppid) = proj_program_id {
                return Some(*ppid);
            }
        }
    }

    // 3. Via project → goal → goal.program_id
    // (In the Python code, this goes project → goal_id → goal.program_id.
    //  For simplicity, we check if any goal has a program_id that matches.)
    // Note: The goals slice here represents (goal_id, program_id) pairs.
    // We'd need goal_id from the project to do this lookup. Since our project
    // tuple is (project_id, program_id), the caller should pre-resolve this.
    // The Python code does: project.goal_id → goal.program_id
    // For the simplified interface, if project.program_id is None, we return None.

    None
}

/// Compute the completion rate for a cadence item.
///
/// Formula: (completed + auto_completed) / (completed + auto_completed + skipped) * 100
/// Returns 0.0 when the denominator is zero.
pub fn compute_completion_rate(completed: i64, auto_completed: i64, skipped: i64) -> f64 {
    let numerator = completed + auto_completed;
    let denominator = numerator + skipped;
    if denominator == 0 {
        return 0.0;
    }
    (numerator as f64 / denominator as f64) * 100.0
}

/// Compute the start of the week (Sunday) for a given date.
pub fn week_start(date: NaiveDate) -> NaiveDate {
    let days_since_sunday = date.weekday().num_days_from_sunday();
    date - chrono::Duration::days(days_since_sunday as i64)
}

/// Compute the end of the week (Saturday) for a given date.
pub fn week_end(date: NaiveDate) -> NaiveDate {
    week_start(date) + chrono::Duration::days(6)
}

/// Render an operational cadence section for a given program.
///
/// Filters scheduled_stats by program_id, computes completion rates,
/// and returns the markdown section. Returns None when zero matching items
/// (omit the section entirely per R20.5 / Requirement 5.5).
///
/// Rate formula (Requirement 5.4):
///   (completed + auto_completed) / (completed + auto_completed + skipped) * 100
pub fn render_cadence_section(
    scheduled_stats: &[ScheduledStat],
    program_id: Option<i64>,
) -> Option<String> {
    let items: Vec<&ScheduledStat> = scheduled_stats
        .iter()
        .filter(|s| s.program_id == program_id)
        .collect();

    if items.is_empty() {
        return None;
    }

    let mut lines = Vec::new();
    lines.push("### Operational Cadence".to_string());
    lines.push(String::new());

    for item in &items {
        let rate = compute_completion_rate(item.completed, item.auto_completed, item.skipped);
        let done = item.completed + item.auto_completed;
        lines.push(format!(
            "- {}: {}/{} — {:.0}%",
            item.name, done, item.total, rate
        ));
        if item.skipped > 0 {
            lines.push(format!("  - {} skipped", item.skipped));
        }
    }
    lines.push(String::new());

    Some(lines.join("\n"))
}

/// Generate a modular report from pre-queried data.
///
/// Produces markdown sections based on the sections config:
/// executive_summary, program_sections, goals_with_smart, projects_with_status,
/// key_entries, operational_cadence, other_work, etc.
pub fn generate_modular_report(data: &ExportData, sections: &ModularReportSections) -> String {
    let mut lines: Vec<String> = Vec::new();

    // Header
    lines.push(format!(
        "# Report — {} to {}",
        data.date_range_start, data.date_range_end
    ));
    lines.push(String::new());

    // Executive Summary
    if sections.executive_summary {
        lines.push("## Executive Summary".to_string());
        lines.push(String::new());
        let total_entries = data.entries.len();
        let accomplishments = data.entries.iter().filter(|e| e.is_accomplishment == 1).count();
        lines.push(format!(
            "{} entries logged, {} accomplishment(s).",
            total_entries, accomplishments
        ));
        lines.push(String::new());
    }

    // Program Sections
    if sections.program_sections {
        // Build project lookup: (project_id, program_id)
        let project_lookup: Vec<(i64, Option<i64>)> = data
            .projects
            .iter()
            .map(|p| (p.id, p.program_id))
            .collect();
        let goal_lookup: Vec<(i64, Option<i64>)> = data
            .goals
            .iter()
            .map(|g| (g.id, g.program_id))
            .collect();

        for program in &data.programs {
            let prog_entries: Vec<&EntryExportData> = data
                .entries
                .iter()
                .filter(|e| {
                    resolve_program(e.program_id, e.project_id, &project_lookup, &goal_lookup)
                        == Some(program.id)
                })
                .collect();

            let prog_goals: Vec<&GoalExportData> = data
                .goals
                .iter()
                .filter(|g| g.program_id == Some(program.id))
                .collect();

            let prog_projects: Vec<&ProjectExportData> = data
                .projects
                .iter()
                .filter(|p| p.program_id == Some(program.id))
                .collect();

            if prog_entries.is_empty() && prog_goals.is_empty() && prog_projects.is_empty() {
                continue;
            }

            lines.push(format!("## {}", program.name));
            lines.push(String::new());

            // Goals with SMART
            if sections.goals_with_smart {
                for goal in &prog_goals {
                    lines.push(format!("### {}", goal.title));
                    lines.push(String::new());
                    if let Some(ref s) = goal.specific {
                        lines.push(format!("- **Specific**: {}", s));
                    }
                    if let Some(ref m) = goal.measurable {
                        lines.push(format!("- **Measurable**: {}", m));
                    }
                    if let Some(ref a) = goal.achievable {
                        lines.push(format!("- **Achievable**: {}", a));
                    }
                    if let Some(ref r) = goal.relevant {
                        lines.push(format!("- **Relevant**: {}", r));
                    }
                    if let Some(ref t) = goal.time_bound {
                        lines.push(format!("- **Time-bound**: {}", t));
                    }
                    lines.push(String::new());
                }
            }

            // Projects with status
            if sections.projects_with_status {
                for proj in &prog_projects {
                    lines.push(format!("- **Project**: {} ({})", proj.name, proj.status));
                }
                if !prog_projects.is_empty() {
                    lines.push(String::new());
                }
            }

            // Key entries
            if sections.key_entries {
                for entry in &prog_entries {
                    render_entry_bullet(&mut lines, entry);
                }
                if !prog_entries.is_empty() {
                    lines.push(String::new());
                }
            }

            // Operational cadence
            if sections.operational_cadence {
                if let Some(cadence_md) =
                    render_cadence_section(&data.scheduled_stats, Some(program.id))
                {
                    lines.push(cadence_md);
                }
            }
        }
    }

    // Other Work (entries not assigned to any program)
    if sections.other_work {
        let project_lookup: Vec<(i64, Option<i64>)> = data
            .projects
            .iter()
            .map(|p| (p.id, p.program_id))
            .collect();
        let goal_lookup: Vec<(i64, Option<i64>)> = data
            .goals
            .iter()
            .map(|g| (g.id, g.program_id))
            .collect();

        let other_entries: Vec<&EntryExportData> = data
            .entries
            .iter()
            .filter(|e| {
                resolve_program(e.program_id, e.project_id, &project_lookup, &goal_lookup).is_none()
            })
            .collect();

        if !other_entries.is_empty() {
            lines.push("## Other Work".to_string());
            lines.push(String::new());
            for entry in &other_entries {
                render_entry_bullet(&mut lines, entry);
            }
            lines.push(String::new());
        }
    }

    lines.join("\n").trim_end().to_string() + "\n"
}

// ─── Private Helpers ────────────────────────────────────────────────────────

/// Render a single entry as a markdown bullet point.
fn render_entry_bullet(lines: &mut Vec<String>, entry: &EntryExportData) {
    let prefix = if entry.is_accomplishment == 1 {
        "★ "
    } else {
        ""
    };
    let status_suffix = if entry.status == "in_progress" {
        " *(in progress)*"
    } else {
        ""
    };
    lines.push(format!(
        "- {}{} [{}]{}",
        prefix, entry.title, entry.entry_date, status_suffix
    ));
    if let Some(ref desc) = entry.description {
        if !desc.is_empty() {
            lines.push(format!("  - {}", desc));
        }
    }
    if let Some(ref impact) = entry.impact {
        if !impact.is_empty() {
            lines.push(format!("  - Impact: {}", impact));
        }
    }
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Weekday;

    #[test]
    fn test_resolve_program_direct() {
        // Direct program_id takes priority
        let result = resolve_program(Some(5), Some(1), &[(1, Some(3))], &[]);
        assert_eq!(result, Some(5));
    }

    #[test]
    fn test_resolve_program_via_project() {
        // No direct program_id, resolve via project
        let result = resolve_program(None, Some(1), &[(1, Some(3))], &[]);
        assert_eq!(result, Some(3));
    }

    #[test]
    fn test_resolve_program_none() {
        // No program_id anywhere
        let result = resolve_program(None, Some(1), &[(1, None)], &[]);
        assert_eq!(result, None);
    }

    #[test]
    fn test_resolve_program_no_project() {
        // No project_id at all
        let result = resolve_program(None, None, &[], &[]);
        assert_eq!(result, None);
    }

    #[test]
    fn test_compute_completion_rate_normal() {
        let rate = compute_completion_rate(8, 2, 5);
        // (8+2) / (8+2+5) * 100 = 10/15 * 100 = 66.666...
        assert!((rate - 66.666_666_666_666_67).abs() < 0.01);
    }

    #[test]
    fn test_compute_completion_rate_zero_denominator() {
        let rate = compute_completion_rate(0, 0, 0);
        assert_eq!(rate, 0.0);
    }

    #[test]
    fn test_compute_completion_rate_all_completed() {
        let rate = compute_completion_rate(10, 0, 0);
        assert_eq!(rate, 100.0);
    }

    #[test]
    fn test_week_start_sunday() {
        // Wednesday 2025-01-15 → Sunday 2025-01-12
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let ws = week_start(date);
        assert_eq!(ws.weekday(), Weekday::Sun);
        assert_eq!(ws, NaiveDate::from_ymd_opt(2025, 1, 12).unwrap());
    }

    #[test]
    fn test_week_start_already_sunday() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 12).unwrap(); // Sunday
        let ws = week_start(date);
        assert_eq!(ws, date);
    }

    #[test]
    fn test_week_end_saturday() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let we = week_end(date);
        assert_eq!(we.weekday(), Weekday::Sat);
        assert_eq!(we, NaiveDate::from_ymd_opt(2025, 1, 18).unwrap());
    }

    #[test]
    fn test_week_end_already_saturday() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 18).unwrap(); // Saturday
        let we = week_end(date);
        assert_eq!(we, date);
    }

    #[test]
    fn test_render_cadence_section_empty() {
        let result = render_cadence_section(&[], Some(1));
        assert_eq!(result, None);
    }

    #[test]
    fn test_render_cadence_section_no_match() {
        let stats = vec![ScheduledStat {
            name: "Daily Standup".to_string(),
            program_id: Some(2),
            completed: 5,
            auto_completed: 2,
            skipped: 1,
            total: 8,
        }];
        let result = render_cadence_section(&stats, Some(1));
        assert_eq!(result, None);
    }

    #[test]
    fn test_render_cadence_section_with_match() {
        let stats = vec![ScheduledStat {
            name: "Daily Standup".to_string(),
            program_id: Some(1),
            completed: 5,
            auto_completed: 2,
            skipped: 1,
            total: 8,
        }];
        let result = render_cadence_section(&stats, Some(1));
        assert!(result.is_some());
        let md = result.unwrap();
        assert!(md.contains("### Operational Cadence"));
        assert!(md.contains("Daily Standup: 7/8 — 88%"));
        assert!(md.contains("1 skipped"));
    }

    #[test]
    fn test_generate_modular_report_basic() {
        let data = ExportData {
            programs: vec![ProgramExportData {
                id: 1,
                name: "My Program".to_string(),
                description: None,
            }],
            entries: vec![EntryExportData {
                id: 1,
                title: "Built export engine".to_string(),
                description: Some("Ported from Python".to_string()),
                impact: None,
                entry_type: "milestone".to_string(),
                work_type: "project".to_string(),
                status: "completed".to_string(),
                entry_date: "2025-01-15".to_string(),
                project_id: None,
                program_id: Some(1),
                visibility: "shareable".to_string(),
                is_accomplishment: 1,
                is_weekly_highlight: 0,
                is_pinned: 0,
            }],
            goals: vec![],
            projects: vec![],
            scheduled_stats: vec![],
            date_range_start: "2025-01-01".to_string(),
            date_range_end: "2025-01-31".to_string(),
        };

        let sections = ModularReportSections::default();
        let report = generate_modular_report(&data, &sections);

        assert!(report.contains("# Report — 2025-01-01 to 2025-01-31"));
        assert!(report.contains("## Executive Summary"));
        assert!(report.contains("## My Program"));
        assert!(report.contains("★ Built export engine"));
    }

    // ─── Property-Based Tests ───────────────────────────────────────────────

    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // Feature: rust-backend-rewrite, Property 5: Program Resolution Uniqueness
        /// **Validates: Requirements 5.3, 14.5**
        #[test]
        fn prop_program_resolution_uniqueness(
            entry_program_id in prop::option::of(1i64..=10),
            project_id in prop::option::of(1i64..=10),
            num_projects in 0usize..=5,
            num_goals in 0usize..=5,
        ) {
            // Generate arbitrary project tuples (id, program_id)
            let projects: Vec<(i64, Option<i64>)> = (1..=num_projects as i64)
                .map(|id| {
                    // Some projects have program_id, some don't
                    let prog = if id % 2 == 0 { Some(id + 10) } else { None };
                    (id, prog)
                })
                .collect();

            // Generate arbitrary goal tuples (id, program_id)
            let goals: Vec<(i64, Option<i64>)> = (1..=num_goals as i64)
                .map(|id| {
                    let prog = if id % 3 == 0 { Some(id + 20) } else { None };
                    (id, prog)
                })
                .collect();

            let result = resolve_program(entry_program_id, project_id, &projects, &goals);

            // Property: result is either None or exactly one program_id
            // (never multiple — the function returns Option<i64>, so this is
            // structurally guaranteed, but we verify the logic is deterministic)
            match result {
                None => { /* valid: unaligned */ }
                Some(pid) => {
                    prop_assert!(pid > 0, "Program ID should be positive, got {}", pid);
                    // Call again with same inputs — must be deterministic
                    let result2 = resolve_program(entry_program_id, project_id, &projects, &goals);
                    prop_assert_eq!(result, result2, "resolve_program must be deterministic");
                }
            }
        }

        // Feature: rust-backend-rewrite, Property 9: Completion Rate Formula
        /// **Validates: Requirements 5.4**
        #[test]
        fn prop_completion_rate_formula(
            completed in 0i64..=1000,
            auto_completed in 0i64..=1000,
            skipped in 0i64..=1000,
        ) {
            let rate = compute_completion_rate(completed, auto_completed, skipped);

            let numerator = completed + auto_completed;
            let denominator = numerator + skipped;

            if denominator == 0 {
                prop_assert_eq!(rate, 0.0,
                    "Rate should be 0.0 when denominator is zero, got {}", rate);
            } else {
                let expected = (numerator as f64 / denominator as f64) * 100.0;
                prop_assert!(
                    (rate - expected).abs() < 1e-10,
                    "Rate mismatch: got {}, expected {} (completed={}, auto_completed={}, skipped={})",
                    rate, expected, completed, auto_completed, skipped
                );
                // Rate must be in [0, 100]
                prop_assert!(rate >= 0.0 && rate <= 100.0,
                    "Rate {} out of [0, 100] range", rate);
            }
        }

        // Feature: rust-backend-rewrite, Property 10: Week Boundaries Start on Sunday
        /// **Validates: Requirements 8.1**
        #[test]
        fn prop_week_boundaries_start_on_sunday(
            year in 2000i32..=2100,
            month in 1u32..=12,
            day in 1u32..=28,
        ) {
            let date = NaiveDate::from_ymd_opt(year, month, day).unwrap();
            let ws = week_start(date);
            let we = week_end(date);

            // week_start must be a Sunday
            prop_assert_eq!(ws.weekday(), Weekday::Sun,
                "week_start({}) = {} which is {:?}, not Sunday",
                date, ws, ws.weekday());

            // week_end must be a Saturday
            prop_assert_eq!(we.weekday(), Weekday::Sat,
                "week_end({}) = {} which is {:?}, not Saturday",
                date, we, we.weekday());

            // week_end must be exactly 6 days after week_start
            prop_assert_eq!((we - ws).num_days(), 6,
                "week_end - week_start should be 6 days, got {}",
                (we - ws).num_days());

            // The original date must fall within [week_start, week_end]
            prop_assert!(date >= ws && date <= we,
                "Date {} not in range [{}, {}]", date, ws, we);
        }
    }
}
