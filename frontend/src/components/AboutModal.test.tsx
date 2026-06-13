import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AboutModal from './AboutModal';

/**
 * Task 8.3 — Unit tests for the About modal's "Copy Diagnostic Info" button.
 *
 * Validates Requirement 10.1 (button exists), 10.3 (clicking fetches
 * /api/diagnostics and writes to clipboard), 10.6 ("Copied" confirmation
 * shows on success), 10.7 (textarea fallback when clipboard API is
 * unavailable).
 *
 * Note: @testing-library/user-event v14's `userEvent.setup()` installs its
 * own `navigator.clipboard` implementation. Any clipboard mock installed
 * before `setup()` will be overwritten. We therefore install our clipboard
 * stub INSIDE each test, AFTER calling `userEvent.setup()`, using
 * `Object.defineProperty` with `configurable: true` so the subsequent
 * `afterEach` cleanup can restore state.
 */

const DIAG_TEXT = [
  'Chronicle Diagnostic Bundle',
  'Generated: 2026-05-11T15:30:00Z',
  '',
  '== Version ==',
  'App version: 2.5.1',
  'Schema version: 2',
  '',
  '== System ==',
  'OS: windows',
  'Arch: x86_64',
  '',
  '== Data ==',
  'Data directory: C:\\Users\\test\\Chronicle',
  'Programs: 1',
  'Goals: 2',
  'Projects: 3',
  'Entries: 4',
  'Scheduled items: 5',
  'Scheduled item instances: 6',
  '',
  '== Recent Log (last 50 lines) ==',
  '2026-05-11T15:30:00Z INFO chronicle started',
].join('\n');

/** Remember the original clipboard descriptor so we can restore it. */
let originalClipboardDescriptor: PropertyDescriptor | undefined;

function snapshotClipboardDescriptor() {
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
}

function restoreClipboardDescriptor() {
  // Delete current override then restore the original (if any).
  try { delete (navigator as unknown as Record<string, unknown>).clipboard; } catch { /* ignore */ }
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  }
  originalClipboardDescriptor = undefined;
}

function installClipboardMock(writeTextMock: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: { writeText: writeTextMock },
  });
}

function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

describe('AboutModal — Copy Diagnostic Info (Task 8.3)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock fetch: /api/version returns a minimal version payload; /api/diagnostics
    // returns the plain-text bundle. Any other URL is a 404 — keeps the test strict.
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/version')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ app_version: '2.5.1', schema_version: 2 }),
        } as Response);
      }
      if (url.includes('/api/diagnostics')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(DIAG_TEXT),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    snapshotClipboardDescriptor();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreClipboardDescriptor();
  });

  it('renders a "Copy Diagnostic Info" button (Requirement 10.1)', async () => {
    render(<AboutModal onClose={() => {}} />);
    const button = await screen.findByRole('button', { name: /copy diagnostic info/i });
    expect(button).toBeInTheDocument();
  });

  it('clicking the button fetches /api/diagnostics, writes to clipboard, and shows Copied', async () => {
    // `userEvent.setup()` installs its own navigator.clipboard — install OUR
    // mock AFTER setup so the handler sees our writeText spy.
    const user = userEvent.setup();

    const writeTextMock = vi.fn(() => Promise.resolve());
    installClipboardMock(writeTextMock);

    render(<AboutModal onClose={() => {}} />);

    const button = await screen.findByRole('button', { name: /copy diagnostic info/i });
    await user.click(button);

    // Requirement 10.3 — fetch is called with the diagnostics endpoint.
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(call => {
        const input = call[0];
        return typeof input === 'string' ? input : input.toString();
      });
      expect(urls.some(u => u.includes('/api/diagnostics'))).toBe(true);
    });

    // Requirement 10.3 — the fetched text is written to the system clipboard.
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    expect(writeTextMock).toHaveBeenCalledWith(DIAG_TEXT);

    // Requirement 10.6 — the UI briefly shows a "Copied" confirmation.
    await waitFor(() => {
      expect(screen.getByText(/^copied$/i)).toBeInTheDocument();
    });
  });

  it('falls back to a read-only textarea when the clipboard API is unavailable (Requirement 10.7)', async () => {
    const user = userEvent.setup();

    // After user-event installs its clipboard stub, remove it so the
    // fallback branch triggers inside the component.
    removeClipboard();

    render(<AboutModal onClose={() => {}} />);

    const button = await screen.findByRole('button', { name: /copy diagnostic info/i });
    await user.click(button);

    const textarea = await screen.findByRole('textbox');
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('readonly');
    expect((textarea as HTMLTextAreaElement).value).toBe(DIAG_TEXT);
  });
});
