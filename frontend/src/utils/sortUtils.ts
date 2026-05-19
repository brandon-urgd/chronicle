/**
 * Sort utility functions extracted from PortfolioView for testability.
 * These implement the Portfolio sort order requirements (Requirements 15.1, 15.3).
 */

/** Status priority mapping for goal sorting (lower = higher priority) */
export const GOAL_STATUS_PRIORITY: Record<string, number> = {
  on_track: 0,
  at_risk: 1,
  behind: 2,
  completed: 3,
  paused: 4,
};

export interface GoalSortable {
  title: string;
  status: string;
}

export interface TaskSortable {
  due_date: string | null;
}

/**
 * Sort goals by status priority (on_track first, paused last),
 * then alphabetically by title within each status group.
 *
 * Goals with unknown statuses sort after paused (priority 99).
 */
export function sortGoals<T extends GoalSortable>(goals: T[]): T[] {
  return [...goals].sort((a, b) => {
    const pa = GOAL_STATUS_PRIORITY[a.status] ?? 99;
    const pb = GOAL_STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.title.localeCompare(b.title);
  });
}

/**
 * Sort tasks by due_date ascending, with NULL due_dates sorted last.
 * Tasks with defined due_dates are compared as ISO date strings.
 */
export function sortTasks<T extends TaskSortable>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date && !b.due_date) return -1;
    if (!a.due_date && b.due_date) return 1;
    return 0;
  });
}
