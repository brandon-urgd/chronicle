/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { useEffect } from 'react';
import { useInlineEntry } from './useInlineEntry';

/**
 * useInlineEntry — Dirty-State Close Guard (Task 9.14)
 *
 * Integration tests for the Portfolio inline entry panel's dirty-close
 * behavior. The detail view is always clean (no user input). Edit mode wraps
 * EntryFormView, which reports dirty transitions via its `onDirtyChange`
 * prop — the hook forwards those transitions into `useDirtyClose`.
 *
 * Test flow per dirty-state test:
 *   1. Mount host, wait for detail view (title "Seeded entry" visible)
 *   2. Click "Edit" to switch into edit mode
 *   3. Wait for EntryFormView's "Edit Entry" heading
 *   4. Dirty the form by changing the title input
 *   5. Trigger a close gesture (outside click, Esc, dialog button)
 *
 * **Validates: Requirements 11.2, 11.3, 11.4, 11.5, 11.9**
 */

const seededEntry = {
  id: 101,
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
  entry_date: '2030-01-01',
  entry_type: 'project_update',
  title: 'Seeded entry',
  description: 'Seeded description',
  project_id: null,
  project_name: null,
  program_id: null,
  program_name: null,
  status: 'completed',
  visibility: 'shareable',
  is_accomplishment: 0,
  is_weekly_highlight: 0,
  is_pinned: 0,
  tags: [],
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `/api/entries/${seededEntry.id}`) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(seededEntry) } as Response);
    }
    // EntryFormView mount fetches + any other API call: return empty arrays.
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function InlineEntryHost({ entryId = seededEntry.id }: { entryId?: number }) {
  const { loadInlineEntry, renderInlineEntryPanel } = useInlineEntry();
  // NOTE: Depending on `loadInlineEntry` here would re-run the effect on every
  // render (the hook doesn't memoize that function), resetting inlineEditMode
  // to false after every Edit click and making the test panel stuck in detail
  // view. Key only on entryId — the load is a one-shot fixture concern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadInlineEntry(entryId); }, [entryId]);
  return (
    <div>
      <div data-testid="outside-click-target">outside</div>
      {renderInlineEntryPanel(entryId)}
    </div>
  );
}

/** Mount, wait for detail view, wait out the 100ms click-outside debounce. */
async function renderDetailPanel() {
  render(<InlineEntryHost />);
  await screen.findByText('Seeded entry');
  // Wait for the 100ms outside-click listener install debounce (see useEffect
  // in useInlineEntry that delays addEventListener by 100ms).
  await new Promise(resolve => setTimeout(resolve, 150));
}

/**
 * Mount the detail panel, click Edit, wait for EntryFormView to load and
 * render the title input with the seeded value, then return that input so
 * tests can dirty it.
 */
async function renderAndEnterEditMode(): Promise<HTMLInputElement> {
  await renderDetailPanel();
  const editBtn = screen.getByRole('button', { name: /^edit$/i });
  fireEvent.click(editBtn);
  // Let React flush state transitions and EntryFormView's mount.
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  // First confirm edit mode actually entered (the hook's edit branch header).
  await waitFor(
    () => expect(screen.queryByText('Editing Entry')).toBeInTheDocument(),
    { timeout: 3000 },
  );
  // Then EntryFormView's loadEntry fetch resolves and populates the title input.
  const titleInput = (await screen.findByDisplayValue('Seeded entry', {}, { timeout: 3000 })) as HTMLInputElement;
  return titleInput;
}

describe('useInlineEntry — inline entry panel dirty-state close guard (Task 9.14)', () => {
  it('clean outside click (detail view) closes the panel', async () => {
    await renderDetailPanel();

    const outside = screen.getByTestId('outside-click-target');
    fireEvent.mouseDown(outside);

    await waitFor(() => {
      expect(screen.queryByText('Seeded entry')).not.toBeInTheDocument();
    });
  });

  it('dirty outside click (edit mode) applies .modal-shake and keeps the panel open', async () => {
    const titleInput = await renderAndEnterEditMode();

    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });
    await act(async () => { await Promise.resolve(); });

    const outside = screen.getByTestId('outside-click-target');
    fireEvent.mouseDown(outside);

    const shakeEl = document.querySelector('.modal-shake') as HTMLElement | null;
    expect(shakeEl).not.toBeNull();
    // Still in edit mode: the "Seeded entry edited" value still renders.
    expect(screen.getByDisplayValue('Seeded entry edited')).toBeInTheDocument();

    // Shake clears after 400ms.
    await waitFor(
      () => expect(document.querySelector('.modal-shake')).toBeNull(),
      { timeout: 1500 },
    );
  });

  it('dirty Esc opens the DiscardConfirmDialog', async () => {
    const titleInput = await renderAndEnterEditMode();
    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });
    await act(async () => { await Promise.resolve(); });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const confirm = await screen.findByRole('dialog', { name: /discard changes/i });
    expect(confirm).toBeInTheDocument();
  });

  it('Discard from the confirm dialog closes the panel', async () => {
    const titleInput = await renderAndEnterEditMode();
    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    const discardBtn = await screen.findByRole('button', { name: /discard changes/i });
    fireEvent.click(discardBtn);

    await waitFor(() => {
      expect(screen.queryByDisplayValue('Seeded entry edited')).not.toBeInTheDocument();
    });
  });

  it('Cancel from the confirm dialog keeps the panel open', async () => {
    const titleInput = await renderAndEnterEditMode();
    fireEvent.change(titleInput, { target: { value: 'Seeded entry edited' } });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    // Scope the Cancel query to inside the confirm dialog — EntryFormView
    // also renders a Cancel button (for the form itself) and a broad query
    // would match both.
    const confirmDialog = await screen.findByRole('dialog', { name: /discard changes/i });
    const { getByRole } = within(confirmDialog);
    const cancelBtn = getByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /discard changes/i })).not.toBeInTheDocument();
    });
    // Edit mode is still active.
    expect(screen.getByDisplayValue('Seeded entry edited')).toBeInTheDocument();
  });
});
