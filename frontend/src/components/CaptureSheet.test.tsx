import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import fc from 'fast-check';
import CaptureSheet, { parseBatchLines, CaptureMode } from './CaptureSheet';

/**
 * Property 4: CaptureSheet Mode Field Visibility
 *
 * For any selected Capture_Mode (Log, Task, or Rhythm), the CaptureSheet SHALL render
 * exactly the fields defined in the mode-field mapping table and SHALL NOT render fields
 * belonging to other modes.
 *
 * **Validates: Requirements 6.4, 7.1-7.6, 8.1-8.4, 9.1-9.4**
 */

const mockPrograms = [
  { id: 1, name: 'Program A', status: 'active', color: '#3b82f6' },
];
const mockProjects = [
  { id: 1, name: 'Project X', goal_id: null, status: 'active', program_id: 1 },
];
const mockGoals = [
  { id: 1, program_id: 1 },
];

/* ── Mock fetch to prevent network calls during render ── */
let mockStore: Record<string, string> = {};

beforeEach(() => {
  // Reset localStorage mock state completely before each test
  mockStore = {};
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/api/programs')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockPrograms) });
    }
    if (url.includes('/api/projects')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockProjects) });
    }
    if (url.includes('/api/goals')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGoals) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => mockStore[key] ?? null,
    setItem: (key: string, value: string) => { mockStore[key] = value; },
    removeItem: (key: string) => { delete mockStore[key]; },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Mode-field mapping table from the design document:
 *
 * Log mode:    Title, Program pills, Project dropdown
 *              NOT visible: Due date, Frequency, Start date
 *
 * Task mode:   Name, Due date, Time, Program pills, Project dropdown
 *              NOT visible: Frequency, Status selector, Start date (labeled as such)
 *
 * Rhythm mode: Name, Frequency, Start date, Time, Program pills, Project dropdown
 *              NOT visible: Status selector
 */

const MODE_FIELDS: Record<CaptureMode, { visible: string[]; notVisible: string[] }> = {
  log: {
    visible: ['Entry title', 'Project'],
    notVisible: ['Due date', 'Due time', 'Start date'],
  },
  task: {
    visible: ['Task name', 'Due date', 'Due time', 'Project'],
    notVisible: ['Start date', 'Status'],
  },
  rhythm: {
    visible: ['Cadence name', 'Start date', 'Time', 'Project'],
    notVisible: ['Status'],
  },
};

/* Frequency options only appear in Rhythm mode */
const FREQUENCY_OPTIONS = ['Weekly', 'Biweekly', 'Monthly', 'Quarterly'];

describe('Property 4: CaptureSheet Mode Field Visibility', () => {
  const modeArb = fc.constantFrom<CaptureMode>('log', 'task', 'rhythm');

  it('renders exactly the fields defined for the selected mode and hides fields from other modes', () => {
    fc.assert(
      fc.property(modeArb, (mode) => {
        // Reset localStorage mock for each iteration to prevent state leakage
        mockStore = {};
        localStorage.setItem('chronicle-capture-mode', mode);

        const { unmount } = render(
          <CaptureSheet onClose={() => {}} onSaved={() => {}} />
        );

        const spec = MODE_FIELDS[mode];

        // Check visible fields via aria-labels
        for (const field of spec.visible) {
          const el = screen.queryByLabelText(field);
          expect(el, `Expected "${field}" to be visible in ${mode} mode`).not.toBeNull();
        }

        // Check NOT visible fields via aria-labels
        for (const field of spec.notVisible) {
          const el = screen.queryByLabelText(field);
          expect(el, `Expected "${field}" to NOT be visible in ${mode} mode`).toBeNull();
        }

        // Frequency selector: only visible in rhythm mode
        if (mode === 'rhythm') {
          for (const freq of FREQUENCY_OPTIONS) {
            const el = screen.queryByText(freq);
            expect(el, `Expected frequency "${freq}" to be visible in rhythm mode`).not.toBeNull();
          }
        } else {
          // In non-rhythm modes, frequency options should not be present
          const freqEl = screen.queryByText('Weekly');
          expect(freqEl, `Expected frequency options to NOT be visible in ${mode} mode`).toBeNull();
        }

        // Mode-specific button text
        if (mode === 'log') {
          expect(screen.queryByText('Save')).not.toBeNull();
          expect(screen.queryByText('Save & New')).not.toBeNull();
          expect(screen.queryByText('Create Task')).toBeNull();
          expect(screen.queryByText('Create Cadence')).toBeNull();
        } else if (mode === 'task') {
          expect(screen.queryByText('Create Task')).not.toBeNull();
          expect(screen.queryByText('Save')).toBeNull();
          expect(screen.queryByText('Create Cadence')).toBeNull();
        } else if (mode === 'rhythm') {
          expect(screen.queryByText('Create Cadence')).not.toBeNull();
          expect(screen.queryByText('Save')).toBeNull();
          expect(screen.queryByText('Create Task')).toBeNull();
        }

        unmount();
        cleanup();
      }),
      { numRuns: 100 }
    );
  });

  it('Log mode shows Title and Program pills but NOT Due date or Frequency', async () => {
    localStorage.setItem('chronicle-capture-mode', 'log');
    render(<CaptureSheet onClose={() => {}} onSaved={() => {}} />);

    // Title field present
    expect(screen.getByLabelText('Entry title')).toBeInTheDocument();
    // Program pills present (listbox) — wait for async fetch
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Select program' })).toBeInTheDocument();
    });
    // Project dropdown present
    expect(screen.getByLabelText('Project')).toBeInTheDocument();
    // Due date NOT present
    expect(screen.queryByLabelText('Due date')).toBeNull();
    // Frequency NOT present
    expect(screen.queryByText('Weekly')).toBeNull();
  });

  it('Task mode shows Name, Due date, Time, Program pills, Project but NOT Frequency or Status', async () => {
    localStorage.setItem('chronicle-capture-mode', 'task');
    render(<CaptureSheet onClose={() => {}} onSaved={() => {}} />);

    expect(screen.getByLabelText('Task name')).toBeInTheDocument();
    expect(screen.getByLabelText('Due date')).toBeInTheDocument();
    expect(screen.getByLabelText('Due time')).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toBeInTheDocument();
    // Wait for programs to load
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Select program' })).toBeInTheDocument();
    });
    // Frequency NOT present
    expect(screen.queryByText('Weekly')).toBeNull();
    // Status NOT present
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('Rhythm mode shows Name, Frequency, Start date, Time, Program pills, Project but NOT Status', async () => {
    localStorage.setItem('chronicle-capture-mode', 'rhythm');
    render(<CaptureSheet onClose={() => {}} onSaved={() => {}} />);

    expect(screen.getByLabelText('Cadence name')).toBeInTheDocument();
    expect(screen.getByLabelText('Start date')).toBeInTheDocument();
    expect(screen.getByLabelText('Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Project')).toBeInTheDocument();
    // Frequency options present
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Biweekly')).toBeInTheDocument();
    expect(screen.getByText('Monthly')).toBeInTheDocument();
    expect(screen.getByText('Quarterly')).toBeInTheDocument();
    // Wait for programs to load
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: 'Select program' })).toBeInTheDocument();
    });
    // Status NOT present
    expect(screen.queryByLabelText('Status')).toBeNull();
  });
});

/**
 * Property 5: Batch Mode Item Count
 *
 * For any multi-line text input submitted in Batch Sub-Mode, the number of items created
 * SHALL equal the number of non-empty (after trimming) lines in the input.
 *
 * **Validates: Requirements 10.3, 10.4, 10.5**
 */
describe('Property 5: Batch Mode Item Count', () => {
  it('parseBatchLines returns exactly the number of non-empty trimmed lines', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 2000 }),
        (text) => {
          const result = parseBatchLines(text);
          const expectedCount = text
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 0).length;
          expect(result.length).toBe(expectedCount);
        }
      ),
      { numRuns: 500 }
    );
  });

  it('each parsed item text matches the corresponding non-empty trimmed line', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 200 }), { minLength: 1, maxLength: 50 }),
        (lines) => {
          const text = lines.join('\n');
          const result = parseBatchLines(text);
          const expectedLines = lines.map(l => l.trim()).filter(l => l.length > 0);
          expect(result.length).toBe(expectedLines.length);
          for (let i = 0; i < result.length; i++) {
            expect(result[i].line).toBe(expectedLines[i]);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  it('empty or whitespace-only input produces zero items', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '  ', '\t\t'), { minLength: 0, maxLength: 20 }),
        (parts) => {
          const whitespace = parts.join('');
          const result = parseBatchLines(whitespace);
          expect(result.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('lines with only whitespace are excluded from the count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            // Non-empty content lines
            fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0 && !s.includes('\n')),
            // Whitespace-only lines (spaces and tabs only, no newlines)
            fc.array(fc.constantFrom(' ', '\t'), { minLength: 1, maxLength: 10 }).map(a => a.join(''))
          ),
          { minLength: 1, maxLength: 30 }
        ),
        (lines) => {
          const text = lines.join('\n');
          const result = parseBatchLines(text);
          const nonEmptyCount = lines.filter(l => l.trim().length > 0).length;
          expect(result.length).toBe(nonEmptyCount);
        }
      ),
      { numRuns: 200 }
    );
  });
});

/*
 * Dirty-state close-guard integration tests live in a dedicated file:
 *   `CaptureSheet.dirtyClose.test.tsx`
 * That keeps field-visibility and batch-parsing property tests in this file
 * separate from the modal-close-guard wiring tests (Task 9.14).
 */
