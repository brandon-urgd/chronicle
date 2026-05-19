/**
 * Fiscal Year Calculator
 * Used by GoalsView filter defaults, ReviewView scope computation, DashboardView quarter stats.
 * Requirements: 6.1–6.3
 */

/**
 * Returns the fiscal year for a given date and FY start month.
 * If the date's month (1-indexed) >= startMonth, fiscal year = date's year.
 * Otherwise, fiscal year = date's year - 1.
 */
export function getFiscalYear(date: Date, startMonth: number): number {
  const month = date.getMonth() + 1; // 1-indexed
  return month >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
}

/**
 * Returns the fiscal quarter (1–4) for a given date and FY start month.
 * Quarter = floor(((month - startMonth + 12) % 12) / 3) + 1
 */
export function getFiscalQuarter(date: Date, startMonth: number): number {
  const month = date.getMonth() + 1; // 1-indexed
  const monthsIntoFY = ((month - startMonth) % 12 + 12) % 12;
  return Math.floor(monthsIntoFY / 3) + 1;
}

/**
 * Returns the ISO week number for a given date.
 * Uses the ISO 8601 definition (week starts Monday for calculation,
 * but CHRONICLE displays Sun-Sat weeks).
 */
export function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Set to nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
