/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import DashboardView from './DashboardView';

/**
 * DashboardView — Task Edit Modal Dirty-State Close Guard (Task 9.14)
 *
 * Integration tests for the task edit modal's dirty-close behavior. The modal
 * is opened by clicking a task row; its dirty predicate compares the current
 * form state to the snapshot captured when the modal opened.
 *
 * We seed the Today list with a single task so there's a deterministic row to
 * click, then edit the Name input to dirty the form.
 *
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9**
 */

const todayTask = {
  instance_id: 42,
  scheduled_item_id: 7,
  due_date: '2030-01-01',
  due_time: null,
  status: 'pending',
  name: 'Seeded task',
  program_id: null,
  program_name: null,
  quick_complete: 0,
  template_entry_type: 'quick_capture',
  template_work_type: 'operational_rhythm',
  project_id: null,
  project_name: null,
  item_class: 'task',
  recurrence_type: null,
  require_acknowledgment: 0,
};

const scheduledItem = {
  id: 7,
  name: 'Seeded task',
  description: '',
  mode: 'one_time',
  due_date: '2030-01-01',
  template_visibility: 'shareable',
  require_acknowledgment: 0,
  program_id: null,
  project_id: null,
};

const dashboardPayload = {
  entries_this_week: 0,
  entries_this_month: 0,
  entries_this_quarter: 0,
  active_projects: 0,
  goals_on_track: 0,
  goals_at_risk: 0,
  days_since_last_entry: null,
  weekly_highlight: null,
  recent_entries: [],
  gap_dates: [],
  operational_rhythm_count: 0,
  open_todos: [],
  open_todos_count: 0,
  program_activity: [],
  due_today: null,
  insights: [],
};

const dueTodayPayload = {
  today: [todayTask],
  overdue: [],
  completed_today: 0,
  pending_today: 1,
  skipped_today: 0,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/dashboard')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(dashboardPayload) } as Response);
    }
    if (url.startsWith('/api/programs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.startsWith('/api/projects')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url === '/api/scheduled-items/due') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(dueTodayPayload) } as Response);
    }
    if (url === '/api/scheduled-items' || url.startsWith('/api/scheduled-items?')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.startsWith('/api/scheduled-items/instances')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url === `/api/scheduled-items/${scheduledItem.id}`) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(scheduledItem) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Safety: if a test installs fake timers and fails before restoring them,
  // the next test's findByRole polling would hang. Always restore real
  // timers between tests.
  vi.useRealTimers();
});

async function openTaskModal() {
  render(<DashboardView />);
  // Wait for the dashboard to load and seeded task to appear.
  const row = await screen.findByRole('button', { name: /edit seeded task/i });
  fireEvent.click(row);
  // Wait for the edit dialog to mount with the seeded name.
  return await screen.findByRole('dialog', { name: /edit task/i });
}

describe('DashboardView — task modal dirty-state close guard (Task 9.14)', () => {
  it('clean backdrop click closes the modal', async () => {
    const dialog = await openTaskModal();

    // Sanity: the dialog is mounted.
    expect(dialog).toBeInTheDocument();

    // Click the overlay (dialog element itself; the inner panel stops propagation).
    fireEvent.click(dialog);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /edit task/i })).not.toBeInTheDocument();
    });
  });

  it('dirty backdrop click applies .modal-shake (and keeps the modal open)', async () => {
    const dialog = await openTaskModal();
    const nameInput = within(dialog).getByDisplayValue('Seeded task') as HTMLInputElement;

    // Dirty the form: edit the name.
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });

    // Install fake timers AFTER the modal is mounted — findByRole polling
    // relies on real setTimeout while we wait for the dialog.
    vi.useFakeTimers();
    try {
      // Click the backdrop while dirty.
      fireEvent.click(dialog);

      // The inner panel carries the shake class.
      const shakePanel = dialog.querySelector('.modal-shake') as HTMLElement | null;
      expect(shakePanel).not.toBeNull();

      // Modal is still open.
      expect(screen.getByRole('dialog', { name: /edit task/i })).toBeInTheDocument();

      // Shake clears after 400ms.
      act(() => { vi.advanceTimersByTime(400); });
      expect(dialog.querySelector('.modal-shake')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dirty Esc opens the DiscardConfirmDialog', async () => {
    const dialog = await openTaskModal();
    const nameInput = within(dialog).getByDisplayValue('Seeded task') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });

    // Esc listens at document-level in DashboardView.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const confirm = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirm).toBeInTheDocument();
  });

  it('Discard from the confirm dialog closes the modal', async () => {
    const dialog = await openTaskModal();
    const nameInput = within(dialog).getByDisplayValue('Seeded task') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /edit task/i })).not.toBeInTheDocument();
    });
  });

  it('Cancel from the confirm dialog keeps the modal open', async () => {
    const dialog = await openTaskModal();
    const nameInput = within(dialog).getByDisplayValue('Seeded task') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('dialog', { name: /edit task/i })).toBeInTheDocument();
  });
});
