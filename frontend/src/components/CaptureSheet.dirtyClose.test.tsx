import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CaptureSheet from './CaptureSheet';

/**
 * CaptureSheet — Dirty-State Close Guard Integration Tests (Task 9.14.A)
 *
 * Exercises the full CaptureSheet surface end-to-end against the shared
 * `useDirtyClose` hook. The hook is unit-tested in `hooks/useDirtyClose.test.ts`
 * (Task 9.13); these tests verify the CaptureSheet's wiring —
 * backdrop click, Esc, Discard, Cancel — hits the right branches for its
 * `isDirty` predicate (title, description, batchText non-empty, or program/
 * project diverged from prefill).
 *
 * Typing into the title input is the cheapest way to flip the form to dirty.
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9
 */

/* ── Mock fetch so CaptureSheet's mount-time data loads resolve cleanly ── */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/programs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.includes('/api/goals')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.includes('/api/tags')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    // Fallback: any other URL returns an empty array. Keeps the test strict
    // without failing on an unexpected fetch.
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }));

  // Minimal localStorage shim so CaptureSheet can read/write its mode.
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  // Default to log mode so the "Entry title" input is present.
  localStorage.setItem('chronicle-capture-mode', 'log');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CaptureSheet — dirty-state close guard', () => {
  it('clean backdrop click calls onClose and does not shake (Requirement 11.2)', async () => {
    // userEvent.setup() is called per task convention; the actual backdrop
    // click uses fireEvent.click for a direct, unambiguous hit on the overlay
    // element (the panel stops propagation, so only clicks that land on the
    // overlay itself trigger handleBackdropClick).
    userEvent.setup();

    const onClose = vi.fn();
    const { container } = render(
      <CaptureSheet onClose={onClose} onSaved={() => {}} />
    );

    const overlay = container.querySelector('.quick-capture-overlay') as HTMLElement;
    expect(overlay).toBeTruthy();

    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalledTimes(1);

    const panel = container.querySelector('.quick-capture-panel') as HTMLElement;
    expect(panel.className).not.toMatch(/modal-shake/);
  });

  it('dirty backdrop click applies .modal-shake for 400ms and does NOT call onClose (Requirement 11.3)', async () => {
    vi.useFakeTimers();
    try {
      // userEvent is still set up per convention, but we rely on fireEvent here
      // to avoid entangling userEvent's internal microtasks with fake timers.
      userEvent.setup();

      const onClose = vi.fn();
      const { container } = render(
        <CaptureSheet onClose={onClose} onSaved={() => {}} />
      );

      // Dirty the form by typing a title. fireEvent.change is synchronous and
      // does not require a tick under fake timers.
      const titleInput = screen.getByLabelText('Entry title') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Draft entry' } });

      const overlay = container.querySelector('.quick-capture-overlay') as HTMLElement;
      const panel = container.querySelector('.quick-capture-panel') as HTMLElement;

      fireEvent.click(overlay);

      // Shake class applied immediately; onClose not called.
      expect(panel.className).toMatch(/modal-shake/);
      expect(onClose).not.toHaveBeenCalled();

      // Shake persists until the 400ms timer completes.
      act(() => { vi.advanceTimersByTime(399); });
      expect(panel.className).toMatch(/modal-shake/);

      act(() => { vi.advanceTimersByTime(1); });
      expect(panel.className).not.toMatch(/modal-shake/);
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dirty Esc opens the DiscardConfirmDialog (Requirement 11.5)', async () => {
    userEvent.setup();

    const onClose = vi.fn();
    render(<CaptureSheet onClose={onClose} onSaved={() => {}} />);

    // Dirty the form.
    const titleInput = screen.getByLabelText('Entry title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Unsaved work' } });

    // CaptureSheet wires Esc through useFocusTrap on the overlay container,
    // which catches bubbling keydown from the focused input.
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    const confirmDialog = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirmDialog).toBeInTheDocument();

    // The underlying CaptureSheet is still mounted; onClose has not fired.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Discard button closes the sheet (Requirement 11.5)', async () => {
    const user = userEvent.setup();

    const onClose = vi.fn();
    render(<CaptureSheet onClose={onClose} onSaved={() => {}} />);

    const titleInput = screen.getByLabelText('Entry title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Work in progress' } });
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    await user.click(discardBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancel button dismisses the dialog; onClose is NOT called (Requirement 11.5)', async () => {
    const user = userEvent.setup();

    const onClose = vi.fn();
    render(<CaptureSheet onClose={onClose} onSaved={() => {}} />);

    const titleInput = screen.getByLabelText('Entry title') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Keep me around' } });
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
    await user.click(cancelBtn);

    // Confirm dialog unmounts.
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    // CaptureSheet is still mounted.
    expect(screen.getByLabelText('Entry title')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
