//! Scheduled Engine — Instance Generation and Auto-Completion.
//!
//! Generates pending instances for active recurring scheduled items within a
//! rolling lookahead window. Called from dashboard load, scheduled items list,
//! and export endpoints.
//!
//! Design references: §4.2 (core function), §4.3 (due date computation).
//! Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 8.4, 8.5.

use anyhow::Result;
use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::Connection;

// ─── Data Structures ────────────────────────────────────────────────────────

/// Row data needed from the scheduled_items table for due-date computation.
pub struct ScheduledItemRow {
    pub id: i64,
    pub recurrence_type: String,
    pub day_of_week: Option<i64>,
    pub day_of_month: Option<i64>,
    pub due_date: Option<String>,
    pub created_at: String,
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Generate pending instances for all active recurring items within the lookahead window.
///
/// Uses INSERT OR IGNORE so duplicate (scheduled_item_id, due_date) pairs
/// are silently skipped (idempotent). Items with status 'paused' are excluded.
pub fn generate_pending_instances(conn: &Connection, lookahead_days: i64) -> Result<()> {
    let today = chrono::Local::now().date_naive();
    let end = today + chrono::Duration::days(lookahead_days);

    // Read fiscal_year_start_month from settings
    let fiscal_start = get_fiscal_year_start_month(conn);

    // Query active recurring items
    let mut stmt = conn.prepare(
        "SELECT id, recurrence_type, day_of_week, day_of_month, \
                due_date, created_at \
         FROM scheduled_items \
         WHERE mode = 'recurring' AND status = 'active'",
    )?;

    let items: Vec<ScheduledItemRow> = stmt
        .query_map([], |row| {
            Ok(ScheduledItemRow {
                id: row.get(0)?,
                recurrence_type: row.get(1)?,
                day_of_week: row.get(2)?,
                day_of_month: row.get(3)?,
                due_date: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();

    for item in &items {
        // Respect due_date as cadence start: don't generate instances before it
        let mut item_start = today;
        if let Some(ref due_date_str) = item.due_date {
            if let Some(cadence_start) = parse_date(due_date_str) {
                if cadence_start > today {
                    item_start = cadence_start;
                    if item_start > end {
                        continue; // Entirely outside lookahead window
                    }
                }
            }
        }

        let due_dates = compute_due_dates(item, item_start, end, fiscal_start);
        for d in &due_dates {
            conn.execute(
                "INSERT OR IGNORE INTO scheduled_item_instances \
                 (scheduled_item_id, due_date, status) \
                 VALUES (?1, ?2, 'pending')",
                rusqlite::params![item.id, d.format("%Y-%m-%d").to_string()],
            )?;
        }
    }

    Ok(())
}

/// Generate pending instances for a single active recurring item within the lookahead window.
///
/// Mirrors the logic of `generate_pending_instances` but scoped to `item_id`, returning the
/// count of rows actually inserted (not merely IGNOREd). Used by `regenerate_instances_for_item`
/// after the caller has already deleted the item's pending instances, so every generated row
/// is a fresh insert.
///
/// Returns 0 silently if the item does not exist, is not recurring, or is paused — this lets
/// callers treat regenerate as a no-op for non-recurring or inactive items without surfacing
/// a special error.
pub fn generate_pending_instances_for_item(
    conn: &Connection,
    item_id: i64,
    lookahead_days: i64,
) -> Result<i64> {
    let today = chrono::Local::now().date_naive();
    let end = today + chrono::Duration::days(lookahead_days);
    let fiscal_start = get_fiscal_year_start_month(conn);

    // Load the single active recurring item. If it doesn't match (wrong id, one-time mode,
    // paused status), return Ok(0) so callers don't need to special-case it.
    let item_data = conn
        .query_row(
            "SELECT id, recurrence_type, day_of_week, day_of_month, \
                    due_date, created_at \
             FROM scheduled_items \
             WHERE id = ?1 AND mode = 'recurring' AND status = 'active'",
            rusqlite::params![item_id],
            |row| {
                Ok(ScheduledItemRow {
                    id: row.get(0)?,
                    recurrence_type: row.get(1)?,
                    day_of_week: row.get(2)?,
                    day_of_month: row.get(3)?,
                    due_date: row.get(4)?,
                    created_at: row.get(5)?,
                })
            },
        )
        .ok();

    let Some(item) = item_data else {
        return Ok(0);
    };

    // Respect due_date as cadence start: don't generate instances before it.
    let mut item_start = today;
    if let Some(ref due_date_str) = item.due_date {
        if let Some(cadence_start) = parse_date(due_date_str) {
            if cadence_start > today {
                item_start = cadence_start;
                if item_start > end {
                    return Ok(0); // Entirely outside lookahead window
                }
            }
        }
    }

    let due_dates = compute_due_dates(&item, item_start, end, fiscal_start);
    let mut inserted: i64 = 0;
    for d in &due_dates {
        let changes = conn.execute(
            "INSERT OR IGNORE INTO scheduled_item_instances \
             (scheduled_item_id, due_date, status) \
             VALUES (?1, ?2, 'pending')",
            rusqlite::params![item.id, d.format("%Y-%m-%d").to_string()],
        )?;
        inserted += changes as i64;
    }

    Ok(inserted)
}

/// Delete a scheduled item's pending instances and regenerate them against the current schedule.
///
/// This is the engine helper backing `POST /api/scheduled-items/:id/instances/regenerate`. It
/// preserves resolved instances (completed, skipped, auto_completed) — only rows with
/// `status = 'pending'` are removed before regeneration.
///
/// Returns the count of rows actually generated. If the item exists but is one-time, paused, or
/// otherwise doesn't produce a schedule, the result is `0` (the pending row — if any — is still
/// deleted). Callers that need a 404 for a missing item should check existence before calling
/// this helper.
pub fn regenerate_instances_for_item(
    conn: &Connection,
    item_id: i64,
    lookahead_days: i64,
) -> Result<i64> {
    // Drop existing pending instances for the item; resolved rows are preserved.
    conn.execute(
        "DELETE FROM scheduled_item_instances \
         WHERE scheduled_item_id = ?1 AND status = 'pending'",
        rusqlite::params![item_id],
    )?;

    // Rebuild the schedule from the current cadence configuration.
    generate_pending_instances_for_item(conn, item_id, lookahead_days)
}

/// Auto-complete past-due cadence item instances.
///
/// Finds all pending instances where:
/// - The parent scheduled_item has item_class = 'cadence'
/// - The parent scheduled_item has require_acknowledgment = 0
/// - The instance due_date < today
/// - The instance status = 'pending'
///
/// Sets status = 'auto_completed' and resolved_at = due_date || 'T23:59:59'.
/// Returns count of auto-completed instances.
pub fn auto_complete_past_due_cadence(conn: &Connection) -> Result<i64> {
    let today = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();

    let count = conn.execute(
        "UPDATE scheduled_item_instances \
         SET status = 'auto_completed', \
             resolved_at = due_date || 'T23:59:59' \
         WHERE status = 'pending' \
           AND due_date < ?1 \
           AND scheduled_item_id IN ( \
               SELECT id FROM scheduled_items \
               WHERE item_class = 'cadence' \
                 AND mode = 'recurring' \
                 AND status = 'active' \
                 AND require_acknowledgment = 0 \
           )",
        rusqlite::params![today],
    )?;

    Ok(count as i64)
}

/// Compute due dates for a scheduled item within [start, end].
///
/// Supports: daily (Mon-Fri), every_day (all 7), weekly, biweekly, monthly,
/// quarterly, annual.
///
/// For annual recurrence, the month is derived from the item's due_date (cadence
/// start date). If no due_date is set, defaults to January.
pub fn compute_due_dates(
    item: &ScheduledItemRow,
    start: NaiveDate,
    end: NaiveDate,
    fiscal_start_month: u32,
) -> Vec<NaiveDate> {
    match item.recurrence_type.as_str() {
        "daily" => daily_dates(start, end),
        "every_day" => every_day_dates(start, end),
        "weekly" => weekly_dates(item.day_of_week.unwrap_or(2) as u8, start, end),
        "biweekly" => {
            let anchor = item
                .due_date
                .as_ref()
                .and_then(|s| parse_date(s))
                .unwrap_or_else(|| parse_date(&item.created_at).unwrap_or(start));
            biweekly_dates(anchor, item.day_of_week.map(|d| d as u8), start, end)
        }
        "monthly" => {
            let day = item.day_of_month.unwrap_or(1).min(28) as u32;
            monthly_dates(day, start, end)
        }
        "quarterly" => {
            let day = item.day_of_month.unwrap_or(1).min(28) as u32;
            quarterly_dates(day, fiscal_start_month, start, end)
        }
        "annual" => {
            // Derive month from due_date or created_at; default to January
            let month = item
                .due_date
                .as_ref()
                .and_then(|s| parse_date(s))
                .or_else(|| parse_date(&item.created_at))
                .map(|d| d.month())
                .unwrap_or(1);
            let day = item.day_of_month.unwrap_or(1).min(28) as u32;
            annual_dates(month, day, start, end)
        }
        _ => Vec::new(),
    }
}

// ─── Helper Functions (public for testing) ──────────────────────────────────

/// Convert US Traditional day (1=Sun, 2=Mon, ..., 7=Sat) to chrono Weekday.
pub fn us_to_chrono_weekday(us_dow: u8) -> Weekday {
    match us_dow {
        1 => Weekday::Sun,
        2 => Weekday::Mon,
        3 => Weekday::Tue,
        4 => Weekday::Wed,
        5 => Weekday::Thu,
        6 => Weekday::Fri,
        7 => Weekday::Sat,
        _ => Weekday::Sun, // fallback
    }
}

/// Convert chrono Weekday back to US Traditional day.
pub fn chrono_to_us_day(wd: Weekday) -> u8 {
    match wd {
        Weekday::Sun => 1,
        Weekday::Mon => 2,
        Weekday::Tue => 3,
        Weekday::Wed => 4,
        Weekday::Thu => 5,
        Weekday::Fri => 6,
        Weekday::Sat => 7,
    }
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

// ─── Private Helpers ────────────────────────────────────────────────────────

/// Parse an ISO date or datetime string into a NaiveDate.
fn parse_date(value: &str) -> Option<NaiveDate> {
    if value.contains('T') {
        // datetime string like "2025-01-15T14:30:00"
        NaiveDate::parse_from_str(&value[..10], "%Y-%m-%d").ok()
    } else if value.contains(' ') {
        // space-separated datetime like "2025-01-15 14:30:00"
        NaiveDate::parse_from_str(value.split(' ').next().unwrap_or(value), "%Y-%m-%d").ok()
    } else {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
    }
}

/// Read fiscal_year_start_month from settings; default 10 (October).
fn get_fiscal_year_start_month(conn: &Connection) -> u32 {
    conn.query_row(
        "SELECT value FROM settings WHERE key = 'fiscal_year_start_month'",
        [],
        |row| row.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
    .and_then(|v| v.parse::<u32>().ok())
    .unwrap_or(10)
}

/// Every weekday (Mon–Fri) in [start, end].
fn daily_dates(start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut d = start;
    while d <= end {
        let wd = d.weekday();
        if wd != Weekday::Sat && wd != Weekday::Sun {
            dates.push(d);
        }
        d += chrono::Duration::days(1);
    }
    dates
}

/// Every day (all 7 days) in [start, end].
fn every_day_dates(start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut d = start;
    while d <= end {
        dates.push(d);
        d += chrono::Duration::days(1);
    }
    dates
}

/// Every week on the given US Traditional day_of_week in [start, end].
fn weekly_dates(day_of_week: u8, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let target_wd = us_to_chrono_weekday(day_of_week);
    let target_num = target_wd.num_days_from_monday(); // 0=Mon..6=Sun
    let start_num = start.weekday().num_days_from_monday();

    // Jump to the first occurrence >= start
    let offset = ((target_num as i64) - (start_num as i64)).rem_euclid(7);
    let mut d = start + chrono::Duration::days(offset);

    let mut dates = Vec::new();
    while d <= end {
        dates.push(d);
        d += chrono::Duration::days(7);
    }
    dates
}

/// Every other week anchored to the anchor date.
///
/// If day_of_week is set (US Traditional), occurrences land on that weekday
/// in the anchor's biweekly cadence. Otherwise, occurrences land on the same
/// weekday as the anchor date.
fn biweekly_dates(
    anchor: NaiveDate,
    day_of_week: Option<u8>,
    start: NaiveDate,
    end: NaiveDate,
) -> Vec<NaiveDate> {
    let target_wd = match day_of_week {
        Some(dow) => us_to_chrono_weekday(dow),
        None => anchor.weekday(),
    };

    let target_num = target_wd.num_days_from_monday();
    let anchor_num = anchor.weekday().num_days_from_monday();

    // Find the first occurrence of target_wd on or after the anchor date
    let days_ahead = ((target_num as i64) - (anchor_num as i64)).rem_euclid(7);
    let first_occurrence = anchor + chrono::Duration::days(days_ahead);

    // Walk forward in 2-week steps to find the first occurrence >= start
    let mut d = first_occurrence;
    if d < start {
        let days_behind = (start - d).num_days();
        let weeks_behind = days_behind / 14;
        d += chrono::Duration::days(weeks_behind * 14);
        if d < start {
            d += chrono::Duration::days(14);
        }
    }

    let mut dates = Vec::new();
    while d <= end {
        if d >= start {
            dates.push(d);
        }
        d += chrono::Duration::days(14);
    }
    dates
}

/// On the given day of each month (capped at 28) in [start, end].
fn monthly_dates(day: u32, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    // Start from the 1st of start's month
    let mut year = start.year();
    let mut month = start.month();

    loop {
        if let Some(due) = NaiveDate::from_ymd_opt(year, month, day) {
            if due > end {
                break;
            }
            if due >= start {
                dates.push(due);
            }
        }
        // Advance to next month
        if month == 12 {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
        // Safety: if we've gone way past end, break
        if year > end.year() + 1 {
            break;
        }
    }
    dates
}

/// Return the 4 quarter-start months for a fiscal year starting at fiscal_start.
fn quarter_start_months(fiscal_start: u32) -> Vec<u32> {
    (0..4)
        .map(|i| (fiscal_start + 3 * i - 1) % 12 + 1)
        .collect()
}

/// On the given day of each quarter-start month (derived from fiscal year) in [start, end].
fn quarterly_dates(day: u32, fiscal_start: u32, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let q_months = quarter_start_months(fiscal_start);
    let mut dates = Vec::new();

    // Scan from start's year-1 to end's year+1 to cover all edge cases
    for year in (start.year() - 1)..=(end.year() + 1) {
        for &m in &q_months {
            if let Some(due) = NaiveDate::from_ymd_opt(year, m, day) {
                if due >= start && due <= end {
                    dates.push(due);
                }
            }
        }
    }

    dates.sort();
    dates
}

/// On month/day each year in [start, end].
fn annual_dates(month: u32, day: u32, start: NaiveDate, end: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    for year in start.year()..=end.year() {
        if let Some(due) = NaiveDate::from_ymd_opt(year, month, day) {
            if due >= start && due <= end {
                dates.push(due);
            }
        }
    }
    dates
}

// ─── Unit Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Helper to create an in-memory database with the required schema.
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        crate::db::schema::initialize_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_us_to_chrono_weekday_roundtrip() {
        for us_day in 1..=7u8 {
            let wd = us_to_chrono_weekday(us_day);
            let back = chrono_to_us_day(wd);
            assert_eq!(us_day, back, "Round-trip failed for US day {us_day}");
        }
    }

    #[test]
    fn test_week_start_is_sunday() {
        // Wednesday 2025-01-15
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let ws = week_start(date);
        assert_eq!(ws.weekday(), Weekday::Sun);
        assert_eq!(ws, NaiveDate::from_ymd_opt(2025, 1, 12).unwrap());
    }

    #[test]
    fn test_week_end_is_saturday() {
        let date = NaiveDate::from_ymd_opt(2025, 1, 15).unwrap();
        let we = week_end(date);
        assert_eq!(we.weekday(), Weekday::Sat);
        assert_eq!(we, NaiveDate::from_ymd_opt(2025, 1, 18).unwrap());
    }

    #[test]
    fn test_daily_dates_weekdays_only() {
        // Mon Jan 13 to Fri Jan 17
        let start = NaiveDate::from_ymd_opt(2025, 1, 13).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 1, 19).unwrap(); // Sunday
        let dates = daily_dates(start, end);
        // Should include Mon-Fri (5 days), skip Sat+Sun
        assert_eq!(dates.len(), 5);
        for d in &dates {
            assert!(d.weekday() != Weekday::Sat && d.weekday() != Weekday::Sun);
        }
    }

    #[test]
    fn test_every_day_dates_all_seven() {
        let start = NaiveDate::from_ymd_opt(2025, 1, 13).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 1, 19).unwrap();
        let dates = every_day_dates(start, end);
        assert_eq!(dates.len(), 7);
    }

    #[test]
    fn test_weekly_dates_on_wednesday() {
        // US Traditional: 4 = Wednesday
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 1, 31).unwrap();
        let dates = weekly_dates(4, start, end);
        for d in &dates {
            assert_eq!(d.weekday(), Weekday::Wed);
        }
        // Jan 2025 has Wednesdays on 1, 8, 15, 22, 29
        assert_eq!(dates.len(), 5);
    }

    #[test]
    fn test_monthly_dates_capped_at_28() {
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 3, 31).unwrap();
        // day_of_month = 28 (already capped)
        let dates = monthly_dates(28, start, end);
        assert_eq!(dates.len(), 3); // Jan 28, Feb 28, Mar 28
        for d in &dates {
            assert_eq!(d.day(), 28);
        }
    }

    #[test]
    fn test_quarterly_dates_fiscal_october() {
        // Fiscal start = October (10)
        // Quarter start months: 10, 1, 4, 7
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 12, 31).unwrap();
        let dates = quarterly_dates(15, 10, start, end);
        // Should have: Jan 15, Apr 15, Jul 15, Oct 15
        assert_eq!(dates.len(), 4);
        let months: Vec<u32> = dates.iter().map(|d| d.month()).collect();
        assert_eq!(months, vec![1, 4, 7, 10]);
    }

    #[test]
    fn test_annual_dates() {
        let start = NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
        let dates = annual_dates(6, 15, start, end);
        assert_eq!(dates.len(), 3); // Jun 15 in 2024, 2025, 2026
    }

    #[test]
    fn test_biweekly_dates() {
        let anchor = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap(); // Monday
        let start = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 2, 28).unwrap();
        let dates = biweekly_dates(anchor, Some(2), start, end); // 2 = Monday
        // Should be every other Monday starting Jan 6
        // Jan 6, Jan 20, Feb 3, Feb 17
        assert_eq!(dates.len(), 4);
        for d in &dates {
            assert_eq!(d.weekday(), Weekday::Mon);
        }
        // Verify 14-day spacing
        for i in 1..dates.len() {
            assert_eq!((dates[i] - dates[i - 1]).num_days(), 14);
        }
    }

    #[test]
    fn test_quarter_start_months_fiscal_october() {
        let months = quarter_start_months(10);
        assert_eq!(months, vec![10, 1, 4, 7]);
    }

    #[test]
    fn test_quarter_start_months_fiscal_january() {
        let months = quarter_start_months(1);
        assert_eq!(months, vec![1, 4, 7, 10]);
    }

    #[test]
    fn test_generate_pending_instances_idempotent() {
        let conn = setup_test_db();

        // Insert an active recurring item (weekly on Monday)
        conn.execute(
            "INSERT INTO scheduled_items (name, mode, status, recurrence_type, day_of_week, due_date, item_class) \
             VALUES ('Weekly Standup', 'recurring', 'active', 'weekly', 2, '2025-01-01', 'cadence')",
            [],
        ).unwrap();

        // Generate instances
        generate_pending_instances(&conn, 14).unwrap();
        let count1: i64 = conn
            .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
            .unwrap();

        // Generate again — should be idempotent
        generate_pending_instances(&conn, 14).unwrap();
        let count2: i64 = conn
            .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count1, count2, "Instance generation should be idempotent");
        assert!(count1 > 0, "Should have generated at least one instance");
    }

    #[test]
    fn test_paused_items_produce_no_instances() {
        let conn = setup_test_db();

        // Insert a paused recurring item
        conn.execute(
            "INSERT INTO scheduled_items (name, mode, status, recurrence_type, day_of_week, item_class) \
             VALUES ('Paused Item', 'recurring', 'paused', 'weekly', 2, 'cadence')",
            [],
        ).unwrap();

        generate_pending_instances(&conn, 14).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
            .unwrap();

        assert_eq!(count, 0, "Paused items should produce no instances");
    }

    #[test]
    fn test_auto_complete_past_due() {
        let conn = setup_test_db();

        // Insert an active cadence item with require_acknowledgment = 0
        conn.execute(
            "INSERT INTO scheduled_items (id, name, mode, status, recurrence_type, day_of_week, item_class, require_acknowledgment) \
             VALUES (1, 'Auto Item', 'recurring', 'active', 'weekly', 2, 'cadence', 0)",
            [],
        ).unwrap();

        // Insert a pending instance with a past due_date
        conn.execute(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) \
             VALUES (1, '2020-01-01', 'pending')",
            [],
        ).unwrap();

        let count = auto_complete_past_due_cadence(&conn).unwrap();
        assert_eq!(count, 1);

        // Verify the instance was updated
        let (status, resolved_at): (String, String) = conn
            .query_row(
                "SELECT status, resolved_at FROM scheduled_item_instances WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "auto_completed");
        assert_eq!(resolved_at, "2020-01-01T23:59:59");
    }

    #[test]
    fn test_auto_complete_respects_require_acknowledgment() {
        let conn = setup_test_db();

        // Insert a cadence item with require_acknowledgment = 1
        conn.execute(
            "INSERT INTO scheduled_items (id, name, mode, status, recurrence_type, day_of_week, item_class, require_acknowledgment) \
             VALUES (1, 'Ack Item', 'recurring', 'active', 'weekly', 2, 'cadence', 1)",
            [],
        ).unwrap();

        // Insert a pending instance with a past due_date
        conn.execute(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) \
             VALUES (1, '2020-01-01', 'pending')",
            [],
        ).unwrap();

        let count = auto_complete_past_due_cadence(&conn).unwrap();
        assert_eq!(count, 0, "Items with require_acknowledgment=1 should not be auto-completed");

        // Verify the instance was NOT updated
        let status: String = conn
            .query_row(
                "SELECT status FROM scheduled_item_instances WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "pending");
    }

    #[test]
    fn test_parse_date_variants() {
        assert_eq!(
            parse_date("2025-01-15"),
            Some(NaiveDate::from_ymd_opt(2025, 1, 15).unwrap())
        );
        assert_eq!(
            parse_date("2025-01-15T14:30:00"),
            Some(NaiveDate::from_ymd_opt(2025, 1, 15).unwrap())
        );
        assert_eq!(
            parse_date("2025-01-15 14:30:00"),
            Some(NaiveDate::from_ymd_opt(2025, 1, 15).unwrap())
        );
        assert_eq!(parse_date("invalid"), None);
    }

    #[test]
    fn test_compute_due_dates_within_bounds() {
        let start = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        let end = NaiveDate::from_ymd_opt(2025, 1, 31).unwrap();

        let item = ScheduledItemRow {
            id: 1,
            recurrence_type: "weekly".to_string(),
            day_of_week: Some(3), // Tuesday
            day_of_month: None,
            due_date: None,
            created_at: "2025-01-01".to_string(),
        };

        let dates = compute_due_dates(&item, start, end, 10);
        for d in &dates {
            assert!(*d >= start && *d <= end, "Date {d} out of bounds [{start}, {end}]");
        }
    }

    // ─── Property-Based Tests ───────────────────────────────────────────────

    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(200))]

        // Feature: rust-backend-rewrite, Property 2: Instance Generation Idempotence
        /// **Validates: Requirements 4.4, 4.9, 14.2**
        #[test]
        fn prop_instance_generation_idempotent(
            recurrence_type in prop::sample::select(vec![
                "daily", "every_day", "weekly", "biweekly", "monthly", "quarterly", "annual"
            ]),
            day_of_week in 1u8..=7u8,
            day_of_month in 1i64..=28,
        ) {
            let conn = setup_test_db();

            // Insert settings for fiscal year
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('fiscal_year_start_month', '10')",
                [],
            ).unwrap();

            // Insert an active recurring item with the generated config
            conn.execute(
                "INSERT INTO scheduled_items (name, mode, status, recurrence_type, day_of_week, day_of_month, due_date, item_class) \
                 VALUES ('PropTest Item', 'recurring', 'active', ?1, ?2, ?3, '2020-01-01', 'cadence')",
                rusqlite::params![recurrence_type, day_of_week, day_of_month],
            ).unwrap();

            // Generate instances first time
            generate_pending_instances(&conn, 30).unwrap();
            let count1: i64 = conn
                .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
                .unwrap();

            // Generate instances second time — should be idempotent
            generate_pending_instances(&conn, 30).unwrap();
            let count2: i64 = conn
                .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
                .unwrap();

            prop_assert_eq!(count1, count2, "Instance generation must be idempotent: first={}, second={}", count1, count2);
        }

        // Feature: rust-backend-rewrite, Property 3: US Day-of-Week Round-Trip
        /// **Validates: Requirements 4.3, 14.3**
        #[test]
        fn prop_us_day_of_week_round_trip(us_day in 1u8..=7u8) {
            let weekday = us_to_chrono_weekday(us_day);
            let back = chrono_to_us_day(weekday);
            prop_assert_eq!(us_day, back, "Round-trip failed: {} -> {:?} -> {}", us_day, weekday, back);
        }

        // Feature: rust-backend-rewrite, Property 4: Due Dates Within Bounds
        /// **Validates: Requirements 4.1, 14.4**
        #[test]
        fn prop_due_dates_within_bounds(
            recurrence_type in prop::sample::select(vec![
                "daily", "every_day", "weekly", "biweekly", "monthly", "quarterly", "annual"
            ]),
            day_of_week in 1i64..=7,
            day_of_month in 1i64..=28,
            // Generate start year/month/day within reasonable range
            start_year in 2020i32..=2030,
            start_month in 1u32..=12,
            start_day in 1u32..=28,
            // Range length in days (1 to 365)
            range_days in 1i64..=365,
            fiscal_start in 1u32..=12,
        ) {
            let start = NaiveDate::from_ymd_opt(start_year, start_month, start_day).unwrap();
            let end = start + chrono::Duration::days(range_days);

            let item = ScheduledItemRow {
                id: 1,
                recurrence_type: recurrence_type.to_string(),
                day_of_week: Some(day_of_week),
                day_of_month: Some(day_of_month),
                due_date: Some(start.format("%Y-%m-%d").to_string()),
                created_at: start.format("%Y-%m-%d").to_string(),
            };

            let dates = compute_due_dates(&item, start, end, fiscal_start);
            for d in &dates {
                prop_assert!(
                    *d >= start && *d <= end,
                    "Date {} out of bounds [{}, {}] for recurrence_type={}",
                    d, start, end, recurrence_type
                );
            }
        }

        // Feature: rust-backend-rewrite, Property 6: Paused Items Produce No Instances
        /// **Validates: Requirements 4.5**
        #[test]
        fn prop_paused_items_produce_no_instances(
            recurrence_type in prop::sample::select(vec![
                "daily", "every_day", "weekly", "biweekly", "monthly", "quarterly", "annual"
            ]),
            day_of_week in 1u8..=7u8,
            day_of_month in 1i64..=28,
        ) {
            let conn = setup_test_db();

            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('fiscal_year_start_month', '10')",
                [],
            ).unwrap();

            // Insert a PAUSED recurring item
            conn.execute(
                "INSERT INTO scheduled_items (name, mode, status, recurrence_type, day_of_week, day_of_month, due_date, item_class) \
                 VALUES ('Paused PropTest', 'recurring', 'paused', ?1, ?2, ?3, '2020-01-01', 'cadence')",
                rusqlite::params![recurrence_type, day_of_week, day_of_month],
            ).unwrap();

            generate_pending_instances(&conn, 30).unwrap();

            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM scheduled_item_instances", [], |row| row.get(0))
                .unwrap();

            prop_assert_eq!(count, 0, "Paused items must produce zero instances, got {}", count);
        }

        // Feature: rust-backend-rewrite, Property 7: Cadence Start Date Respected
        /// **Validates: Requirements 4.7**
        #[test]
        fn prop_cadence_start_date_respected(
            recurrence_type in prop::sample::select(vec![
                "daily", "every_day", "weekly", "biweekly", "monthly", "quarterly", "annual"
            ]),
            day_of_week in 1i64..=7,
            day_of_month in 1i64..=28,
            // Future offset: cadence starts 1-60 days from today
            future_offset in 1i64..=60,
        ) {
            let conn = setup_test_db();

            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('fiscal_year_start_month', '10')",
                [],
            ).unwrap();

            let today = chrono::Local::now().date_naive();
            let cadence_start = today + chrono::Duration::days(future_offset);
            let cadence_start_str = cadence_start.format("%Y-%m-%d").to_string();

            // Insert an active recurring item with a future start date
            conn.execute(
                "INSERT INTO scheduled_items (name, mode, status, recurrence_type, day_of_week, day_of_month, due_date, item_class) \
                 VALUES ('Future Start', 'recurring', 'active', ?1, ?2, ?3, ?4, 'cadence')",
                rusqlite::params![recurrence_type, day_of_week, day_of_month, cadence_start_str],
            ).unwrap();

            // Use a large lookahead to ensure we cover the future start
            generate_pending_instances(&conn, 90).unwrap();

            // Verify no instances have due_date before the cadence start
            let violations: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM scheduled_item_instances WHERE due_date < ?1",
                    rusqlite::params![cadence_start_str],
                    |row| row.get(0),
                )
                .unwrap();

            prop_assert_eq!(violations, 0,
                "Found {} instances before cadence start date {} (recurrence={})",
                violations, cadence_start_str, recurrence_type
            );
        }

        // Feature: rust-backend-rewrite, Property 8: Auto-Complete Past-Due Correctness
        /// **Validates: Requirements 4.6**
        #[test]
        fn prop_auto_complete_past_due_correctness(
            require_ack in prop::bool::ANY,
            days_past in 1i64..=365,
        ) {
            let conn = setup_test_db();

            let require_ack_val: i64 = if require_ack { 1 } else { 0 };

            // Insert a cadence item
            conn.execute(
                "INSERT INTO scheduled_items (id, name, mode, status, recurrence_type, day_of_week, item_class, require_acknowledgment) \
                 VALUES (1, 'Ack Test', 'recurring', 'active', 'weekly', 2, 'cadence', ?1)",
                rusqlite::params![require_ack_val],
            ).unwrap();

            // Insert a pending instance with a past due_date
            let today = chrono::Local::now().date_naive();
            let past_date = today - chrono::Duration::days(days_past);
            let past_date_str = past_date.format("%Y-%m-%d").to_string();

            conn.execute(
                "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) \
                 VALUES (1, ?1, 'pending')",
                rusqlite::params![past_date_str],
            ).unwrap();

            auto_complete_past_due_cadence(&conn).unwrap();

            let (status, resolved_at): (String, Option<String>) = conn
                .query_row(
                    "SELECT status, resolved_at FROM scheduled_item_instances WHERE scheduled_item_id = 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();

            if require_ack {
                // Items with require_acknowledgment=1 should NOT be auto-completed
                prop_assert_eq!(&status, "pending",
                    "Item with require_acknowledgment=1 should remain pending, got '{}'", status);
                prop_assert!(resolved_at.is_none(),
                    "Item with require_acknowledgment=1 should have no resolved_at");
            } else {
                // Items with require_acknowledgment=0 should be auto-completed
                prop_assert_eq!(&status, "auto_completed",
                    "Item with require_acknowledgment=0 should be auto_completed, got '{}'", status);
                let expected_resolved = format!("{}T23:59:59", past_date_str);
                prop_assert_eq!(resolved_at.as_deref(), Some(expected_resolved.as_str()),
                    "resolved_at should be '{}', got {:?}", expected_resolved, resolved_at);
            }
        }

        // Feature: rust-backend-rewrite, Property 11: Day-of-Month Capping
        /// **Validates: Requirements 8.5**
        #[test]
        fn prop_day_of_month_capping(
            recurrence_type in prop::sample::select(vec!["monthly", "quarterly", "annual"]),
            // Generate day_of_month values > 28 to test capping
            day_of_month in 29i64..=31,
            start_year in 2020i32..=2028,
            start_month in 1u32..=12,
            range_days in 30i64..=365,
            fiscal_start in 1u32..=12,
        ) {
            let start = NaiveDate::from_ymd_opt(start_year, start_month, 1).unwrap();
            let end = start + chrono::Duration::days(range_days);

            let item = ScheduledItemRow {
                id: 1,
                recurrence_type: recurrence_type.to_string(),
                day_of_week: None,
                day_of_month: Some(day_of_month),
                due_date: Some(start.format("%Y-%m-%d").to_string()),
                created_at: start.format("%Y-%m-%d").to_string(),
            };

            let dates = compute_due_dates(&item, start, end, fiscal_start);

            // All generated dates should have day <= 28 because day_of_month > 28 gets capped
            for d in &dates {
                prop_assert!(
                    d.day() <= 28,
                    "Day-of-month capping failed: date {} has day={} but should be <= 28 (input day_of_month={}, recurrence={})",
                    d, d.day(), day_of_month, recurrence_type
                );
            }
        }
    }
}
