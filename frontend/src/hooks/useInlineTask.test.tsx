/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { useInlineTask } from './useInlineTask';

/**
 * useInlineTask — Dirty-State Close Guard (Task 9.14)
 *
 * Integration tests for the Portfolio inline task panel's dirty-close
 * behavior. The hook exposes `loadInlineTask(id)` to open the panel and
 * `renderInlineTaskPanel(id)` to render it; we exercise both through a small
 * consumer component that mirrors the pattern used by PortfolioView and
 * DashboardView.
 *
 * Dirty state = current form values diverge from the snapshot captured when
 * the task was loaded. Editing the Name input is the simplest path.
 *
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9**
 */

const seededTask = {
  id: 7,
  name: 'Seeded task',
  description: '',
  status: 'active',
  mode: 'one_time',
  recurrence_type: null,
  due_date: '2030-01-01',
  day_of_week: null,
  day_of_month: null,
  time_of_day: null,
  item_class: 'task',
  program_id: null,
  project_id: null,
  program_name: null,
  project_name: null,
  show_on_today: 1,
  require_acknowledgment: 0,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `/api/scheduled-items/${seededTask.id}`) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(seededTask) } as Response);
    }
    if (url.startsWith('/api/scheduled-items/') && url.endsWith('/instances?status=pending&limit=1')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.startsWith('/api/programs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.startsWith('/api/projects')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    if (url.startsWith('/api/goals')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Test consumer that auto-loads the task on mount and renders the panel.
 * Mirrors how PortfolioView / DashboardView actually use the hook.
 */
function InlineTaskHost({ taskId = seededTask.id }: { taskId?: number }) {
  const { loadInlineTask, renderInlineTaskPanel } = useInlineTask();
  useEffect(() => { loadInlineTask(taskId); }, [loadInlineTask, taskId]);
  return (
    <div>
      <div data-testid="outside-click-target">outside</div>
      {renderInlineTaskPanel(taskId)}
    </div>
  );
}

async function renderPanel() {
  render(<InlineTaskHost />);
  // The panel header "Task Details" is unique to the open panel.
  await screen.findByText(/task details/i);
  // The outside-click listener is installed on a 100ms debounce (see
  // useInlineTask) — wait long enough for it to attach before any outside
  // click is fired.
  await new Promise(resolve => setTimeout(resolve, 150));
  return screen.getByLabelText('Task name') as HTMLInputElement;
}

describe('useInlineTask — inline task panel dirty-state close guard (Task 9.14)', () => {
  it('clean outside click closes the panel', async () => {
    await renderPanel();

    // mousedown outside the panel — outside-click detection uses mousedown.
    const outside = screen.getByTestId('outside-click-target');
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      expect(screen.queryByText(/task details/i)).not.toBeInTheDocument();
    });
  });

  it('dirty outside click applies .modal-shake and keeps the panel open', async () => {
    const nameInput = await renderPanel();

    // Dirty the form.
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });

    const outside = screen.getByTestId('outside-click-target');
    fireEvent.mouseDown(outside);

    // The panel root carries .modal-shake immediately after the click.
    const shakeEl = document.querySelector('.modal-shake') as HTMLElement | null;
    expect(shakeEl).not.toBeNull();

    // Panel still mounted.
    expect(screen.getByText(/task details/i)).toBeInTheDocument();

    // Shake clears after 400ms — wait for the timer, then re-check.
    await waitFor(
      () => expect(document.querySelector('.modal-shake')).toBeNull(),
      { timeout: 1500 },
    );
  });

  it('dirty Esc opens the DiscardConfirmDialog', async () => {
    const nameInput = await renderPanel();
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const confirm = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirm).toBeInTheDocument();
  });

  it('Discard from the confirm dialog closes the panel', async () => {
    const nameInput = await renderPanel();
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(screen.queryByText(/task details/i)).not.toBeInTheDocument();
    });
  });

  it('Cancel from the confirm dialog keeps the panel open', async () => {
    const nameInput = await renderPanel();
    fireEvent.change(nameInput, { target: { value: 'Seeded task edited' } });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const cancelBtn = await screen.findByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    expect(screen.getByText(/task details/i)).toBeInTheDocument();
  });
});
