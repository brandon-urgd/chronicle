/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import TimelineView from './TimelineView';

/**
 * TimelineView — Entry Edit Modal Dirty-State Close Guard (Task 9.14)
 *
 * Integration tests for the entry edit modal's dirty-close behavior. The
 * modal is opened by clicking an entry card; the wrapped EntryFormView
 * reports dirty transitions via `onDirtyChange`, which TimelineView routes
 * through `useDirtyClose`.
 *
 * Dirtying the form means editing any field after load — here we edit the
 * Title input, which is the simplest deterministic way to trigger a dirty
 * transition from EntryFormView's serialized baseline.
 *
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9**
 */

const seededEntry = {
  id: 101,
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
  entry_date: '2030-01-01',
  entry_type: 'project_update',
  work_type: 'project',
  title: 'Seeded entry',
  description: 'Seeded description',
  impact: null,
  metrics: null,
  project_id: null,
  project_name: null,
  program_id: null,
  program_name: null,
  scheduled_item_id: null,
  status: 'completed',
  visibility: 'shareable',
  is_accomplishment: 0,
  is_lesson_learned: 0,
  is_weekly_highlight: 0,
  is_pinned: 0,
  outcome: null,
  tags: [],
  links: [],
  attachments: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/entries/101')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(seededEntry) } as Response);
    }
    if (url.startsWith('/api/entries')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([seededEntry]) } as Response);
    }
    if (url.startsWith('/api/scheduled-items/instances')) {
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
    if (url.startsWith('/api/tags')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/**
 * Opens the edit modal by:
 *   1. Rendering TimelineView
 *   2. Waiting for the seeded entry title to appear in the list
 *   3. Clicking the card
 *   4. Waiting for the edit overlay's `<h3>Edit Entry</h3>` to appear
 */
async function openEditModal() {
  render(<TimelineView />);
  // Wait for the card — the seeded entry title appears in the timeline body.
  // Use a flexible matcher since the title may be nested inside decorated spans.
  const card = await screen.findByText('Seeded entry', { exact: false });
  fireEvent.click(card);
  // The edit overlay renders EntryFormView which shows "Edit Entry" heading.
  const heading = await screen.findByRole('heading', { name: /edit entry/i });
  // The dialog container is the nearest ancestor with role="dialog".
  return heading.closest('[role="dialog"]') as HTMLElement;
}

describe('TimelineView — entry edit modal dirty-state close guard (Task 9.14)', () => {
  it('clean backdrop click closes the modal', async () => {
    const dialog = await openEditModal();
    expect(dialog).not.toBeNull();

    // Clicking the dialog (overlay) with a clean form closes it.
    fireEvent.click(dialog!);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /edit entry/i })).not.toBeInTheDocument();
    });
  });

  it('dirty backdrop click applies .modal-shake and keeps the modal open', async () => {
    const dialog = await openEditModal();

    // Dirty the form: edit the title.
    const titleInput = within(dialog!).getByDisplayValue('Seeded entry') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });

    // EntryFormView emits dirty via onDirtyChange in a useEffect; flush
    // the state update before clicking the backdrop.
    await act(async () => { await Promise.resolve(); });

    // Install fake timers AFTER the modal is open — findByRole polling
    // relies on real setTimeout while we wait for the edit overlay.
    vi.useFakeTimers();
    try {
      fireEvent.click(dialog!);

      const shakePanel = dialog!.querySelector('.modal-shake') as HTMLElement | null;
      expect(shakePanel).not.toBeNull();

      // Modal still mounted.
      expect(screen.getByRole('heading', { name: /edit entry/i })).toBeInTheDocument();

      // Shake clears after 400ms.
      act(() => { vi.advanceTimersByTime(400); });
      expect(dialog!.querySelector('.modal-shake')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dirty Esc opens the DiscardConfirmDialog', async () => {
    const dialog = await openEditModal();
    const titleInput = within(dialog!).getByDisplayValue('Seeded entry') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    // Focus the input so the focus-trap container receives bubbled key events.
    titleInput.focus();
    // Fire directly on the dialog container where useFocusTrap's listener lives.
    fireEvent.keyDown(dialog!, { key: 'Escape' });

    const confirm = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirm).toBeInTheDocument();
  });

  it('Discard from the confirm dialog closes the modal', async () => {
    const dialog = await openEditModal();
    const titleInput = within(dialog!).getByDisplayValue('Seeded entry') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Edited title' } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    titleInput.focus();
    fireEvent.keyDown(dialog!, { key: 'Escape' });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /edit entry/i })).not.toBeInTheDocument();
    });
  });

  it('Cancel from the confirm dialog keeps the modal open', async () => {
    const dialog = await openEditModal();
    const titleInput = within(dialog!).getByDisplayValue('Seeded entry') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Edited title' } });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    titleInput.focus();
    fireEvent.keyDown(dialog!, { key: 'Escape' });

    // Scope Cancel to the confirm dialog — EntryFormView also has a Cancel
    // button that would match a broad query.
    const confirmDialog = await screen.findByRole('dialog', { name: /discard changes/i });
    const cancelBtn = within(confirmDialog).getByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: /edit entry/i })).toBeInTheDocument();
  });
});
