//! Time Distribution route — entry count breakdown by program and project.
//!
//! Provides a single endpoint:
//! - GET /api/time-distribution?period=month&start=YYYY-MM-DD&end=YYYY-MM-DD
//!
//! Returns percentage distribution of entries across programs with project
//! drill-down and comparison to the equivalent previous period.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{Datelike, Duration, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::db::SharedState;
use crate::error::AppError;

// ─── Request / Response Types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TimeDistributionQuery {
    pub period: Option<String>,  // "week" | "month" | "quarter" | "custom"
    pub start: Option<String>,   // YYYY-MM-DD
    pub end: Option<String>,     // YYYY-MM-DD
}

#[derive(Debug, Serialize)]
pub struct TimeDistributionResponse {
    pub period: String,
    pub start_date: String,
    pub end_date: String,
    pub total_entries: i64,
    pub programs: Vec<ProgramDistribution>,
    pub unassigned: UnassignedDistribution,
    pub comparison: Option<ComparisonData>,
}

#[derive(Debug, Serialize)]
pub struct ProgramDistribution {
    pub program_id: i64,
    pub program_name: String,
    pub color: Option<String>,
    pub entry_count: i64,
    pub percentage: f64,
    pub projects: Vec<ProjectDistribution>,
}

#[derive(Debug, Serialize)]
pub struct ProjectDistribution {
    pub project_id: Option<i64>,
    pub project_name: String,
    pub entry_count: i64,
}

#[derive(Debug, Serialize)]
pub struct UnassignedDistribution {
    pub entry_count: i64,
    pub percentage: f64,
    pub projects: Vec<ProjectDistribution>,
}

#[derive(Debug, Serialize)]
pub struct ComparisonData {
    pub previous_period: String,
    pub deltas: Vec<ProgramDelta>,
}

#[derive(Debug, Serialize)]
pub struct ProgramDelta {
    pub program_id: i64,
    pub program_name: String,
    pub current_pct: f64,
    pub previous_pct: f64,
    pub direction: String, // "up" | "down" | "unchanged"
}

// ─── Router ──────────────────────────────────────────────────────────────────

pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/time-distribution", get(get_time_distribution))
        .with_state(state)
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async fn get_time_distribution(
    State(state): State<SharedState>,
    Query(params): Query<TimeDistributionQuery>,
) -> Result<Json<TimeDistributionResponse>, AppError> {
    let conn = state.pool.get()?;

    let period = params.period.unwrap_or_else(|| "month".to_string());
    let today = Local::now().date_naive();

    // Resolve date range from period
    let (start_date, end_date) = resolve_date_range(&period, params.start.as_deref(), params.end.as_deref(), today)?;
    let start_str = start_date.format("%Y-%m-%d").to_string();
    let end_str = end_date.format("%Y-%m-%d").to_string();

    // Query entry counts grouped by resolved program and project
    let distribution = query_distribution(&conn, &start_str, &end_str)?;

    // Compute comparison with previous period
    let comparison = compute_comparison(&conn, &period, start_date, end_date, &distribution)?;

    // Build response
    let total_entries: i64 = distribution.values().map(|v| v.iter().map(|(_, c)| c).sum::<i64>()).sum::<i64>();
    let unassigned_count = distribution.get(&0i64).map(|v| v.iter().map(|(_, c)| c).sum::<i64>()).unwrap_or(0);

    let mut programs: Vec<ProgramDistribution> = Vec::new();
    for (&program_id, project_entries) in &distribution {
        if program_id == 0 { continue; } // skip unassigned
        let entry_count: i64 = project_entries.iter().map(|(_, c)| c).sum();
        let percentage = if total_entries > 0 { (entry_count as f64 / total_entries as f64) * 100.0 } else { 0.0 };

        // Look up program name and color
        let (program_name, color) = conn.query_row(
            "SELECT name, color FROM programs WHERE id = ?1",
            rusqlite::params![program_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        ).unwrap_or_else(|_| (format!("Program {}", program_id), None));

        let projects: Vec<ProjectDistribution> = project_entries.iter().map(|((proj_id, proj_name), count)| {
            ProjectDistribution {
                project_id: if *proj_id > 0 { Some(*proj_id) } else { None },
                project_name: proj_name.clone(),
                entry_count: *count,
            }
        }).collect();

        programs.push(ProgramDistribution {
            program_id,
            program_name,
            color,
            entry_count,
            percentage: (percentage * 10.0).round() / 10.0, // 1 decimal place
            projects,
        });
    }

    // Sort by entry_count descending
    programs.sort_by(|a, b| b.entry_count.cmp(&a.entry_count));

    let unassigned_pct = if total_entries > 0 { (unassigned_count as f64 / total_entries as f64) * 100.0 } else { 0.0 };

    // Build unassigned project breakdown
    let unassigned_projects: Vec<ProjectDistribution> = distribution.get(&0i64)
        .map(|entries| {
            let mut projects: Vec<ProjectDistribution> = entries.iter().map(|((proj_id, proj_name), count)| {
                ProjectDistribution {
                    project_id: if *proj_id > 0 { Some(*proj_id) } else { None },
                    project_name: if *proj_id > 0 { proj_name.clone() } else { "Other".to_string() },
                    entry_count: *count,
                }
            }).collect();
            // Sort alphabetically, "Other" at the end
            projects.sort_by(|a, b| {
                if a.project_name == "Other" { return std::cmp::Ordering::Greater; }
                if b.project_name == "Other" { return std::cmp::Ordering::Less; }
                a.project_name.cmp(&b.project_name)
            });
            projects
        })
        .unwrap_or_default();

    Ok(Json(TimeDistributionResponse {
        period,
        start_date: start_str,
        end_date: end_str,
        total_entries,
        programs,
        unassigned: UnassignedDistribution {
            entry_count: unassigned_count,
            percentage: (unassigned_pct * 10.0).round() / 10.0,
            projects: unassigned_projects,
        },
        comparison,
    }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Resolve start/end dates from the period type.
fn resolve_date_range(
    period: &str,
    start: Option<&str>,
    end: Option<&str>,
    today: NaiveDate,
) -> Result<(NaiveDate, NaiveDate), AppError> {
    match period {
        "week" => {
            let start = today - Duration::days(6);
            Ok((start, today))
        }
        "month" => {
            let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .unwrap_or(today);
            Ok((start, today))
        }
        "quarter" => {
            let quarter_start_month = ((today.month() - 1) / 3) * 3 + 1;
            let start = NaiveDate::from_ymd_opt(today.year(), quarter_start_month, 1)
                .unwrap_or(today);
            Ok((start, today))
        }
        "custom" => {
            let s = start.and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
                .ok_or_else(|| AppError::Validation("start date required for custom period".to_string()))?;
            let e = end.and_then(|e| NaiveDate::parse_from_str(e, "%Y-%m-%d").ok())
                .ok_or_else(|| AppError::Validation("end date required for custom period".to_string()))?;
            Ok((s, e))
        }
        _ => {
            // Default to month
            let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1)
                .unwrap_or(today);
            Ok((start, today))
        }
    }
}

/// Query entry distribution grouped by program_id and project.
/// Returns: HashMap<program_id, Vec<((project_id, project_name), count)>>
/// program_id=0 means unassigned.
fn query_distribution(
    conn: &rusqlite::Connection,
    start: &str,
    end: &str,
) -> Result<HashMap<i64, Vec<((i64, String), i64)>>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT \
            COALESCE(e.program_id, p.program_id, 0) as resolved_program_id, \
            COALESCE(e.project_id, 0) as resolved_project_id, \
            COALESCE(proj.name, 'Other') as project_name, \
            COUNT(*) as entry_count \
         FROM entries e \
         LEFT JOIN projects proj ON e.project_id = proj.id \
         LEFT JOIN projects p ON e.project_id = p.id \
         WHERE e.entry_date BETWEEN ?1 AND ?2 \
         GROUP BY resolved_program_id, resolved_project_id \
         ORDER BY entry_count DESC"
    )?;

    let mut result: HashMap<i64, Vec<((i64, String), i64)>> = HashMap::new();

    let rows = stmt.query_map(rusqlite::params![start, end], |row| {
        Ok((
            row.get::<_, i64>(0)?,  // resolved_program_id
            row.get::<_, i64>(1)?,  // resolved_project_id
            row.get::<_, String>(2)?, // project_name
            row.get::<_, i64>(3)?,  // entry_count
        ))
    })?;

    for row in rows {
        let (program_id, project_id, project_name, count) = row?;
        result.entry(program_id).or_default().push(((project_id, project_name), count));
    }

    Ok(result)
}

/// Compute comparison data against the equivalent previous period.
fn compute_comparison(
    conn: &rusqlite::Connection,
    period: &str,
    start_date: NaiveDate,
    end_date: NaiveDate,
    current_distribution: &HashMap<i64, Vec<((i64, String), i64)>>,
) -> Result<Option<ComparisonData>, AppError> {
    // Calculate previous period dates
    let (prev_start, prev_end) = match period {
        "week" => {
            let prev_end = start_date - Duration::days(1);
            let prev_start = prev_end - Duration::days(6);
            (prev_start, prev_end)
        }
        "month" => {
            let prev_end = start_date - Duration::days(1);
            let prev_start = NaiveDate::from_ymd_opt(prev_end.year(), prev_end.month(), 1)
                .unwrap_or(prev_end);
            (prev_start, prev_end)
        }
        "quarter" => {
            let prev_end = start_date - Duration::days(1);
            let quarter_start_month = ((prev_end.month() - 1) / 3) * 3 + 1;
            let prev_start = NaiveDate::from_ymd_opt(prev_end.year(), quarter_start_month, 1)
                .unwrap_or(prev_end);
            (prev_start, prev_end)
        }
        "custom" => {
            let duration = end_date - start_date;
            let prev_end = start_date - Duration::days(1);
            let prev_start = prev_end - duration;
            (prev_start, prev_end)
        }
        _ => return Ok(None),
    };

    let prev_start_str = prev_start.format("%Y-%m-%d").to_string();
    let prev_end_str = prev_end.format("%Y-%m-%d").to_string();

    let prev_distribution = query_distribution(conn, &prev_start_str, &prev_end_str)?;

    // Calculate totals
    let current_total: i64 = current_distribution.values()
        .flat_map(|v| v.iter().map(|(_, c)| c))
        .sum();
    let prev_total: i64 = prev_distribution.values()
        .flat_map(|v| v.iter().map(|(_, c)| c))
        .sum();

    if current_total == 0 && prev_total == 0 {
        return Ok(None);
    }

    // Build deltas for each program in the current period
    let mut deltas: Vec<ProgramDelta> = Vec::new();

    for (&program_id, entries) in current_distribution {
        if program_id == 0 { continue; }
        let current_count: i64 = entries.iter().map(|(_, c)| c).sum();
        let current_pct = if current_total > 0 { (current_count as f64 / current_total as f64) * 100.0 } else { 0.0 };

        let prev_count: i64 = prev_distribution.get(&program_id)
            .map(|v| v.iter().map(|(_, c)| c).sum())
            .unwrap_or(0);
        let previous_pct = if prev_total > 0 { (prev_count as f64 / prev_total as f64) * 100.0 } else { 0.0 };

        let direction = if (current_pct - previous_pct).abs() <= 1.0 {
            "unchanged"
        } else if current_pct > previous_pct {
            "up"
        } else {
            "down"
        };

        let program_name = conn.query_row(
            "SELECT name FROM programs WHERE id = ?1",
            rusqlite::params![program_id],
            |row| row.get::<_, String>(0),
        ).unwrap_or_else(|_| format!("Program {}", program_id));

        deltas.push(ProgramDelta {
            program_id,
            program_name,
            current_pct: (current_pct * 10.0).round() / 10.0,
            previous_pct: (previous_pct * 10.0).round() / 10.0,
            direction: direction.to_string(),
        });
    }

    deltas.sort_by(|a, b| b.current_pct.partial_cmp(&a.current_pct).unwrap_or(std::cmp::Ordering::Equal));

    Ok(Some(ComparisonData {
        previous_period: format!("{} to {}", prev_start_str, prev_end_str),
        deltas,
    }))
}
