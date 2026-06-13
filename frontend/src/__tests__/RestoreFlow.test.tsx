/// <reference types="vitest" />
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import * as fc from 'fast-check'
import RestoreFlow from '../components/RestoreFlow'

/* ── Helpers ── */

/** Create a mock File object with the given name */
function createMockJsonFile(name = 'backup.json'): File {
  return new File(['{}'], name, { type: 'application/json' })
}

/** Simulate selecting a file via the hidden input */
async function selectFile(file: File) {
  const input = screen.getByTestId('file-input') as HTMLInputElement
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
}

/** Build a valid DataValidateResponse summary from arbitrary values */
function buildValidationSummary(overrides: Partial<{
  entries_count: number
  entries_date_range: [string, string] | []
  programs: string[]
  programs_count: number
  goals_count: number
  projects_count: number
  tags_count: number
  tags: string[]
  scheduled_items_count: number
  user_name: string | null
  user_role: string | null
}>) {
  return {
    entries_count: overrides.entries_count ?? 0,
    entries_date_range: overrides.entries_date_range ?? [],
    programs: overrides.programs ?? [],
    programs_count: overrides.programs_count ?? 0,
    goals_count: overrides.goals_count ?? 0,
    projects_count: overrides.projects_count ?? 0,
    scheduled_items_count: overrides.scheduled_items_count ?? 0,
    scheduled_instances_count: 0,
    tags_count: overrides.tags_count ?? 0,
    tags: overrides.tags ?? [],
    report_presets_count: 0,
    user_name: overrides.user_name ?? null,
    user_role: overrides.user_role ?? null,
    backup_version: '1.1',
    schema_version: 2,
    backup_date: '2025-01-15T10:00:00',
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
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})


/* ══════════════════════════════════════════════════════════════════════
   Property 1: Preview screen displays all summary fields
   Validates: Requirements 4.3
   ══════════════════════════════════════════════════════════════════════ */
describe('Feature: backup-and-onboarding, Property 1: Preview screen displays all summary fields', () => {
  it('should display all summary fields for any valid DataValidateResponse', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          entries_count: fc.nat({ max: 100000 }),
          programs_count: fc.nat({ max: 500 }),
          goals_count: fc.nat({ max: 500 }),
          projects_count: fc.nat({ max: 500 }),
          tags_count: fc.nat({ max: 500 }),
          scheduled_items_count: fc.nat({ max: 500 }),
          user_name: fc.string({ minLength: 1, maxLength: 50 }),
          user_role: fc.string({ minLength: 1, maxLength: 50 }),
        }),
        async (vals) => {
          const summary = buildValidationSummary({
            entries_count: vals.entries_count,
            entries_date_range: ['2024-01-01', '2025-06-30'],
            programs: ['Program A'],
            programs_count: vals.programs_count,
            goals_count: vals.goals_count,
            projects_count: vals.projects_count,
            tags_count: vals.tags_count,
            tags: [],
            scheduled_items_count: vals.scheduled_items_count,
            user_name: vals.user_name,
            user_role: vals.user_role,
          })

          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              valid: true,
              summary,
              warnings: [],
              errors: [],
            }),
          })
          vi.stubGlobal('fetch', mockFetch)

          const { unmount } = render(
            <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
          )

          // Select a file to trigger validation → preview
          await selectFile(createMockJsonFile())

          await waitFor(() => {
            expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
          })

          // Verify all summary fields are present
          expect(screen.getByTestId('preview-entries-count').textContent).toBe(String(vals.entries_count))
          expect(screen.getByTestId('preview-date-range').textContent).toContain('2024-01-01')
          expect(screen.getByTestId('preview-programs-count').textContent).toBe(String(vals.programs_count))
          expect(screen.getByTestId('preview-goals-count').textContent).toBe(String(vals.goals_count))
          expect(screen.getByTestId('preview-projects-count').textContent).toBe(String(vals.projects_count))
          expect(screen.getByTestId('preview-tags-count').textContent).toBe(String(vals.tags_count))
          expect(screen.getByTestId('preview-scheduled-count').textContent).toBe(String(vals.scheduled_items_count))
          expect(screen.getByTestId('preview-user-name').textContent).toContain(vals.user_name)
          expect(screen.getByTestId('preview-user-role').textContent).toBe(vals.user_role)

          unmount()
        cleanup()
        }
      ),
      { numRuns: 100 }
    )
  })
})


/* ══════════════════════════════════════════════════════════════════════
   Property 2: Validation error messages appear in error screen
   Validates: Requirements 4.7
   ══════════════════════════════════════════════════════════════════════ */
describe('Feature: backup-and-onboarding, Property 2: Validation error messages appear in error screen', () => {
  it('should display all error messages for any array of error strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 10 }
        ),
        async (errors) => {
          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              valid: false,
              summary: null,
              warnings: [],
              errors,
            }),
          })
          vi.stubGlobal('fetch', mockFetch)

          const { unmount } = render(
            <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
          )

          await selectFile(createMockJsonFile())

          await waitFor(() => {
            expect(screen.getByTestId('restore-error')).toBeInTheDocument()
          })

          // Every error message should be rendered
          const errorEls = screen.getAllByTestId('error-message')
          expect(errorEls.length).toBe(errors.length)
          errors.forEach((errMsg, i) => {
            expect(errorEls[i].textContent).toBe(errMsg)
          })

          unmount()
        cleanup()
        }
      ),
      { numRuns: 100 }
    )
  })
})


/* ══════════════════════════════════════════════════════════════════════
   Property 3: Validation warnings appear in preview screen
   Validates: Requirements 4.8
   ══════════════════════════════════════════════════════════════════════ */
describe('Feature: backup-and-onboarding, Property 3: Validation warnings appear in preview screen', () => {
  it('should display all warning messages for any array of warning strings', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          { minLength: 1, maxLength: 10 }
        ),
        async (warnings) => {
          const summary = buildValidationSummary({
            entries_count: 10,
            entries_date_range: ['2024-01-01', '2025-01-01'],
            programs: [],
            programs_count: 0,
            goals_count: 0,
            projects_count: 0,
            tags_count: 0,
            tags: [],
            scheduled_items_count: 0,
            user_name: 'Test User',
            user_role: 'Tester',
          })

          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
              valid: true,
              summary,
              warnings,
              errors: [],
            }),
          })
          vi.stubGlobal('fetch', mockFetch)

          const { unmount } = render(
            <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
          )

          await selectFile(createMockJsonFile())

          await waitFor(() => {
            expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
          })

          // Every warning should be rendered
          const warningEls = screen.getAllByTestId('preview-warning')
          expect(warningEls.length).toBe(warnings.length)
          warnings.forEach((warnMsg, i) => {
            expect(warningEls[i].textContent).toContain(warnMsg)
          })

          unmount()
        cleanup()
        }
      ),
      { numRuns: 100 }
    )
  })
})


/* ══════════════════════════════════════════════════════════════════════
   Property 4: Success screen displays entry count and personalized greeting
   Validates: Requirements 6.1, 6.2
   ══════════════════════════════════════════════════════════════════════ */
describe('Feature: backup-and-onboarding, Property 4: Success screen displays entry count and personalized greeting', () => {
  it('should display entry count and greeting for any count and user name', { timeout: 60000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: 100000 }),
        fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
        async (entryCount, userName) => {
          const summary = buildValidationSummary({
            entries_count: entryCount,
            entries_date_range: ['2024-01-01', '2025-01-01'],
            programs: [],
            programs_count: 0,
            goals_count: 0,
            projects_count: 0,
            tags_count: 0,
            tags: [],
            scheduled_items_count: 0,
            user_name: userName,
            user_role: 'User',
          })

          let fetchCallCount = 0
          const mockFetch = vi.fn().mockImplementation(() => {
            fetchCallCount++
            if (fetchCallCount === 1) {
              // First call: validate endpoint
              return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({
                  valid: true,
                  summary,
                  warnings: [],
                  errors: [],
                }),
              })
            }
            // Second call: import endpoint
            return Promise.resolve({
              ok: true,
              json: () => Promise.resolve({ success: true }),
            })
          })
          vi.stubGlobal('fetch', mockFetch)

          const { unmount } = render(
            <RestoreFlow mode="onboarding" onBack={noop} onStartFresh={noop} onComplete={noop} />
          )

          // Step 1: Select file → triggers validation → preview
          await selectFile(createMockJsonFile())

          await waitFor(() => {
            expect(screen.getByTestId('restore-preview')).toBeInTheDocument()
          })

          // Step 2: Click "Restore This Backup" → triggers import → success
          await act(async () => {
            fireEvent.click(screen.getByTestId('restore-btn'))
          })

          // Advance past the 500ms minimum display time using explicit async timer flush
          await act(async () => {
            await vi.runAllTimersAsync()
          })

          await waitFor(() => {
            expect(screen.getByTestId('restore-success')).toBeInTheDocument()
          })

          // Verify entry count is displayed
          const countEl = screen.getByTestId('restored-count')
          expect(countEl.textContent).toContain(String(entryCount))

          // Verify personalized greeting
          const greetingEl = screen.getByTestId('welcome-greeting')
          expect(greetingEl.textContent).toContain(userName)
          expect(greetingEl.textContent).toContain('Welcome back')

          unmount()
        cleanup()
        }
      ),
      { numRuns: 100 }
    )
  })
})
