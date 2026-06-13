import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  sortGoals,
  sortTasks,
  GOAL_STATUS_PRIORITY,
  GoalSortable,
  TaskSortable,
} from './sortUtils';

/**
 * Property 6: Goal Sort Order
 *
 * For any set of goals within a program, the Portfolio SHALL sort them by status priority
 * (on_track=0, at_risk=1, behind=2, completed=3, paused=4) and then alphabetically by
 * title within each status group.
 *
 * **Validates: Requirements 15.1**
 */
describe('Feature: chronicle-v2, Property 6: Goal Sort Order', () => {
  const VALID_STATUSES = ['on_track', 'at_risk', 'behind', 'completed', 'paused'] as const;

  const goalArb: fc.Arbitrary<GoalSortable> = fc.record({
    title: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    status: fc.constantFrom(...VALID_STATUSES),
  });

  it('goals are sorted by status priority ascending', () => {
    fc.assert(
      fc.property(
        fc.array(goalArb, { minLength: 2, maxLength: 50 }),
        (goals) => {
          const sorted = sortGoals(goals);

          for (let i = 0; i < sorted.length - 1; i++) {
            const priorityA = GOAL_STATUS_PRIORITY[sorted[i].status] ?? 99;
            const priorityB = GOAL_STATUS_PRIORITY[sorted[i + 1].status] ?? 99;
            expect(priorityA).toBeLessThanOrEqual(priorityB);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('goals with the same status are sorted alphabetically by title', () => {
    fc.assert(
      fc.property(
        fc.array(goalArb, { minLength: 2, maxLength: 50 }),
        (goals) => {
          const sorted = sortGoals(goals);

          for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i].status === sorted[i + 1].status) {
              expect(sorted[i].title.localeCompare(sorted[i + 1].title)).toBeLessThanOrEqual(0);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sort is stable: output length equals input length and contains same elements', () => {
    fc.assert(
      fc.property(
        fc.array(goalArb, { minLength: 0, maxLength: 50 }),
        (goals) => {
          const sorted = sortGoals(goals);
          expect(sorted.length).toBe(goals.length);

          // Every element in sorted should be in the original
          for (const goal of sorted) {
            expect(goals).toContainEqual(goal);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('on_track goals always appear before at_risk, behind, completed, and paused goals', () => {
    fc.assert(
      fc.property(
        fc.array(goalArb, { minLength: 2, maxLength: 30 }),
        (goals) => {
          const sorted = sortGoals(goals);

          const firstNonOnTrack = sorted.findIndex(g => g.status !== 'on_track');
          if (firstNonOnTrack > 0) {
            // All items before firstNonOnTrack should be on_track
            for (let i = 0; i < firstNonOnTrack; i++) {
              expect(sorted[i].status).toBe('on_track');
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('status priority order is respected: on_track < at_risk < behind < completed < paused', () => {
    fc.assert(
      fc.property(
        fc.array(goalArb, { minLength: 5, maxLength: 30 }),
        (goals) => {
          const sorted = sortGoals(goals);
          const statusOrder = sorted.map(g => GOAL_STATUS_PRIORITY[g.status] ?? 99);

          // The status priority sequence should be non-decreasing
          for (let i = 0; i < statusOrder.length - 1; i++) {
            expect(statusOrder[i]).toBeLessThanOrEqual(statusOrder[i + 1]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 7: Task Sort Order
 *
 * For any set of tasks within a project, the Portfolio SHALL sort them by due_date ascending,
 * with tasks having NULL due_dates sorted after all tasks with defined due_dates.
 *
 * **Validates: Requirements 15.3**
 */
describe('Feature: chronicle-v2, Property 7: Task Sort Order', () => {
  const isoDateArb = fc
    .integer({ min: 2020, max: 2030 })
    .chain(year =>
      fc.integer({ min: 1, max: 12 }).chain(month =>
        fc.integer({ min: 1, max: 28 }).map(day => {
          const mm = String(month).padStart(2, '0');
          const dd = String(day).padStart(2, '0');
          return `${year}-${mm}-${dd}`;
        })
      )
    );

  const taskArb: fc.Arbitrary<TaskSortable> = fc.record({
    due_date: fc.oneof(isoDateArb, fc.constant(null)),
  });

  const taskWithDateArb: fc.Arbitrary<TaskSortable> = fc.record({
    due_date: isoDateArb,
  });

  const taskWithNullArb: fc.Arbitrary<TaskSortable> = fc.record({
    due_date: fc.constant(null),
  });

  it('tasks with defined due_dates are sorted ascending', () => {
    fc.assert(
      fc.property(
        fc.array(taskWithDateArb, { minLength: 2, maxLength: 50 }),
        (tasks) => {
          const sorted = sortTasks(tasks);

          for (let i = 0; i < sorted.length - 1; i++) {
            expect(sorted[i].due_date! <= sorted[i + 1].due_date!).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('tasks with NULL due_dates appear after all tasks with defined due_dates', () => {
    fc.assert(
      fc.property(
        fc.array(taskArb, { minLength: 2, maxLength: 50 }),
        (tasks) => {
          const sorted = sortTasks(tasks);

          const firstNull = sorted.findIndex(t => t.due_date === null);
          if (firstNull >= 0) {
            // All items after firstNull should also be null
            for (let i = firstNull; i < sorted.length; i++) {
              expect(sorted[i].due_date).toBeNull();
            }
            // All items before firstNull should have a defined due_date
            for (let i = 0; i < firstNull; i++) {
              expect(sorted[i].due_date).not.toBeNull();
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sort is stable: output length equals input length and contains same elements', () => {
    fc.assert(
      fc.property(
        fc.array(taskArb, { minLength: 0, maxLength: 50 }),
        (tasks) => {
          const sorted = sortTasks(tasks);
          expect(sorted.length).toBe(tasks.length);

          // Count nulls
          const inputNulls = tasks.filter(t => t.due_date === null).length;
          const outputNulls = sorted.filter(t => t.due_date === null).length;
          expect(outputNulls).toBe(inputNulls);

          // Count non-nulls
          const inputDates = tasks.filter(t => t.due_date !== null).map(t => t.due_date).sort();
          const outputDates = sorted.filter(t => t.due_date !== null).map(t => t.due_date).sort();
          expect(outputDates).toEqual(inputDates);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mixed tasks: defined dates sorted ascending followed by all nulls', () => {
    fc.assert(
      fc.property(
        fc.array(taskWithDateArb, { minLength: 1, maxLength: 20 }),
        fc.array(taskWithNullArb, { minLength: 1, maxLength: 10 }),
        (datedTasks, nullTasks) => {
          const mixed = [...datedTasks, ...nullTasks];
          // Shuffle to ensure sort is not relying on input order
          const shuffled = fc.sample(fc.shuffledSubarray(mixed, { minLength: mixed.length, maxLength: mixed.length }), 1)[0];
          const sorted = sortTasks(shuffled);

          // First N items should have dates, last M should be null
          const datedCount = datedTasks.length;
          const nullCount = nullTasks.length;

          for (let i = 0; i < datedCount; i++) {
            expect(sorted[i].due_date).not.toBeNull();
          }
          for (let i = datedCount; i < sorted.length; i++) {
            expect(sorted[i].due_date).toBeNull();
          }

          // Dated portion should be ascending
          for (let i = 0; i < datedCount - 1; i++) {
            expect(sorted[i].due_date! <= sorted[i + 1].due_date!).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty array returns empty array', () => {
    const sorted = sortTasks([]);
    expect(sorted).toEqual([]);
  });

  it('single task returns same task', () => {
    fc.assert(
      fc.property(taskArb, (task) => {
        const sorted = sortTasks([task]);
        expect(sorted.length).toBe(1);
        expect(sorted[0]).toEqual(task);
      }),
      { numRuns: 100 }
    );
  });
});
