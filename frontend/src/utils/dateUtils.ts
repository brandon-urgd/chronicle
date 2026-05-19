/**
 * Returns the ISO 8601 week number for a given date.
 * Week 1 is the week containing the first Thursday of the year.
 */
export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Format a Date as YYYY-MM-DD. */
export function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Get the Sunday (week start) of the week containing the given date. Sunday–Saturday week. */
export function getWeekStart(d: Date): Date {
  const day = d.getDay(); // 0=Sunday, 6=Saturday
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
}

/** @deprecated Use getWeekStart instead. Kept for backward compatibility. */
export function getMonday(d: Date): Date {
  return getWeekStart(d);
}

/** Shift a week start date forward or backward by `direction` weeks. Returns [start, end]. Sunday–Saturday. */
export function shiftWeek(start: string, direction: number): [string, string] {
  const d = new Date(start + 'T12:00:00');
  d.setDate(d.getDate() + direction * 7);
  const sun = getWeekStart(d);
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  return [fmtDate(sun), fmtDate(sat)];
}

/** Shift a month start date forward or backward by `direction` months. Returns [start, end]. */
export function shiftMonth(start: string, direction: number): [string, string] {
  const d = new Date(start + 'T12:00:00');
  d.setMonth(d.getMonth() + direction);
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [fmtDate(first), fmtDate(last)];
}

/** Shift a quarter start date forward or backward by `direction` quarters. Returns [start, end]. */
export function shiftQuarter(start: string, direction: number): [string, string] {
  const d = new Date(start + 'T12:00:00');
  d.setMonth(d.getMonth() + direction * 3);
  const qStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  const qEnd = new Date(qStart.getFullYear(), qStart.getMonth() + 3, 0);
  return [fmtDate(qStart), fmtDate(qEnd)];
}

/** Format a date range as a human-readable label, with week number if applicable. */
export function formatRangeLabel(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const sMonth = s.toLocaleDateString('en-US', { month: 'short' });
  const eMonth = e.toLocaleDateString('en-US', { month: 'short' });
  const base = sMonth === eMonth
    ? `${sMonth} ${s.getDate()}–${e.getDate()}`
    : `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}`;
  const diffDays = Math.round((e.getTime() - s.getTime()) / 86400000);
  if (diffDays === 6) return `${base} (W${isoWeekNumber(s)})`;
  return base;
}

/**
 * Returns the number of whole calendar days between `dueDateStr` and today,
 * both interpreted at local-timezone midnight.
 *
 * Positive values mean `dueDateStr` is in the past (overdue by N days).
 * Zero means the due date is today. Negative means the due date is in the future.
 *
 * @param dueDateStr Date in `YYYY-MM-DD` format, interpreted as local calendar date.
 * @returns `Math.floor((todayMs - dueMs) / 86400000)`, or `null` if the input
 *   cannot be parsed as a valid `YYYY-MM-DD` date.
 */
export function daysBetween(dueDateStr: string): number | null {
  if (typeof dueDateStr !== 'string' || dueDateStr.length === 0) return null;

  const parts = dueDateStr.split('-');
  if (parts.length !== 3) return null;

  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;

  // Reject invalid calendar dates (e.g. 2026-02-30) by constructing a local
  // Date first and checking for rollover.
  const local = new Date(y, m - 1, d);
  if (
    local.getFullYear() !== y ||
    local.getMonth() !== m - 1 ||
    local.getDate() !== d
  ) {
    return null;
  }

  // Compute the difference using UTC midnight timestamps for both dates.
  // UTC has no DST transitions, so the delta between two UTC midnights is
  // always an exact multiple of 86400000 ms. Using local midnight would
  // produce a 23-hour delta across the spring-forward boundary and a
  // 25-hour delta across fall-back, silently truncating to the wrong day.
  const dueMs = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  return Math.floor((todayMs - dueMs) / 86400000);
}
