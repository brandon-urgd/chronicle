import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { daysBetween } from './dateUtils';

/**
 * Property: Overdue Day Count Matches Calendar
 *
 * For any local `due_date` that is `N` calendar days before today
 * (0 ≤ N ≤ 365), `daysBetween(due_date)` returns `N`, regardless of
 * the current wall-clock time and regardless of whether a daylight
 * saving transition fell between the two dates.
 *
 * Reference implementation: construct the local calendar date `N` days
 * before today using JavaScript's Date constructor with day arithmetic
 * (`new Date(y, m - 1, d - N)`), which operates on calendar days and is
 * therefore DST-invariant.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6**
 */
describe('Feature: chronicle-v2.5.1-patch, Property: daysBetween matches calendar-day difference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Format a Date as local YYYY-MM-DD. */
  function fmtLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Reference: local calendar date `offset` days before the given (y, m, d). */
  function calendarDaysBefore(y: number, m: number, d: number, offset: number): string {
    return fmtLocal(new Date(y, m - 1, d - offset));
  }

  /** Pin "today" to the given local calendar date at an arbitrary mid-day hour. */
  function setToday(y: number, m: number, d: number, hour = 10): void {
    vi.setSystemTime(new Date(y, m - 1, d, hour, 0, 0, 0));
  }

  describe('Specific examples from the task', () => {
    it('yesterday → 1', () => {
      // Pick a today that is not adjacent to a DST transition so the example
      // exercises the plain happy path.
      setToday(2025, 6, 15);
      expect(daysBetween('2025-06-14')).toBe(1);
    });

    it('today → 0', () => {
      setToday(2025, 6, 15);
      expect(daysBetween('2025-06-15')).toBe(0);
    });

    it('two weeks ago → 14', () => {
      setToday(2025, 6, 15);
      expect(daysBetween('2025-06-01')).toBe(14);
    });

    it('tomorrow → -1 (indicator not rendered; caller guards on <= 0)', () => {
      setToday(2025, 6, 15);
      expect(daysBetween('2025-06-16')).toBe(-1);
    });

    it('returns null for missing or malformed input', () => {
      setToday(2025, 6, 15);
      expect(daysBetween('')).toBeNull();
      expect(daysBetween('not-a-date')).toBeNull();
      expect(daysBetween('2025-13-40')).toBeNull();
    });
  });

  describe('DST boundaries (America/Los_Angeles)', () => {
    // Spring forward: 2025-03-09 02:00 PST → 03:00 PDT (short day).
    // Fall back: 2025-11-02 02:00 PDT → 01:00 PST (long day).

    it('spring forward — yesterday across the DST transition is still 1', () => {
      // today = 2025-03-10 (PDT), due = 2025-03-09 (PST→PDT day)
      setToday(2025, 3, 10);
      expect(daysBetween('2025-03-09')).toBe(1);
    });

    it('spring forward — two days ago across DST is still 2', () => {
      setToday(2025, 3, 10);
      expect(daysBetween('2025-03-08')).toBe(2);
    });

    it('spring forward — nine days ago across DST is still 9', () => {
      setToday(2025, 3, 10);
      expect(daysBetween('2025-03-01')).toBe(9);
    });

    it('fall back — yesterday across the DST transition is still 1', () => {
      setToday(2025, 11, 3);
      expect(daysBetween('2025-11-02')).toBe(1);
    });

    it('fall back — two days ago across DST is still 2', () => {
      setToday(2025, 11, 3);
      expect(daysBetween('2025-11-01')).toBe(2);
    });
  });

  describe('Property: daysBetween equals calendar-day offset for any due date in the last 365 days', () => {
    // Arbitrary "today" anywhere in a recent 5-year window so runs cover both
    // DST transitions each year. Use day-of-month ≤ 28 so the offset-before
    // arithmetic is well-defined for every month.
    const todayArb = fc.record({
      y: fc.integer({ min: 2022, max: 2027 }),
      m: fc.integer({ min: 1, max: 12 }),
      d: fc.integer({ min: 1, max: 28 }),
    });
    const offsetArb = fc.integer({ min: 0, max: 365 });
    const hourArb = fc.integer({ min: 0, max: 23 });

    it('daysBetween(today - N days) === N for all N in [0, 365]', () => {
      fc.assert(
        fc.property(todayArb, offsetArb, hourArb, ({ y, m, d }, offset, hour) => {
          setToday(y, m, d, hour);
          const dueStr = calendarDaysBefore(y, m, d, offset);
          const actual = daysBetween(dueStr);
          expect(actual).toBe(offset);
        }),
        { numRuns: 300 }
      );
    });
  });
});
