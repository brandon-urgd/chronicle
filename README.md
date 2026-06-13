# CHRONICLE

Professional Narrative System — Capture your work. Communicate your impact.

**Version 3.1.0**

## What It Does

Chronicle is a desktop application for program managers that captures daily work, organizes it under programs, goals, and projects, tracks tasks and operational cadence, and generates leadership-ready reports. Built with React 19 + Rust/axum + SQLite (14-table lean schema), packaged as a native desktop app via Tauri. Includes a Python MCP server for AI agent integration.

## Pages

| Page | Purpose |
|------|---------|
| Dashboard | Daily command center — activity pulse, project-grouped tasks, prep notes, work at a glance, recent activity (two-column tiered layout). Upcoming section supports "By Date" and "By Program" view modes. Click task → detail panel slides in from right |
| Portfolio | Program hierarchy — program → goal → project tree with inline editing, compact project rows, bulk task completion, close-out flows, server-side search |
| Timeline | Chronological activity log — date-grouped entries with filtering, search, sort toggle, cadence overlay, visual type borders. Click entry → detail panel slides in from right |
| Distribution | Time allocation — percentage breakdown by program/project over selectable periods (week/month/quarter/custom) with trend comparison |
| Reports | Report generator — Status Update and Modular templates with PDF export, presets, section filtering, and report drafts lifecycle |
| Settings | Profile, review period, program types, tags, data location, backup/restore, database repair |
| Guide | In-app reference — collapsible sections covering workflows, features, and tips; searchable utility nav tab |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Backend | Rust (axum 0.7, tokio, serde) |
| Database | SQLite (rusqlite, r2d2, WAL mode) |
| Desktop | Tauri 1.6 (single binary, embedded HTTP server) |
| PDF Export | @react-pdf/renderer (client-side) |
| Testing | proptest + Rust unit tests, Vitest + fast-check |

## Quick Start (Development)

```bash
# Prerequisites: Rust toolchain (stable), Node.js 18+

# Install Rust (if not already installed)
winget install Rustlang.Rustup
rustup default stable

# Frontend (development server with hot reload)
cd frontend
npm install
npm run dev

# Backend runs embedded in Tauri during development
cd src-tauri
cargo build
cargo tauri dev    # launches app with hot-reload frontend
```

In development, `cargo tauri dev` builds and runs the Tauri app with the embedded axum backend. The backend probes ports 8180–8199 and binds to the first available one, writing the chosen port to a `.port` file in the data directory. The frontend connects via the Vite proxy (default `http://localhost:5180`).

## Desktop Build

Chronicle packages into a native Windows installer (.msi) using Tauri. A single `cargo tauri build` command compiles the Rust backend, bundles the frontend, and produces the installer.

### Prerequisites (one-time)

- Rust toolchain — stable channel (`winget install Rustlang.Rustup && rustup default stable`)
- Node.js 18+ with npm
- MSVC C++ Build Tools (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`)
- Tauri CLI (`cargo install tauri-cli --version "^1"`)

### Build

```powershell
cd Chronicle

# One-command build: compiles Rust backend + bundles frontend + produces .msi
cargo tauri build

# Or via npm script:
npm run tauri build
```

The build process:
1. `npm run build` compiles the React frontend to static HTML/JS/CSS in `frontend/dist/`
2. `cargo build --release` compiles the Rust backend (axum server, database layer, engines)
3. Tauri bundles everything into a single native executable with embedded frontend assets
4. WiX produces the `.msi` installer

### Output

The installer lands at `src-tauri/target/release/bundle/msi/Chronicle_3.1.0_x64_en-US.msi`.

Users double-click the .msi to install. Chronicle appears in the Start Menu. Data is stored in `%APPDATA%/Chronicle/` by default (configurable in Settings).

### How It Works

The Tauri binary contains everything:
- **Rust shell** — window management, lifecycle hooks, native file dialogs
- **Axum HTTP server** — all API routes, runs as an in-process tokio task
- **rusqlite** — bundled SQLite library (no external dependency), 14-table lean schema
- **Embedded frontend** — React app served from compiled-in static assets

On launch:
1. Resolve config → find free port (8180–8199) → write `.port` file
2. Initialize database (WAL mode, FK enforcement, migrations)
3. Spawn axum server as async task
4. Load frontend in webview — ready in under 2 seconds

On close:
1. Auto-backup (POST /api/backup/auto, 5s timeout)
2. Signal shutdown → WAL checkpoint → close DB connections
3. Exit process

### Gotchas for Future Development

A few things that bit us during the v2.5 port — worth knowing if you modify the backend:

- **axum path parameter syntax is version-specific.** We use axum 0.7, which expects `:id` in route definitions (`.route("/api/entries/:id", ...)`). axum 0.8+ uses `{id}`. If you accidentally use the wrong syntax, routes silently 404 — the compiler won't catch it because both are valid strings. Check `cargo test -- --nocapture` with a path-param route hit before shipping.
- **Frontend expects `setup_completed: bool` from `/api/settings/setup-status`** — not just the granular `has_*` flags. If the Welcome screen appears when it shouldn't, check this contract first.
- **Data directory resolution priority:** `CHRONICLE_DATA_DIR` env var → `chronicle_config.json` in AppData → default `%APPDATA%/Chronicle/`. Users upgrading from v2.0.x with a custom data directory need `chronicle_config.json` to point there, or the app creates a fresh empty DB in AppData.
- **Tauri close handler must live long enough for the backup POST to complete.** We use `api.prevent_close()` + async task with a 5-second timeout. Don't drop the state early or backups get cut off.

## Project Structure

```
Chronicle/
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Root component, routing, setup gate
│   │   ├── main.tsx         # Entry point with Tauri fetch patch
│   │   ├── index.css        # Design system (Squid Ink light / Night Flight dark)
│   │   ├── views/           # DashboardView, PortfolioView, TimelineView,
│   │   │                    # ReportsView, SettingsView, GuideView,
│   │   │                    # EntryFormView, SetupWizard, WelcomeScreen
│   │   ├── components/      # CaptureSheet, ActivityPulse, PrepNotes,
│   │   │                    # DetailPanel, ReportReadyCard, ProjectCloseOut,
│   │   │                    # GoalCloseOut, PromoteToGoal, PromoteToProject,
│   │   │                    # ExportPDF, etc.
│   │   ├── hooks/           # useInlineTask, useInlineEntry, useFocusTrap
│   │   ├── styles/          # sharedStyles, inlineEditStyles
│   │   └── utils/           # appState, dateUtils, fiscalYear, smartParse, api
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── src-tauri/
│   ├── src/
│   │   ├── main.rs          # Tauri setup, server spawn, lifecycle hooks
│   │   ├── server.rs        # Axum router, CORS, shared state
│   │   ├── config.rs        # Data dir resolution, port discovery
│   │   ├── error.rs         # AppError → HTTP status mapping
│   │   ├── db/              # Pool, schema, migrations
│   │   ├── routes/          # All API route handlers
│   │   ├── models/          # Serde request/response structs
│   │   └── engines/         # Scheduled engine, export engine
│   ├── Cargo.toml
│   ├── tauri.conf.json      # Bundle config, icon paths (no sidecar)
│   ├── build.rs
│   └── icons/               # App icons (all sizes + .ico + .icns)
├── mcp-server/
│   ├── server.py             # Full read-write MCP tools
│   └── tests/                # Property-based tests (hypothesis)
├── docs/
│   └── VERSION_LOCATIONS.md # Files that must be version-bumped together
└── README.md
```

## Data Storage

| Mode | Location | Config |
|------|----------|--------|
| Development | `%APPDATA%/Chronicle/` | Default |
| Desktop (default) | `%APPDATA%/Chronicle/` | Auto-detected |
| Desktop (custom) | User-chosen folder | Settings → Data Location |
| Override | Any path | `CHRONICLE_DB_PATH` env var |

Data persists across app updates. The installer never touches the data directory.

## Testing

```bash
# Backend (Rust unit tests + proptest property-based tests)
cd src-tauri
cargo test

# Frontend (Vitest + fast-check property-based tests)
cd frontend
npx vitest --run
```

## Prep Notes API

Lightweight text-only notes for 1:1 topics, follow-up reminders, and communication prompts. Notes persist until dismissed.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/notes` | Create a note (body: `{"text": "..."}`) |
| GET | `/api/notes` | List active notes (dismissed_at IS NULL), ordered by created_at DESC |
| GET | `/api/notes/all` | List all notes including dismissed |
| PUT | `/api/notes/{id}` | Update a note's text (body: `{"text": "..."}`) |
| PATCH | `/api/notes/{id}/dismiss` | Soft-delete: sets dismissed_at timestamp |
| DELETE | `/api/notes/{id}` | Permanently delete a note |

Notes are intentionally isolated — no FK to programs, projects, or entries.

## Report Drafts API

Persistent, editable report documents with a lifecycle status: `draft` → `ready` → `sent`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/report-drafts` | Create a draft (body: `{"title": "...", "content": "...", "status": "draft"}`) |
| GET | `/api/report-drafts` | List all drafts, ordered by updated_at DESC |
| GET | `/api/report-drafts/{id}` | Get a single draft |
| PUT | `/api/report-drafts/{id}` | Update title, content, or status |
| DELETE | `/api/report-drafts/{id}` | Permanently delete a draft |

Status must be one of: `draft`, `ready`, `sent`. The Dashboard shows a Report Ready banner when a draft with status `ready` exists on the configured report day (default: Friday).

## Observability / Logging

Chronicle uses the `tracing` crate with file appender for structured logging.

| Setting | Value |
|---------|-------|
| Log path | `%APPDATA%/Chronicle/logs/chronicle.log` |
| Framework | tracing + tracing-appender (Rust) |
| Format | Structured (timestamp, level, target, message) |
| Rotation | File-based rotation via tracing-appender |
| Default level | INFO |
| Override | Set `CHRONICLE_LOG_LEVEL` env var (e.g., `DEBUG`, `WARN`) |

Logged events include: application startup/shutdown, database initialization, schema migrations, API errors (HTTP 500), and backup operations.

## Security

- All API inputs validated via serde deserialization with typed structs
- SQLite parameterized queries throughout (rusqlite `params![]` macro)
- CORS restricted to known origins
- Backend binds to 127.0.0.1 only — not network-accessible
- Auto-backup on close ensures data recovery
- Read-only query endpoint rejects all non-SELECT statements
- No authentication required (single-user desktop app, data is local)

## Changelog

### v3.1.0 — June 2026

**Schema Lean-Out & Design System**

Schema:
- Dropped 9 dead tables: review_sessions, review_notes, lessons_learned, lesson_tags, attachments, links, program_progress_log, stakeholders, project_stakeholders
- Removed 5 columns from entries: impact, work_type, metrics, outcome, is_lesson_learned
- Removed 7 columns from scheduled_items: time_of_day, day_range_start, day_range_end, template_tags, quick_complete, month_of_year, template_work_type
- Migrated impact text into description (concatenated with separator) for affected entries
- Eliminated 'program_update' entry type (migrated to 'project_update')
- Final schema: 14 lean tables

Backend:
- Deleted 5 dead route modules (links, attachments, lessons, reviews, stakeholders)
- Removed all stakeholder, link, and attachment endpoints
- Cleaned API response shapes — no dead fields in JSON output
- POST /api/entries silently ignores unrecognized fields for backward compatibility

Frontend:
- Removed impact, work_type, metrics form fields from entry creation
- Removed stakeholder section from Portfolio project detail
- Removed AttachmentsSection component
- Entry types limited to 6 allowed values: quick_capture, project_update, operational_rhythm, milestone, decision, recognition

UI Polish (Squid Ink Design System):
- Implemented Squid Ink light mode + Warm Charcoal (Night Flight) dark mode
- Design token system: spacing (8px base), elevation hierarchy, border radius, typography scale
- DetailPanel component — slide-in from right (420px desktop, full-width mobile) for entry/task viewing and editing
- Timeline and Dashboard now use DetailPanel for row-click interactions (push layout, not overlay)
- Standardized modal treatment: soft 20% scrim for standard modals, blur reserved for CaptureSheet and discard confirmations

MCP Server:
- Removed work_type, impact, metrics, outcome parameters from create_and_complete_task
- Removed is_lesson_learned, work_type from update_entry allowed fields
- Removed template_work_type from create_task and update_task

### v3.0.0 — May 2026

**Major: Unified Data Model, Time Distribution, Recovery Flow**

Architecture:
- Task/Entry unification — tasks are the only input, entries are the only output. Completing a task is the sole mechanism for creating entries. `POST /api/entries` removed.
- CaptureSheet "Log" mode now creates-and-completes a task in one operation (auto_complete flow)
- v3 migration backfills existing entries with synthetic completed tasks (idempotent, with pre-migration backup)
- Graceful DB recovery — if database init fails, app launches into Recovery Mode with Restore/Fresh/Retry options instead of crashing

New Features:
- Time Distribution page — percentage breakdown of work by program/project over selectable time periods (week/month/quarter/custom) with trend comparison vs previous period
- Dashboard "By Date" / "By Program" toggle for the Upcoming section
- Timeline Delete button — remove entries directly from the edit form with confirmation
- Dashboard section collapse persistence (Upcoming, Work at a Glance, Recent Activity)
- Server-side search for Portfolio (programs, projects, goals endpoints accept `?search=`)
- "Repair Database" option in Settings

MCP Server:
- `create_entry` tool removed
- `create_and_complete_task` tool added (creates task + entry + instance atomically)
- `search_entries`, `create_task`, `update_task`, `list_tasks` unchanged

Bug Fixes:
- Fixed flaky CaptureSheet Property 4 test (test isolation)
- Fixed flaky RestoreFlow Property 1 test (timer race condition)
- Removed dead DailyInsight component and insights field
- Report section filtering now respects toggled-off sections in preview and PDF
- "Rhythm" → "Cadence" label consistency in CaptureSheet UI
- Version strings centralized via `env!("CARGO_PKG_VERSION")` — no more hardcoded drift

### v2.5.1 — May 2026

**Patch: Route Restoration, Bug Fixes, and Quality-of-Life Improvements**

Routes & Backend:
- Restored 9 missing backend routes (skip, data export/import/validate/reset, backup status, bulk instances, per-item instances, regenerate)
- Added route-parity regression test that scans frontend fetch calls and verifies backend matches
- Dashboard endpoint now populates all fields (recent_entries, open_todos, weekly_highlight, gap_dates, program_activity, due_today)
- Added GET /api/diagnostics endpoint (text/plain diagnostic bundle)

Frontend Fixes:
- Fixed overdue count calculation (was using UTC, now uses local calendar days)
- Fixed sticky header (only top header sticks, section headers scroll normally)
- Restored "Upcoming" section on Dashboard (next 7 days of pending instances)
- Fixed description field visibility in "Work at a Glance" section
- Fixed Portfolio stakeholder Add button (route parity — path-style URL)
- Removed dead MiniCalendar and MonthCalendar components

Dirty-State Close Guard:
- Added shared `useDirtyClose` hook and `DiscardConfirmDialog` component
- Wired to all modals and inline panels: CaptureSheet, Dashboard task modal, Timeline entry edit, Portfolio inline task/cadence/entry, PromoteToGoal
- Backdrop click on dirty surface → 400ms shake; Esc/X on dirty → confirm dialog
- Save always bypasses guard; Delete keeps its own confirm

Infrastructure:
- Log rotation: daily rotation with 14-file retention (tracing_appender rolling builder)
- "Copy Diagnostic Info" button in About modal (clipboard API with textarea fallback)
- About modal content rewritten for v2.5 architecture

### v2.5.0 — June 2025

**Rust Backend Rewrite**

Architecture:
- Replaced Python/FastAPI sidecar with native Rust HTTP server (axum 0.7) embedded in the Tauri process
- Eliminated PyInstaller — no more runtime extraction, no separate backend process
- Single-process architecture: Tauri shell + axum server + rusqlite all in one binary
- Sub-second startup (down from 10–30s with PyInstaller)
- Installer size reduced from ~45 MB to ~6 MB

Backend:
- All ~95 API routes ported to Rust with identical JSON contracts
- Database layer: rusqlite + r2d2 connection pool (WAL mode, FK enforcement)
- Scheduled engine: instance generation, auto-complete, all recurrence types
- Export engine: all 9 report templates with identical markdown output
- Structured logging via tracing crate (replaces Python RotatingFileHandler)
- Graceful shutdown: WAL checkpoint + connection cleanup (no process tree killing)

Build:
- Single build command: `cargo tauri build` produces complete .msi
- No Python, pip, or PyInstaller required as build dependencies
- Removed sidecar references from tauri.conf.json

Testing:
- 13 property-based tests (proptest) validating correctness properties
- Entity round-trip, idempotence, date handling, referential integrity
- Replaces Python Hypothesis tests with equivalent Rust proptest coverage

Compatibility:
- Zero frontend changes (aside from one dashboard nav fix) — identical API contract preserved
- Zero data migration — opens existing v2.0 databases directly
- MCP server unchanged — same port discovery via .port file, same direct SQLite access

Bug Fixes:
- Dashboard "Recent Activity" click now navigates to the correct week when entries are from prior weeks (Timeline view auto-switches to "All" range when focusDate is outside the current window)
- Fixed setup-status endpoint returning granular flags instead of `setup_completed` — was causing the Welcome screen to appear for users with existing databases
- Fixed path parameter routing (axum 0.7 uses `:id` syntax, not `{id}`) — all inline actions (complete task, pin entry, toggle accomplishment, edit scheduled item, etc.) now work correctly

### v2.0.0 — May 2026

**UX Overhaul & Backend Enhancements**

Navigation & Layout:
- Renamed "Today" → "Dashboard" and "Work" → "Portfolio" across navigation, source files, and persisted state
- Dashboard rebuilt as two-column tiered layout (60/40 grid) with Activity Pulse, project-grouped tasks, Prep Notes, and Report Ready banner
- Removed MonthCalendar, MiniCalendar, DailyInsight, WeekInReview, and Quick Report from Dashboard
- CaptureSheet replaced with three-mode contextual morph (Log | Task | Rhythm) via segmented control
- Portfolio: compact project rows, consolidated "+ New" dropdown, search, bulk task completion, project/goal close-out flows, promote to goal

New Features:
- Prep Notes — lightweight sticky notes for 1:1 topics and follow-ups (6 API endpoints + MCP tools)
- Report Drafts — persistent report documents with draft → ready → sent lifecycle (5 API endpoints)
- Activity Pulse — inline dashboard metrics (entries this week, tasks completed, time since last entry)
- CaptureSheet 3-Mode — Log | Task | Rhythm segmented control replaces toggle switches
- Cadence Schedule Editing — frequency, day, time editable in inline panel; regenerates instances on save
- Require Acknowledgment — cadences can be marked accountable (won't auto-complete when past due)
- Project Focus in Timeline — "View in Timeline" deep-links with project filter, "All" range, glow animation
- In-app Guide — searchable reference view with collapsible sections (utility nav tab)
- Auto-port detection — backend probes ports 8180–8199, writes `.port` file; Tauri reads it on startup
- Instance vs Cadence editing — Dashboard modal reschedules instances; Portfolio edits cadence definition
- PUT /api/scheduled-items/{id}/instances/{instance_id} — reschedule a single occurrence
- PUT /api/notes/{id} — edit prep note text
- `every_day` recurrence type — all 7 days (distinct from `daily` = weekdays only)
- US Traditional day-of-week (1=Sun, 7=Sat) with auto-migration
- Visibility toggle on task completion — personal/shareable override at complete time
- Click-outside-to-close for inline task/entry panels
- MCP server integration — full read-write and read-only variants for AI agent access
- Observability logging with RotatingFileHandler (5MB rotation, 3 backups, CHRONICLE_LOG_LEVEL override)
- Schema migration with pre-backup and version gate (2 new tables: notes, report_drafts)
- Data export/import includes new tables with backward-compatible import for pre-v2 backups

Timeline:
- "All" time range option, sort order toggle, two-row filter bar with "Clear filters"
- Colored left borders by entry type, cadence instance opacity + "auto-logged" badge
- Scroll-to-top button, deep-link focus fix, shift arrow tooltips

Bug Fixes:
- Fixed entry edit modal focus trap (role="dialog", aria-modal, Escape to close)
- Fixed scheduled item description not saving in useInlineTask
- Fixed Skip/Complete buttons on recurring cadences using wrong due_date
- Fixed biweekly cadence generating instances on wrong day
- Fixed deep-link focus race condition in Timeline
- Added API error feedback for user-initiated mutations
- Work type auto-inferred from project_id (manual selector removed)

### v1.3.2 — April 2026

**Bug Fixes**
- Fixed: cold-boot startup no longer flashes the Welcome/Setup screen when the backend is slow to start; frontend now polls `/api/health` with retries before checking setup status
- Added branded splash screen ("CHRONICLE / Starting up…") that displays while the backend initializes, with status text that updates to "Loading your data…" once connected
- Fixed: Timeline no longer auto-scrolls to an arbitrary position when changing date filters or selecting a time range
- Fixed: closing the app now kills the entire backend process tree on Windows (PyInstaller spawns a child process that was being orphaned, blocking reinstalls)
- Added orphaned backend cleanup on startup — if port 8180 is occupied from a previous crash, the stale process is killed before launching a new backend
- Added graceful backend shutdown — Tauri sends `POST /api/shutdown` before killing the process, allowing uvicorn to flush pending writes and close DB connections cleanly
- Added crash recovery overlay — if the backend dies mid-session, a "Connection lost / Reconnecting…" overlay appears and auto-dismisses when the backend comes back (health check every 5s)

### v1.3.1 — April 2026

**Bug Fixes & Consistency**
- Fixed: completing a task linked to a project now correctly creates a `project_update` entry instead of `action_item` (was only converting `operational_rhythm` and `quick_capture`, now also converts `action_item`)
- Fixed: completing a standalone task (no project) now creates an `operational_rhythm` entry instead of `action_item`
- "Show Completed" toggle on Work page now applies to the full hierarchy: programs (sunset), goals (completed), and projects (completed) — previously only filtered projects
- Code-signed installers with self-signed certificate (Brandon Hill-Rogers); build script auto-signs when cert is present
- Fixed `build.ps1`: Cargo.toml version bump no longer corrupts dependency versions; all file writes use UTF-8 without BOM

### v1.3.0 — April 2026

**Architecture Tightening**

Frontend:
- Created `styles/sharedStyles.ts` — centralized 15+ duplicated style definitions (cards, buttons, inputs, chips, status badges, type icons) across 7 views
- Extended `dateUtils.ts` with 6 date helper functions previously duplicated between TimelineView and ReportsView
- Replaced `Record<string, any>` in WorkView with proper typed interfaces (`ProgramEditData`, `ProjectEditData`, `GoalEditData`)
- Extracted `useInlineEntry` hook — entry detail/edit panel (view, edit, pin, delete, promote to project) now shared, matching the `useInlineTask` pattern
- Extracted `styles/inlineEditStyles.ts` — inline panel, button, and input styles centralized; imported by both hooks and WorkView entity forms
- All views now import shared styles instead of defining local copies

Backend:
- Fixed 3 N+1 query patterns: `get_programs` list (60 queries → 5), `get_stakeholders_summary`, `get_project` entry tags
- Added 9 database indexes on commonly filtered columns (entries, goals, projects, links, attachments)
- Consolidated duplicated link-fetching helpers into a single `_fetch_links()` function
- Added attachment file cleanup on all delete operations (previously orphaned files on disk)
- Fixed `delete_program` status code inconsistency (200 → 204 to match all other deletes)
- Fixed `update_project` missing JOIN in the empty-updates fallback path
- Added `"program"` to `upload_attachment` route validation (DB allowed it, route didn't)

### v1.2.1 — April 2026

**Work Page**
- Completed projects (and their tasks) now hidden by default on the Work page to reduce clutter
- Added "Show Completed" toggle in the Work toolbar — persisted across sessions — so users can still browse completed work organized by scope without digging through Timeline
- Task inline editing on Work now uses the shared `useInlineTask` hook, giving Work page tasks the same panel as Today: Quick Complete, Complete with Details (description, impact, metrics), Skip, Delete, Promote to Project, and Show on Today toggle for recurring items

### v1.1.1 — April 2026

**Bug Fixes**
- Fixed: recurring items now correctly create as cadence (not task) when frequency is Weekly/Biweekly/Monthly/Quarterly
- Fixed: data location change now takes effect immediately without restart (hot-reload)
- Fixed: inline task panel now shows schedule info for cadence items ("Every Wednesday", "Monthly on the 15th", etc.)
- Fixed: inline task panel shows CADENCE/TASK badge to clarify item type
- Fixed: capture toggle relabeled to "Schedule as task or cadence" for clarity
- Fixed: Tauri desktop overlays use theme background instead of dark backdrop

### v1.1.0 — April 2026

**Backup & Onboarding**
- Welcome screen with "Start Fresh" and "Restore Backup" paths on first launch
- Full restore flow: drag-drop file selection → server-side validation → preview with summary stats → import with progress → personalized success screen
- Four-category error handling: invalid JSON, not a Chronicle backup, schema version mismatch, import failure with rollback
- Auto-backup on app close (Tauri close-event hook)
- Daily scheduled backup (24h timer)
- Backup retention policy: keeps 7 most recent, preserves non-auto-backup files
- Backup status indicator in Settings with stale-backup warning
- RestoreFlow reusable from both onboarding and Settings
- Manual export with Tauri native save dialog and `chronicle_backup_YYYYMMDD_HHMMSS.json` naming
- Settings-mode import with "Export Current Data First" option

**Desktop Packaging**
- Tauri shell with embedded backend architecture
- Native window with auto-managed backend lifecycle
- App icons (multi-size PNG, ICO, ICNS)
- One-command build script
- Fetch URL patching for Tauri production mode
- CORS configuration for Tauri origins

**Data Management**
- Configurable data directory (Settings → Data Location)
- AppData auto-detection for packaged mode
- Persistent config via `chronicle_config.json`
- Data copy on location change

**Code Quality**
- 13 property-based tests (proptest for Rust, fast-check for frontend)
- Integration tests for the restore flow
- Dead code cleanup: removed 8 unused components and utilities
- TypeScript strict mode: 0 errors
- Security audit: 0 vulnerabilities

**Bug Fixes**
- Fixed: changing a task's due date now syncs the pending instance, so the task correctly drops off Today's Tasks when moved to another day

### v1.0.0 — March 2026

- Initial release
- Today, Work, Timeline, Reports, Settings views
- Program → Goal → Project hierarchy with SMART goals
- Quick Capture with task toggle and batch mode
- Tasks and cadence with recurring schedules
- Timeline with week/month/quarter navigation and density modes
- Report generation with Status Update and Modular templates
- PDF export with executive styling
- Activity heatmap with program color coding
- Month calendar with entry/cadence dots
- Light/dark mode with WCAG AA compliant design system
- SQLite database with 21 tables
- Full data export/import/reset
- Setup wizard for first-run configuration

## Credits

Created by Brandon Hill-Rogers · ACO, Amazon AIR — Global Aviation Operations
