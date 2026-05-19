//! Export routes — Report generation endpoints.
//!
//! POST /api/export/report — Generate a markdown report from database data.

use axum::{extract::State, routing::post, Json, Router};

use crate::db::SharedState;
use crate::engines::export::{
    generate_modular_report, ExportData, EntryExportData, GoalExportData,
    ModularReportSections, ProgramExportData, ProjectExportData, ScheduledStat,
};
use crate::error::AppError;
use crate::models::export::{ExportRequest, ExportResponse};

/// Build the export sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/export/report", post(generate_report))
        .with_state(state)
}

/// POST /api/export/report
///
/// Accept an ExportRequest, query data from the database, call the export engine,
/// and return an ExportResponse with the generated markdown.
async fn generate_report(
    State(state): State<SharedState>,
    Json(req): Json<ExportRequest>,
) -> Result<Json<ExportResponse>, AppError> {
    let pool = state.pool.clone();

    let report = tokio::task::spawn_blocking(move || -> Result<ExportResponse, AppError> {
        let conn = pool.get().map_err(|e| AppError::Pool(e))?;

        // Determine date range
        let date_range_start = req.date_range_start.clone().unwrap_or_default();
        let date_range_end = req.date_range_end.clone().unwrap_or_default();

        // Query programs
        let programs = query_programs(&conn, req.program_id)?;

        // Query entries within date range
        let entries = query_entries(&conn, &date_range_start, &date_range_end, req.program_id)?;

        // Query goals
        let goals = query_goals(&conn, req.program_id)?;

        // Query projects
        let projects = query_projects(&conn, req.program_id)?;

        // Query scheduled stats
        let scheduled_stats = query_scheduled_stats(&conn, req.program_id)?;

        let data = ExportData {
            programs,
            entries,
            goals,
            projects,
            scheduled_stats,
            date_range_start: date_range_start.clone(),
            date_range_end: date_range_end.clone(),
        };

        // Generate report based on template type
        let markdown = match req.template_type.as_str() {
            "modular" | "modular_report" => {
                let sections = match req.sections {
                    Some(ref s) => ModularReportSections {
                        executive_summary: s.executive_summary,
                        program_sections: s.program_sections,
                        goals_with_smart: s.goals_with_smart,
                        projects_with_status: s.projects_with_status,
                        key_entries: s.key_entries,
                        operational_cadence: s.operational_cadence,
                        decisions_log: s.decisions_log,
                        other_work: s.other_work,
                        lessons_learned: s.lessons_learned,
                        progress_log: s.progress_log,
                        risks_next_steps: s.risks_next_steps,
                        open_tasks: s.open_tasks,
                    },
                    None => ModularReportSections::default(),
                };
                generate_modular_report(&data, &sections)
            }
            // For other template types, use modular as default for now
            _ => {
                let sections = ModularReportSections::default();
                generate_modular_report(&data, &sections)
            }
        };

        // Generate filename
        let filename = format!(
            "report_{}_{}.md",
            date_range_start.replace('-', ""),
            req.template_type
        );

        Ok(ExportResponse {
            markdown,
            filename,
            structured: None,
        })
    })
    .await
    .map_err(|e| AppError::Internal(format!("Task join error: {}", e)))??;

    Ok(Json(report))
}

// ─── Database Query Helpers ─────────────────────────────────────────────────

fn query_programs(
    conn: &r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    program_id: Option<i64>,
) -> Result<Vec<ProgramExportData>, AppError> {
    let sql = if program_id.is_some() {
        "SELECT id, name, description FROM programs WHERE id = ?1 ORDER BY name"
    } else {
        "SELECT id, name, description FROM programs ORDER BY name"
    };

    let mut stmt = conn.prepare(sql)?;

    let mut results = Vec::new();
    let mut rows = if let Some(pid) = program_id {
        stmt.query(rusqlite::params![pid])?
    } else {
        stmt.query([])?
    };

    while let Some(row) = rows.next()? {
        results.push(ProgramExportData {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
        });
    }

    Ok(results)
}

fn query_entries(
    conn: &r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    date_start: &str,
    date_end: &str,
    program_id: Option<i64>,
) -> Result<Vec<EntryExportData>, AppError> {
    let mut sql = String::from(
        "SELECT id, title, description, impact, entry_type, work_type, status, \
         entry_date, project_id, program_id, visibility, is_accomplishment, \
         is_weekly_highlight, is_pinned \
         FROM entries WHERE 1=1",
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if !date_start.is_empty() {
        sql.push_str(&format!(" AND entry_date >= ?{}", param_idx));
        params.push(Box::new(date_start.to_string()));
        param_idx += 1;
    }
    if !date_end.is_empty() {
        sql.push_str(&format!(" AND entry_date <= ?{}", param_idx));
        params.push(Box::new(date_end.to_string()));
        param_idx += 1;
    }
    if let Some(pid) = program_id {
        sql.push_str(&format!(" AND program_id = ?{}", param_idx));
        params.push(Box::new(pid));
    }
    sql.push_str(" ORDER BY entry_date DESC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut rows = stmt.query(param_refs.as_slice())?;

    let mut results = Vec::new();
    while let Some(row) = rows.next()? {
        results.push(map_entry_row(row)?);
    }

    Ok(results)
}

fn map_entry_row(row: &rusqlite::Row) -> rusqlite::Result<EntryExportData> {
    Ok(EntryExportData {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        impact: row.get(3)?,
        entry_type: row.get(4)?,
        work_type: row.get(5)?,
        status: row.get(6)?,
        entry_date: row.get(7)?,
        project_id: row.get(8)?,
        program_id: row.get(9)?,
        visibility: row.get(10)?,
        is_accomplishment: row.get(11)?,
        is_weekly_highlight: row.get(12)?,
        is_pinned: row.get(13)?,
    })
}

fn query_goals(
    conn: &r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    program_id: Option<i64>,
) -> Result<Vec<GoalExportData>, AppError> {
    let sql = if program_id.is_some() {
        "SELECT id, title, description, status, program_id, specific, measurable, \
         achievable, relevant, time_bound FROM goals WHERE program_id = ?1 ORDER BY title"
    } else {
        "SELECT id, title, description, status, program_id, specific, measurable, \
         achievable, relevant, time_bound FROM goals ORDER BY title"
    };

    let mut stmt = conn.prepare(sql)?;
    let mut results = Vec::new();
    let mut rows = if let Some(pid) = program_id {
        stmt.query(rusqlite::params![pid])?
    } else {
        stmt.query([])?
    };

    while let Some(row) = rows.next()? {
        results.push(map_goal_row(row)?);
    }

    Ok(results)
}

fn map_goal_row(row: &rusqlite::Row) -> rusqlite::Result<GoalExportData> {
    Ok(GoalExportData {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        program_id: row.get(4)?,
        specific: row.get(5)?,
        measurable: row.get(6)?,
        achievable: row.get(7)?,
        relevant: row.get(8)?,
        time_bound: row.get(9)?,
    })
}

fn query_projects(
    conn: &r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    program_id: Option<i64>,
) -> Result<Vec<ProjectExportData>, AppError> {
    let sql = if program_id.is_some() {
        "SELECT id, name, description, status, program_id, goal_id, is_accomplishment \
         FROM projects WHERE program_id = ?1 ORDER BY name"
    } else {
        "SELECT id, name, description, status, program_id, goal_id, is_accomplishment \
         FROM projects ORDER BY name"
    };

    let mut stmt = conn.prepare(sql)?;
    let mut results = Vec::new();
    let mut rows = if let Some(pid) = program_id {
        stmt.query(rusqlite::params![pid])?
    } else {
        stmt.query([])?
    };

    while let Some(row) = rows.next()? {
        results.push(map_project_row(row)?);
    }

    Ok(results)
}

fn map_project_row(row: &rusqlite::Row) -> rusqlite::Result<ProjectExportData> {
    Ok(ProjectExportData {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        status: row.get(3)?,
        program_id: row.get(4)?,
        goal_id: row.get(5)?,
        is_accomplishment: row.get(6)?,
    })
}

fn query_scheduled_stats(
    conn: &r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    program_id: Option<i64>,
) -> Result<Vec<ScheduledStat>, AppError> {
    // Query scheduled items with their instance counts
    let sql = "SELECT si.name, si.program_id, \
        COALESCE(SUM(CASE WHEN sii.status = 'completed' THEN 1 ELSE 0 END), 0) as completed, \
        COALESCE(SUM(CASE WHEN sii.status = 'auto_completed' THEN 1 ELSE 0 END), 0) as auto_completed, \
        COALESCE(SUM(CASE WHEN sii.status = 'skipped' THEN 1 ELSE 0 END), 0) as skipped, \
        COUNT(sii.id) as total \
        FROM scheduled_items si \
        LEFT JOIN scheduled_item_instances sii ON si.id = sii.scheduled_item_id \
        WHERE si.item_class = 'cadence' AND si.mode = 'recurring' \
        GROUP BY si.id \
        HAVING total > 0 \
        ORDER BY si.name";

    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(ScheduledStat {
            name: row.get(0)?,
            program_id: row.get(1)?,
            completed: row.get(2)?,
            auto_completed: row.get(3)?,
            skipped: row.get(4)?,
            total: row.get(5)?,
        })
    })?;

    let stats: Vec<ScheduledStat> = rows.filter_map(|r| r.ok()).collect();

    // Filter by program_id if specified
    if let Some(pid) = program_id {
        Ok(stats
            .into_iter()
            .filter(|s| s.program_id == Some(pid))
            .collect())
    } else {
        Ok(stats)
    }
}
