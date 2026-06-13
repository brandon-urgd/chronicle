import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import fc from 'fast-check';
import PromoteToGoal, { computeGoalPreFill } from './PromoteToGoal';

/**
 * Property 16: Promote to Goal Pre-Fill Mapping
 *
 * For any project with a name, description, and program_id, the Promote to Goal action
 * SHALL pre-fill the goal title with the project name, the goal description with the
 * project description, and the goal program_id with the project's program_id.
 *
 * **Validates: Requirements 18.3, 18.4, 18.5**
 */
describe('Feature: chronicle-v2, Property 16: Promote to Goal Pre-Fill Mapping', () => {
  const projectArb = fc.record({
    id: fc.integer({ min: 1, max: 10000 }),
    name: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
    description: fc.oneof(
      fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
      fc.constant(null)
    ),
    program_id: fc.oneof(
      fc.integer({ min: 1, max: 1000 }),
      fc.constant(null)
    ),
  });

  it('goal title is pre-filled with the project name', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const preFill = computeGoalPreFill(project);
        expect(preFill.title).toBe(project.name);
      }),
      { numRuns: 100 }
    );
  });

  it('goal description is pre-filled with the project description (empty string if null)', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const preFill = computeGoalPreFill(project);
        expect(preFill.description).toBe(project.description ?? '');
      }),
      { numRuns: 100 }
    );
  });

  it('goal program_id is pre-filled with the project program_id', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const preFill = computeGoalPreFill(project);
        expect(preFill.program_id).toBe(project.program_id);
      }),
      { numRuns: 100 }
    );
  });

  it('all three pre-fill fields are correctly mapped simultaneously', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const preFill = computeGoalPreFill(project);

        // Title maps from project name
        expect(preFill.title).toBe(project.name);
        // Description maps from project description (null → empty string)
        expect(preFill.description).toBe(project.description ?? '');
        // Program ID maps directly
        expect(preFill.program_id).toBe(project.program_id);
      }),
      { numRuns: 100 }
    );
  });

  it('pre-fill with non-null description preserves exact text', () => {
    const projectWithDescArb = fc.record({
      id: fc.integer({ min: 1, max: 10000 }),
      name: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
      description: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
      program_id: fc.integer({ min: 1, max: 1000 }),
    });

    fc.assert(
      fc.property(projectWithDescArb, (project) => {
        const preFill = computeGoalPreFill(project);
        expect(preFill.description).toBe(project.description);
      }),
      { numRuns: 100 }
    );
  });

  it('pre-fill with null program_id passes null through', () => {
    const projectNoProgramArb = fc.record({
      id: fc.integer({ min: 1, max: 10000 }),
      name: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
      description: fc.oneof(
        fc.string({ minLength: 1, maxLength: 500 }),
        fc.constant(null)
      ),
      program_id: fc.constant(null),
    });

    fc.assert(
      fc.property(projectNoProgramArb, (project) => {
        const preFill = computeGoalPreFill(project);
        expect(preFill.program_id).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * PromoteToGoal — Dirty-State Close Guard (Task 9.14)
 *
 * Integration tests for the PromoteToGoal modal's dirty-close behavior.
 *
 * PromoteToGoal pre-fills the Goal Title with the project's name, so the
 * title is ALREADY non-empty on mount — which means the modal is "dirty"
 * from the start. Our tests reflect that: clean state is only achievable
 * by clearing the title, and any typing leaves the modal dirty.
 *
 * Note: PromoteToGoal attaches its Esc handler via a plain
 * `document.addEventListener('keydown', ...)`. It also includes SMART field
 * textareas which accept Enter — they could conflict with the Discard
 * dialog's Enter → discard handler, but the dialog mounts AFTER the form
 * and only listens while open, so the two do not collide.
 *
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9**
 */

const seededProject = {
  id: 12,
  name: 'Initial Rollout',
  description: 'Kick off milestone',
  program_id: 3,
};

describe('PromoteToGoal — dirty-state close guard (Task 9.14)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 99 }) } as Response)
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clean backdrop click (title cleared) closes the modal', async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(
      <PromoteToGoal
        project={seededProject}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );

    // Pre-fill dirties the form; clear the title to reach the clean state.
    const titleInput = screen.getByLabelText('Goal title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '' } });

    // The overlay is the outermost dialog element.
    const dialog = screen.getByRole('dialog', { name: /promote to goal/i });
    fireEvent.click(dialog);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dirty backdrop click applies .modal-shake and keeps the modal open', async () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const onCompleted = vi.fn();
      render(
        <PromoteToGoal
          project={seededProject}
          onClose={onClose}
          onCompleted={onCompleted}
        />
      );

      // Pre-filled title means dirty out of the gate; confirm by typing.
      const titleInput = screen.getByLabelText('Goal title') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Initial Rollout v2' } });

      const dialog = screen.getByRole('dialog', { name: /promote to goal/i });
      fireEvent.click(dialog);

      const shakePanel = dialog.querySelector('.modal-shake') as HTMLElement | null;
      expect(shakePanel).not.toBeNull();
      expect(onClose).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(400); });
      expect(dialog.querySelector('.modal-shake')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dirty Esc opens the DiscardConfirmDialog', async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(
      <PromoteToGoal
        project={seededProject}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );

    const titleInput = screen.getByLabelText('Goal title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Extended goal title' } });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const confirm = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirm).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Discard from the confirm dialog closes the modal', async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(
      <PromoteToGoal
        project={seededProject}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );

    const titleInput = screen.getByLabelText('Goal title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Extended goal title' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    fireEvent.click(discardBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel from the confirm dialog keeps the modal open', async () => {
    const onClose = vi.fn();
    const onCompleted = vi.fn();
    render(
      <PromoteToGoal
        project={seededProject}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );

    const titleInput = screen.getByLabelText('Goal title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Extended goal title' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /promote to goal/i })).toBeInTheDocument();
  });
});
