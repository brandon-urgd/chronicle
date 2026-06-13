/// <reference types="vitest" />
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import RestoreFlow from '../components/RestoreFlow'

/* ── Helpers ── */

/** Create a mock File with given name and type */
function createMockFile(name = 'backup.json', type = 'application/json'): File {
  return new File(['{}'], name, { type })
}

/** Simulate selecting a file via the hidden input */
async function selectFile(file: File) {
  const input = screen.getByTestId('file-input') as HTMLInputElement
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
}

/** Build a valid validation summary for happy-path scenarios */
function buildHappySummary() {
  return {
    entries_count: 847,
    entries_date_range: ['2024-01-15', '2025-06-30'] as [string, string],
    programs: ['Safety', 'Reliability'],
    programs_count: 2,
    goals_count: 5,
    projects_count: 12,
    scheduled_items_count: 8,
    scheduled_instances_count: 24,
    tags_count: 15,
    tags: ['ops', 'review'],
    report_presets_count: 2,
    user_name: 'Brandon',
    user_role: 'ACO Manager',
    backup_version: '1.1',
    schema_version: 2,
    backup_date: '2025-07-10T17:47:00',
    tables_found: 21,
    tables_expected: 21,
  }
}

/* ── Shared setup ── */
const noop = () => {}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})


/* ══════════════════════════════════════════════════════════════════════
   1. Happy Path: file select → validate → preview → import → success
   Validates: Requirements 3.1–6.4
   ══════════════════════════════════════════════════════════════════════ */
describe('Happy path: full restore flow', () => {
  it('should go from file select → validation → preview → import → success screen', async () => {
    const summary = buildHappySummary()
    let fetchCallCount = 0

    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        // validate endpoint
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ valid: true, summary, warnings: [], errors: [] }),
        })
      }
      // import endpoint
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
    })
    vi.stubGlobal('fetch', mockFetch)

    const onComplete = vi.fn()
    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={onComplete} />
    )

    // Step 1: File select screen is shown
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()

    // Step 2: Select a file → triggers validation → preview
    await selectFile(createMockFile())

    await waitFor(() => {
      expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
    })

    // Verify preview shows summary data
    expect(screen.getByTestId('preview-entries-count').textContent).toBe('847')
    expect(screen.getByTestId('preview-user-name').textContent).toContain('Brandon')
    expect(screen.getByTestId('preview-user-role').textContent).toBe('ACO Manager')
    expect(screen.getByTestId('preview-programs-count').textContent).toBe('2')
    expect(screen.getByTestId('replace-warning')).toBeInTheDocument()

    // Step 3: Click "Restore This Backup" → triggers import
    await act(async () => {
      fireEvent.click(screen.getByTestId('restore-btn'))
    })

    // Advance past the 500ms minimum display time
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    // Step 4: Success screen
    await waitFor(() => {
      expect(screen.getByTestId('restore-success')).toBeInTheDocument()
    })

    expect(screen.getByTestId('restored-count').textContent).toContain('847')
    expect(screen.getByTestId('welcome-greeting').textContent).toContain('Welcome back')
    expect(screen.getByTestId('welcome-greeting').textContent).toContain('Brandon')
    expect(screen.getByTestId('go-to-today-btn')).toBeInTheDocument()

    // Verify fetch was called twice (validate + import)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // Step 5: Auto-redirect fires after 3 seconds
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})


/* ══════════════════════════════════════════════════════════════════════
   2. Invalid JSON error
   Validates: Requirements 7.1
   ══════════════════════════════════════════════════════════════════════ */
describe('Error path: invalid JSON', () => {
  it('should show error screen with "couldn\'t be read" message for invalid JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        valid: false,
        summary: null,
        warnings: [],
        errors: ['Invalid JSON: Expecting value at line 1'],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    await selectFile(createMockFile())

    await waitFor(() => {
      expect(screen.getByTestId('restore-error')).toBeInTheDocument()
    })

    // Verify error title matches invalid-json category
    expect(screen.getByTestId('error-title').textContent).toContain("couldn't be read")

    // Verify error messages are displayed
    const errorMessages = screen.getAllByTestId('error-message')
    expect(errorMessages).toHaveLength(1)
    expect(errorMessages[0].textContent).toContain('Invalid JSON')

    // Verify recovery controls
    expect(screen.getByTestId('try-another-btn')).toBeInTheDocument()
    expect(screen.getByTestId('error-start-fresh')).toBeInTheDocument()
  })
})


/* ══════════════════════════════════════════════════════════════════════
   3. Not a Chronicle backup
   Validates: Requirements 7.2
   ══════════════════════════════════════════════════════════════════════ */
describe('Error path: not a Chronicle backup', () => {
  it('should show error screen with "not a Chronicle backup" message for missing tables', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        valid: false,
        summary: null,
        warnings: [],
        errors: ['Missing required tables: entries, projects, tags'],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    await selectFile(createMockFile())

    await waitFor(() => {
      expect(screen.getByTestId('restore-error')).toBeInTheDocument()
    })

    // Verify error title matches not-chronicle category
    expect(screen.getByTestId('error-title').textContent).toContain("doesn't look like a Chronicle backup")

    // Verify error messages
    const errorMessages = screen.getAllByTestId('error-message')
    expect(errorMessages).toHaveLength(1)
    expect(errorMessages[0].textContent).toContain('Missing required tables')

    // Verify recovery controls
    expect(screen.getByTestId('try-another-btn')).toBeInTheDocument()
    expect(screen.getByTestId('error-start-fresh')).toBeInTheDocument()
  })
})


/* ══════════════════════════════════════════════════════════════════════
   4. Schema version mismatch
   Validates: Requirements 7.3
   ══════════════════════════════════════════════════════════════════════ */
describe('Error path: schema version mismatch', () => {
  it('should show error screen with "newer version" message and "Restore Anyway" option', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        valid: false,
        summary: null,
        warnings: [],
        errors: ['Schema version mismatch: backup is version 5, app supports version 2'],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    await selectFile(createMockFile())

    await waitFor(() => {
      expect(screen.getByTestId('restore-error')).toBeInTheDocument()
    })

    // Verify error title matches schema-mismatch category
    expect(screen.getByTestId('error-title').textContent).toContain('newer version')

    // Verify "Restore Anyway" button is present (unique to schema-mismatch)
    expect(screen.getByTestId('restore-anyway-btn')).toBeInTheDocument()

    // Verify other recovery controls
    expect(screen.getByTestId('try-another-btn')).toBeInTheDocument()
    expect(screen.getByTestId('error-start-fresh')).toBeInTheDocument()
  })
})


/* ══════════════════════════════════════════════════════════════════════
   5. Import failure
   Validates: Requirements 7.4, 7.5
   ══════════════════════════════════════════════════════════════════════ */
describe('Error path: import failure', () => {
  it('should show error screen with rollback message after import fails', async () => {
    const summary = buildHappySummary()
    let fetchCallCount = 0

    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCallCount++
      if (fetchCallCount === 1) {
        // validate succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ valid: true, summary, warnings: [], errors: [] }),
        })
      }
      // import fails
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ detail: 'UNIQUE constraint failed: entries.id' }),
      })
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    // Select file → preview
    await selectFile(createMockFile())
    await waitFor(() => {
      expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
    })

    // Click restore → import fails
    await act(async () => {
      fireEvent.click(screen.getByTestId('restore-btn'))
    })

    // Advance past 500ms minimum display time
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => {
      expect(screen.getByTestId('restore-error')).toBeInTheDocument()
    })

    // Verify error title matches import-failure category
    expect(screen.getByTestId('error-title').textContent).toContain('Something went wrong during restore')

    // Verify rollback confirmation text is present
    expect(screen.getByText(/rolled back/i)).toBeInTheDocument()

    // Verify import error detail is shown
    expect(screen.getByTestId('import-error-detail').textContent).toContain('UNIQUE constraint failed')

    // Verify recovery controls specific to import-failure
    expect(screen.getByTestId('try-again-btn')).toBeInTheDocument()
    expect(screen.getByTestId('copy-error-btn')).toBeInTheDocument()
    expect(screen.getByTestId('error-start-fresh')).toBeInTheDocument()
  })
})


/* ══════════════════════════════════════════════════════════════════════
   6. File type rejection
   Validates: Requirements 3.3, 3.5
   ══════════════════════════════════════════════════════════════════════ */
describe('Error path: non-JSON file rejection', () => {
  it('should show inline error when a non-JSON file is selected', async () => {
    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    // Select a .txt file instead of .json
    const txtFile = createMockFile('notes.txt', 'text/plain')
    await selectFile(txtFile)

    // Should stay on file-select step and show inline error
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.getByTestId('file-error')).toBeInTheDocument()
    expect(screen.getByTestId('file-error').textContent).toContain('.json')
  })
})


/* ══════════════════════════════════════════════════════════════════════
   7. Cancel from preview returns to file select
   Validates: Requirements 4.5
   ══════════════════════════════════════════════════════════════════════ */
describe('Navigation: cancel from preview', () => {
  it('should return to file select when cancel is clicked on preview', async () => {
    const summary = buildHappySummary()

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ valid: true, summary, warnings: [], errors: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
    )

    // Select file → preview
    await selectFile(createMockFile())
    await waitFor(() => {
      expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
    })

    // Click cancel
    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-btn'))
    })

    // Should be back on file-select
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.getByTestId('file-input')).toBeInTheDocument()
  })
})
