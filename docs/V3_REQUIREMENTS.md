# Chronicle v3.0 — Requirements Document

**Version:** 3.0.0 (from 2.5.1)  
**Classification:** Major release — breaking data model change + new page + 11 enhancements  
**Author:** Brandon Hill-Rogers  
**Date:** 2026-05-14  

---

## Release Summary

Chronicle 3.0 unifies the Task/Entry data model (the single largest architectural change since v1.0), adds a dedicated Time Distribution page, and resolves 11 quality/feature items that have accumulated since v2.5.

**Breaking changes:**
- `entries` table becomes read-only output (never written to directly)
- MCP `create_entry` tool removed; replaced by `create_and_complete_task`
- MCP `search_entries` remains (queries the read-only output table)

---

## Requirement 1: Task/Entry Unification

**Priority:** Critical (blocks items 2, 9, 10)  
**Type:** Core architecture change  

### 1.1 Design

Task becomes the only input. Entry becomes the only output. Completing a task is the ONLY way to create an entry.

| User Action | What Happens |
|---|---|
| CaptureSheet "Log" mode | Creates a task with no due date → auto-completes immediately → produces entry |
| CaptureSheet "Task" mode | Creates a task with due date (existing behavior) |
| CaptureSheet "Rhythm" mode | Creates a cadence (existing behavior) |
| Complete any task | Prompts for description/impact/metrics → creates entry |
| Quick Complete (no details) | Creates entry with title only |

### 1.2 Acceptance Criteria

- [ ] AC-1.1: The `entries` table is never written to directly by any frontend action or API endpoint (except the completion flow and migration backfill)
- [ ] AC-1.2: CaptureSheet "Log" mode creates a `scheduled_item` (item_class='task', mode='one_time', due_date=NULL) and immediately completes it, producing an entry in the `entries` table
- [ ] AC-1.3: The "Complete with Details" form (description, impact, metrics, visibility) is the entry creation surface — fields map to entry columns
- [ ] AC-1.4: Quick Complete (no details) creates an entry with title only, entry_type inferred from context (project_update if project linked, operational_rhythm otherwise)
- [ ] AC-1.5: All existing `POST /api/entries` direct-creation endpoints are removed or redirected through the task-complete flow
- [ ] AC-1.6: Timeline continues to display entries exactly as before (read from entries table)
- [ ] AC-1.7: Reports continue to query entries table (no change to report generation)

### 1.3 Migration

- [ ] AC-1.8: Existing entries without a `scheduled_item_id` are backfilled with a synthetic completed task (non-breaking, adds rows to `scheduled_items`)
- [ ] AC-1.9: Migration runs automatically on first v3.0 launch, with pre-migration backup
- [ ] AC-1.10: Migration is idempotent — running twice produces no duplicate rows

### 1.4 MCP Changes

- [ ] AC-1.11: `create_entry` tool is removed from the MCP server
- [ ] AC-1.12: New `create_and_complete_task` tool creates a task and immediately completes it (equivalent to old `create_entry` behavior)
- [ ] AC-1.13: `search_entries` tool remains unchanged (queries entries table)
- [ ] AC-1.14: `create_task` tool remains unchanged (creates a pending task)
- [ ] AC-1.15: `update_task` tool remains unchanged
- [ ] AC-1.16: `list_tasks` tool remains unchanged

---

## Requirement 2: Time Distribution Page

**Priority:** High  
**Type:** New page  

### 2.1 Design

A standalone page (new nav item between Timeline and Reports) showing percentage distribution of work across programs and projects over selectable time periods. Pure React + CSS implementation — no new charting dependencies.

See: `docs/TIME_DISTRIBUTION_PREVIEW.md` for visual mockup.

### 2.2 Acceptance Criteria

- [ ] AC-2.1: New "Distribution" nav item appears between Timeline and Reports with a bar-chart icon
- [ ] AC-2.2: Time period selector (segmented control): This Week, This Month, This Quarter, Custom
- [ ] AC-2.3: Custom range shows two date inputs (start/end) using the same pattern as Reports
- [ ] AC-2.4: Stacked horizontal bar at top shows overall program distribution (colored segments)
- [ ] AC-2.5: Program breakdown section shows each program with a horizontal bar, entry count, and percentage
- [ ] AC-2.6: Clicking a program expands to show project-level breakdown (indented sub-bars)
- [ ] AC-2.7: Trend comparison section shows delta vs. equivalent previous period (↑/↓/─ indicators)
- [ ] AC-2.8: Backend endpoint `GET /api/time-distribution` accepts `period`, `start`, `end` query params
- [ ] AC-2.9: Response includes program breakdown with project drill-down and comparison data
- [ ] AC-2.10: Empty state shows "No entries in this period" message
- [ ] AC-2.11: Selected time period persists to localStorage
- [ ] AC-2.12: Data source is entries table (post-unification: completed tasks = entries)

### 2.3 Existing Code Impact

The basic Time Distribution section in PortfolioView (lines 1858–1907) remains as-is — it serves a different purpose (all-time overview within the Portfolio context). The new page is a full-featured standalone with date filtering and drill-down.

---

## Requirement 3: Dashboard Upcoming View Modes

**Priority:** Medium  
**Type:** Frontend enhancement  

### 3.1 Acceptance Criteria

- [ ] AC-3.1: Toggle control in the Upcoming section header: "By Date" | "By Program"
- [ ] AC-3.2: "By Date" renders a flat chronological list: date | task name | project name | Complete/Skip buttons
- [ ] AC-3.3: "By Program" renders the current grouped hierarchy (existing behavior)
- [ ] AC-3.4: Toggle selection persists to localStorage
- [ ] AC-3.5: Default view is "By Program" (preserves current behavior for existing users)
- [ ] AC-3.6: Both views use the same `upcomingTasks` data — no additional API calls

---

## Requirement 4: Graceful DB Recovery Flow

**Priority:** High  
**Type:** New feature (resilience)  

### 4.1 Design

When the backend cannot open or read the database on startup (corruption, locked WAL, missing file, schema mismatch), present a recovery screen instead of crashing. The user can choose to restore from a backup or start fresh.

### 4.2 Acceptance Criteria

- [ ] AC-4.1: If `init_db()` fails, the app launches into a Recovery Mode screen instead of crashing
- [ ] AC-4.2: Recovery screen shows the error message and offers three options: "Restore from Backup", "Start Fresh", "Try Again"
- [ ] AC-4.3: "Restore from Backup" opens the existing RestoreFlow component
- [ ] AC-4.4: "Start Fresh" creates a new empty database (renames the corrupted file to `.corrupt.bak`)
- [ ] AC-4.5: "Try Again" re-attempts database initialization (handles transient WAL locks)
- [ ] AC-4.6: If backups exist in the data directory, the Recovery screen shows the most recent backup date
- [ ] AC-4.7: Recovery mode is accessible from Settings as well (manual trigger for "Repair Database")

---

## Requirement 5: File Attachments Fix

**Priority:** Medium  
**Type:** Bug fix  

### 5.1 Acceptance Criteria

- [ ] AC-5.1: `POST /api/attachments` accepts `multipart/form-data` (file upload)
- [ ] AC-5.2: Backend reads file bytes from the multipart body and saves to `{data_dir}/attachments/{uuid}_{original_name}`
- [ ] AC-5.3: Metadata row is created in the `attachments` table with correct filename, original_name, file_size, mime_type
- [ ] AC-5.4: `GET /api/attachments/:id/download` returns the file bytes with correct Content-Type header
- [ ] AC-5.5: `DELETE /api/attachments/:id` removes both the metadata row AND the file from disk
- [ ] AC-5.6: Frontend file upload (drag-drop or file picker) works end-to-end without errors
- [ ] AC-5.7: Maximum file size: 10 MB (returns 413 if exceeded)

---

## Requirement 6: Timeline Delete Button

**Priority:** Low  
**Type:** UI enhancement  

### 6.1 Acceptance Criteria

- [ ] AC-6.1: Delete button appears in the entry edit form (`EntryFormView.tsx`) — styled as danger/destructive
- [ ] AC-6.2: Clicking Delete shows a confirmation dialog ("Delete this entry? This cannot be undone.")
- [ ] AC-6.3: Confirming calls `DELETE /api/entries/:id` (endpoint already exists)
- [ ] AC-6.4: On success, the entry disappears from Timeline and the edit form closes
- [ ] AC-6.5: Delete button is positioned at the bottom of the form, visually separated from Save/Cancel

---

## Requirement 7: Insights Engine — Remove Dead Code

**Priority:** Low  
**Type:** Cleanup  

### 7.1 Rationale

The `DailyInsight.tsx` component exists but is never imported or rendered. The backend returns `insights: vec![]`. Rather than building a feature with unclear value, remove the dead code to reduce maintenance surface. If insights become a priority later, they can be designed fresh with real requirements.

### 7.2 Acceptance Criteria

- [ ] AC-7.1: `DailyInsight.tsx` component is deleted
- [ ] AC-7.2: `InsightCandidate` interface is removed from `DashboardView.tsx`
- [ ] AC-7.3: `insights` field is removed from the `DashboardData` interface
- [ ] AC-7.4: Backend `insights: vec![]` is removed from the dashboard response struct
- [ ] AC-7.5: No runtime behavior changes (the field was always empty)

---

## Requirement 8: Report Section Filtering

**Priority:** Medium  
**Type:** Bug fix  

### 8.1 Acceptance Criteria

- [ ] AC-8.1: When sections are toggled off in the modular report config, the preview does NOT show those sections
- [ ] AC-8.2: The `sections` config is passed into `smartParse` (or applied as a post-filter)
- [ ] AC-8.3: PDF export also respects section filtering (disabled sections excluded from PDF)
- [ ] AC-8.4: Section toggle state persists within the report preset

---

## Requirement 9: Export Structured Data from Backend

**Priority:** Medium  
**Type:** Enhancement  

### 9.1 Acceptance Criteria

- [ ] AC-9.1: `POST /api/export/report` response includes both `markdown` (string) and `structured` (JSON object matching ParsedExport shape)
- [ ] AC-9.2: Frontend can use the `structured` field directly for rich preview rendering instead of running `smartParse` client-side
- [ ] AC-9.3: `structured` field is optional — if null/absent, frontend falls back to client-side parsing (backward compatibility)
- [ ] AC-9.4: The backend's structured output matches the client-side `smartParse` output for the same inputs

---

## Requirement 10: MCP Instance Sync for Cadences

**Priority:** Medium  
**Type:** Bug fix  

### 10.1 Acceptance Criteria

- [ ] AC-10.1: After creating a recurring cadence via MCP, pending instances are generated immediately
- [ ] AC-10.2: Implementation calls the existing `generate_pending_instances_for_item` logic (or hits the `/regenerate` endpoint internally)
- [ ] AC-10.3: One-time tasks with a due_date already create an instance (existing behavior, no change needed)
- [ ] AC-10.4: The MCP `create_task` tool documentation notes that cadence creation is not supported via this tool (cadences require recurrence parameters not exposed here)

---

## Requirement 11: Collapsible Section State Persistence

**Priority:** Low  
**Type:** UI enhancement  

### 11.1 Acceptance Criteria

- [ ] AC-11.1: Dashboard section collapse states (Upcoming, Work at a Glance, Recent Activity) persist to localStorage
- [ ] AC-11.2: Uses the existing `appState` utility pattern (same as Portfolio's `showCompleted` and Time Distribution collapse)
- [ ] AC-11.3: Default state on first load: all sections expanded
- [ ] AC-11.4: Persisted state survives page refresh and app restart

---

## Requirement 12: Portfolio Search — Server-Side

**Priority:** Low  
**Type:** Enhancement  

### 12.1 Acceptance Criteria

- [ ] AC-12.1: `GET /api/programs`, `GET /api/projects`, `GET /api/goals` accept an optional `?search=` query parameter
- [ ] AC-12.2: Search is case-insensitive substring match on name/title and description fields
- [ ] AC-12.3: Frontend Portfolio search input debounces (300ms) and calls the server-side search
- [ ] AC-12.4: Fallback: if the server returns all results (no search param), client-side filtering still works (graceful degradation)
- [ ] AC-12.5: Timeline search remains server-side (already implemented, no change)

---

## Requirement 13: Test Stability

**Priority:** High  
**Type:** Quality  

### 13.1 Acceptance Criteria

- [ ] AC-13.1: CaptureSheet Property 4 test passes reliably across 100 consecutive runs (fix test-isolation issue)
- [ ] AC-13.2: RestoreFlow Property 1 test passes reliably (fix seed-specific failure — likely timing/async issue with fake timers)
- [ ] AC-13.3: All frontend tests pass with `npx vitest --run` (zero skipped, zero flaky)
- [ ] AC-13.4: All backend tests pass with `cargo test` (zero skipped, zero flaky)
- [ ] AC-13.5: Route parity test (`tests/route_parity.rs`) passes with any new/removed routes accounted for
- [ ] AC-13.6: Property-based tests run with sufficient iterations (≥100 for frontend, ≥100 for backend)

---

## Requirement 14: Documentation & Housekeeping

**Priority:** Required (every release)  
**Type:** Maintenance  

### 14.1 Acceptance Criteria

- [ ] AC-14.1: `ARCHITECTURE.md` updated to reflect v3.0 changes (Task/Entry unification, new Time Distribution page, removed insights, new recovery flow)
- [ ] AC-14.2: `README.md` version bumped to 3.0.0, changelog section added, page table updated
- [ ] AC-14.3: `AboutModal.tsx` displays correct version (3.0.0)
- [ ] AC-14.4: `constants.ts` APP_VERSION updated to '3.0.0'
- [ ] AC-14.5: `tauri.conf.json` version updated to '3.0.0'
- [ ] AC-14.6: `Cargo.toml` version updated to '3.0.0'
- [ ] AC-14.7: `package.json` version updated to '3.0.0'
- [ ] AC-14.8: Architecture diagram updated to show unified Task→Entry flow
- [ ] AC-14.9: MCP server README updated to reflect removed/added tools

---

## Implementation Order (Dependency-Driven)

```
Phase 1 — Foundation (must be first)
├── Req 13: Test Stability (fix before making changes)
├── Req 1: Task/Entry Unification (core model change)
└── Req 7: Remove Insights Dead Code (cleanup before new features)

Phase 2 — Features (depend on Phase 1)
├── Req 2: Time Distribution Page (depends on unified entry model)
├── Req 3: Dashboard View Modes (independent)
├── Req 4: Graceful DB Recovery (independent)
└── Req 5: File Attachments Fix (independent)

Phase 3 — Polish (depend on Phase 2)
├── Req 6: Timeline Delete Button
├── Req 8: Report Section Filtering
├── Req 9: Export Structured Data
├── Req 10: MCP Instance Sync
├── Req 11: Collapsible Section Persistence
└── Req 12: Portfolio Search Server-Side

Phase 4 — Ship
└── Req 14: Documentation & Housekeeping (always last)
```

---

## Out of Scope for v3.0

- Time tracking in minutes/hours (Time Distribution counts entries, not duration)
- Multi-user / authentication
- Cloud sync
- Mobile app
- Insights engine (removed; may revisit in v4 with real requirements)
