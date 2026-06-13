# Chronicle — System Architecture (v3.1.0)

## Overview

Chronicle is a full-stack desktop application built with a three-layer architecture: a React frontend rendered in a native Tauri window, a Rust/axum HTTP server embedded directly in the Tauri process, and a SQLite database stored in the user's AppData directory. The Tauri Rust shell manages the application lifecycle, auto-backups, and native OS integrations. An MCP (Model Context Protocol) server provides AI agent integration.

**Key change in v3.1:** Schema lean-out — 9 dead tables dropped, 5 unused entry columns removed (impact preserved by prepending to description), 7 unused scheduled_items columns removed. Backend routes, frontend UI surfaces, and MCP parameters trimmed to match the lean 14-table schema. UI polish pass adds Squid Ink + Aviation design tokens and a slide-in DetailPanel for entry/task triage. No new features added beyond the design system.

**Key change in v3.0:** The data model is unified — tasks are the only input, entries are the only output. Completing a task (via the Dashboard, CaptureSheet, or MCP) is the sole mechanism for creating entries. The `entries` table is read-only output; `POST /api/entries` has been removed. A new Time Distribution page visualizes work allocation across programs. A graceful DB recovery flow replaces silent crashes on database errors.

**Key change in v2.5:** The Python/FastAPI sidecar has been replaced with an in-process axum HTTP server. There is no separate backend process — the HTTP server runs as an async tokio task within the same Tauri binary. This eliminates the 10–30 second PyInstaller extraction penalty, achieving sub-second startup.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CHRONICLE.EXE (Single Tauri Process)                  │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Window Manager   │  │ Axum HTTP Server │  │ Native Integrations   │  │
│  │                  │  │ (in-process)     │  │                       │  │
│  │ • Create window  │  │                  │  │ • File open dialog    │  │
│  │ • Load frontend  │  │ • ~70 API routes │  │ • File save dialog    │  │
│  │ • Close handler  │  │ • CORS layer     │  │ • Auto-backup on      │  │
│  │                  │  │ • JSON responses │  │   close (5s timeout)  │  │
│  │                  │  │ • Shared state   │  │ • Daily backup timer  │  │
│  │                  │  │   (DB pool)      │  │                       │  │
│  └─────────────────┘  └──────────────────┘  └───────────────────────┘  │
│                                                                         │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │ Database Pool    │  │ Scheduled Engine │  │ Export Engine          │  │
│  │ (r2d2+rusqlite) │  │                  │  │                       │  │
│  │                  │  │ • Instance gen   │  │ • Report templates    │  │
│  │ • WAL mode      │  │ • Auto-complete  │  │ • Markdown rendering  │  │
│  │ • FK enforcement │  │ • Recurrence     │  │ • Program resolution  │  │
│  │ • 4 connections │  │   computation    │  │                       │  │
│  └─────────────────┘  └──────────────────┘  └───────────────────────┘  │
│                                                                         │
│  Serves: frontend/dist/ (static)    Binds: http://127.0.0.1:{PORT}     │
│  Protocol: tauri://localhost         (auto-detected 8180-8199)          │
└──────────────────────┬──────────────────────────────────────────────────┘
                       │
              loads static files + HTTP API
                       │
                       ▼
┌──────────────────────────────────────────────┐  ┌───────────────────────────────────┐
│     FRONTEND (React 19 + TS)                 │  │    MCP SERVER (Python)            │
│     Vite-built static bundle                 │  │    Reads chronicle.db directly    │
│                                              │  │    via rusqlite-compatible SQLite  │
│  fetch('/api/...')                            │  │                                   │
│  ────────────────────────────────────────►   │  │  (no HTTP dependency on backend)  │
└──────────────────────────────────────────────┘  └───────────────────────────────────┘
                 │                                   │
                 │ HTTP JSON on :PORT                │ direct sqlite3 access
                 ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    DATA LAYER (%APPDATA%/Chronicle/)                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  chronicle.db (SQLite, WAL mode) — 14 tables                    │    │
│  │                                                                 │    │
│  │  Core Entities          Relationships        System             │    │
│  │  ─────────────          ─────────────        ──────             │    │
│  │  programs               entry_tags           settings           │    │
│  │  goals                                       report_presets     │    │
│  │  projects               Progress Logs        notes              │    │
│  │  entries                ──────────────        report_drafts     │    │
│  │  scheduled_items        goal_progress_log    tags               │    │
│  │  scheduled_item_instances                                       │    │
│  │                         project_progress_log                    │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────────────────┐                    │
│  │  backups/    │  │  exports/                    │                    │
│  │              │  │                              │                    │
│  │ Auto-backups │  │ Manual export files          │                    │
│  │ (7-day       │  │ chronicle_backup_            │                    │
│  │  retention)  │  │   YYYYMMDD_HHMMSS.json      │                    │
│  └──────────────┘  └──────────────────────────────┘                    │
│                                                                         │
│  ┌──────────────┐  ┌──────────────────────────────────────────────┐    │
│  │ logs/         │  │ chronicle_config.json                        │    │
│  │ chronicle.log │  │ ← persistent user preferences (data loc)    │    │
│  └──────────────┘  └──────────────────────────────────────────────┘    │
│                                                                         │
│  .port  ← written on startup, read by MCP server for port discovery    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### Application Startup (v2.5)

```
┌──────────┐                                    ┌──────────────┐
│  Tauri   │  1. Find free port (8180-8199)     │   SQLite DB  │
│  Shell   │  2. Write .port file               │              │
│  (main)  │  3. init_db() ─────────────────────►  WAL mode    │
│          │     (create tables, migrations)    │  FK enabled  │
│          │  4. Spawn axum task ──────┐        └──────────────┘
│          │  5. Load frontend/dist/   │
└──────────┘                           │
     │                                 ▼
     │ load webview              ┌──────────────┐
     ▼                           │ Axum Server  │
┌──────────┐                     │ (tokio task) │
│ Frontend │  GET /api/health    │              │
│ (React)  │ ───────────────────►│ Listening    │
│          │ ◄─── {"status":"ok"}│ on :PORT     │
│          │                     └──────────────┘
│          │  (ready in <2s)
└──────────┘
```

**Startup sequence:**
1. Tauri `setup()` runs — resolves config, finds free port, writes `.port` file
2. Database pool initialized — WAL mode, FK enforcement, schema creation, migrations
3. Axum HTTP server spawned as a tokio task (binds `127.0.0.1:{port}`)
4. Frontend loaded in webview — polls `GET /api/health` every 400ms
5. Backend responds immediately (already listening) — app is ready

**Total startup time:** Sub-second (native binary, no interpreter extraction, no process spawning)

### Application Shutdown (v2.5)

```
┌──────────┐     close event     ┌──────────────┐     backup      ┌──────────┐
│  User    │ ──────────────────► │  Tauri Shell │ ──────────────► │  Axum    │
│          │                     │              │                  │  Server  │
└──────────┘                     │  1. Trigger  │ ◄── 200 OK ──── │          │
                                 │     auto-    │                  │          │
                                 │     backup   │  2. Signal       │          │
                                 │              │     shutdown ──► │          │
                                 │              │                  │ WAL ckpt │
                                 │  3. Close    │ ◄── done ─────── │ Close DB │
                                 │     window   │                  │          │
                                 │  4. Exit     │                  │          │
                                 └──────────────┘                  └──────────┘
```

**Shutdown sequence:**
1. `POST /api/backup/auto` — create timestamped backup (5s timeout, best-effort)
2. Signal shutdown via tokio CancellationToken
3. Axum server runs `PRAGMA wal_checkpoint(TRUNCATE)`, closes all DB connections
4. Tauri closes the window and exits the process

**No orphan cleanup needed** — there is no separate process to kill.

### First-Run Onboarding

```
                    ┌─────────────────┐
                    │  WelcomeScreen  │
                    │                 │
                    │ ┌─────┐ ┌─────┐│
                    │ │Start│ │Rest-││
                    │ │Fresh│ │ore  ││
                    │ └──┬──┘ └──┬──┘│
                    └────┼───────┼───┘
                         │       │
              ┌──────────┘       └──────────┐
              ▼                              ▼
      ┌──────────────┐              ┌──────────────┐
      │ SetupWizard  │              │ RestoreFlow  │
      │              │              │              │
      │ Name, role,  │              │ file-select  │
      │ programs,    │              │   ▼          │
      │ scheduled    │              │ validating   │
      │ items        │              │   ▼          │
      └──────┬───────┘              │ preview      │
             │                      │   ▼          │
             │                      │ importing    │
             │                      │   ▼          │
             │                      │ success      │
             │                      └──────┬───────┘
             │                             │
             └──────────┬──────────────────┘
                        ▼
              ┌──────────────────┐
              │   Main App       │
              │  (Dashboard)     │
              └──────────────────┘
```

### Backup Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                     BACKUP TRIGGERS                              │
│                                                                  │
│  1. App Close          2. Daily Timer         3. Manual Export   │
│     (Tauri event)         (24h interval)         (Settings UI)  │
│         │                     │                       │          │
│         ▼                     ▼                       ▼          │
│  POST /api/backup/auto  POST /api/backup/auto  POST /api/export │
│         │                     │                       │          │
│         ▼                     ▼                       ▼          │
│  chronicle_auto_        chronicle_auto_        chronicle_backup_ │
│  YYYYMMDD.json          YYYYMMDD.json          YYYYMMDD_HHMMSS  │
│  (overwrite same day)   (overwrite same day)   .json (unique)   │
│         │                     │                                  │
│         └─────────┬───────────┘                                  │
│                   ▼                                              │
│         Retention cleanup                                        │
│         Keep 7 most recent                                       │
│         Preserve non-auto files                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Entity Relationship Diagram

```
programs ─────────────┐
  │                   │
  │ 1:N               │ 1:N
  ▼                   ▼
goals              scheduled_items ──────── scheduled_item_instances
  │                   │                         (due_date, status)
  │ 1:N              │ N:1                         │
  ▼                   │                            │ entry_id (on complete)
projects ◄────────────┘                            │
  │                                                ▼
  │ 1:N                    entries (READ-ONLY OUTPUT — v3.0)
  │                          │
  │                          └── entry_tags ──── tags
  │
  ├── project_progress_log
  │
  └──────────────────────────── (entries.project_id → projects.id)

v3.0 Unified Flow:
  scheduled_items ──[Task_Completion_Flow]──► entries
  (task is the ONLY input)                   (entry is the ONLY output)

goals ── goal_progress_log

settings (key-value store)
report_presets
report_drafts
notes
```

## Database Schema Summary

| Table | Category | Purpose |
|-------|----------|---------|
| programs | Core | Organizational units (Primary, Strategic, Operational, etc.) |
| goals | Core | SMART goals with fiscal year/quarter tracking |
| projects | Core | Work items under goals with status lifecycle |
| entries | Core | Daily work records (quick capture, project updates, etc.) — 15 columns |
| scheduled_items | Core | Tasks (one-time) and cadence (recurring) items — 19 columns |
| scheduled_item_instances | Core | Generated due-date instances for scheduled items |
| tags | Core | User-defined labels |
| notes | Core | Prep notes for 1:1 topics and follow-ups |
| report_drafts | Core | Persistent report documents with lifecycle status |
| entry_tags | Junction | M:N entries ↔ tags |
| goal_progress_log | Log | Timestamped progress notes on goals |
| project_progress_log | Log | Timestamped progress notes on projects |
| settings | Config | Key-value application settings |
| report_presets | Config | Saved report configurations |

**Total: 14 tables**

### entries (15 columns)

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| entry_date | TEXT | ISO date |
| entry_type | TEXT | CHECK: quick_capture, project_update, operational_rhythm, milestone, decision, recognition |
| title | TEXT | Required |
| description | TEXT | Main content body |
| project_id | INTEGER | FK → projects.id |
| program_id | INTEGER | FK → programs.id |
| status | TEXT | completed, in_progress, ongoing, paused |
| visibility | TEXT | personal, shareable |
| is_accomplishment | INTEGER | 0/1 flag |
| is_weekly_highlight | INTEGER | 0/1 flag |
| is_pinned | INTEGER | 0/1 flag |
| scheduled_item_id | INTEGER | FK → scheduled_items.id |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### scheduled_items (19 columns)

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Required |
| description | TEXT | Content body |
| mode | TEXT | task or cadence |
| due_date | TEXT | ISO date |
| recurrence_type | TEXT | daily, weekly, biweekly, monthly, etc. |
| day_of_week | INTEGER | 0-6 for recurring |
| day_of_month | INTEGER | 1-31 for monthly |
| program_id | INTEGER | FK → programs.id |
| project_id | INTEGER | FK → projects.id |
| template_entry_type | TEXT | Default entry_type on completion |
| template_visibility | TEXT | Default visibility on completion |
| status | TEXT | active, completed, paused, archived |
| sort_order | INTEGER | Display ordering |
| item_class | TEXT | task or cadence |
| show_on_today | INTEGER | 0/1 flag |
| require_acknowledgment | INTEGER | 0/1 flag |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

## Packaging Architecture (v2.5)

```
┌─────────────────────────────────────────────────────────────┐
│                    Chronicle.msi (Installer)                 │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Chronicle.exe (~8–12 MB)                              │  │
│  │                                                        │  │
│  │  Single native binary containing:                      │  │
│  │  • Tauri shell (window management, lifecycle)          │  │
│  │  • Axum HTTP server (all ~70 API routes)               │  │
│  │  • rusqlite (bundled SQLite)                           │  │
│  │  • Scheduled engine + Export engine                    │  │
│  │  • Embedded frontend/dist/ (HTML/JS/CSS)               │  │
│  │                                                        │  │
│  │  NO sidecar. NO Python. NO PyInstaller.                │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Icons: icon.ico, icon.icns, 32x32, 128x128, 256x256  │  │
│  └────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

Actual installer size: 5.87 MB MSI / 4.21 MB NSIS EXE

User data (NOT in installer):
  %APPDATA%/Chronicle/
  ├── chronicle.db
  ├── chronicle_config.json
  ├── .port
  ├── backups/
  ├── exports/
  └── logs/
      └── chronicle.log
```

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Frontend framework | React 19 | Mature ecosystem, TypeScript support, component model |
| Backend framework | axum 0.7 | Tokio-native (same runtime as Tauri), tower middleware ecosystem, ergonomic extractors |
| Database | SQLite (rusqlite + r2d2) | Zero-config, single-file, portable, sufficient for single-user desktop app; connection pooling for concurrent requests |
| Desktop shell | Tauri 1.6 | Small binary size, native performance, Rust security, embeds HTTP server directly |
| Async runtime | tokio | Already required by Tauri; axum is built on it |
| Serialization | serde + serde_json | De facto Rust standard, derive macros for zero-boilerplate JSON |
| Date/time | chrono 0.4 | Mature, handles local timezone, ISO 8601 formatting |
| Error handling | thiserror + anyhow | Typed errors for API layer, anyhow for internal propagation |
| Logging | tracing + tracing-appender | Structured logging, file rotation, compatible with tokio |
| PDF generation | @react-pdf/renderer | Client-side, no server dependency, React component model |
| Property testing | proptest (Rust) + fast-check (TS) | Formal correctness properties, catches edge cases example tests miss |
| Styling | CSS variables + design tokens (Squid Ink) | Theme-able (light/dark), 8px-base spacing, elevation hierarchy |

## Security Model

- All user input validated through serde deserialization before reaching the database
- SQL queries use parameterized statements (rusqlite `params![]` macro — no string interpolation)
- CORS restricted to known origins (localhost dev, Tauri production protocols)
- Backend binds to 127.0.0.1 only — not accessible from the network
- Auto-backup ensures data recovery from crashes or corruption
- Database migrations include pre-migration backup
- No authentication required (single-user desktop app, data is local)
- Read-only query endpoint (`/api/query`) rejects all non-SELECT statements

## Backend Module Structure (v3.1)

```
src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── build.rs
└── src/
    ├── main.rs              # Tauri setup, window management, server spawn
    ├── server.rs            # Axum app builder, router composition, CORS
    ├── config.rs            # Data dir resolution, port discovery, .port file
    ├── error.rs             # AppError type, Into<axum::Response>
    ├── db/
    │   ├── mod.rs           # Pool creation, init_db(), connection config
    │   ├── schema.rs        # CREATE TABLE statements, indexes
    │   └── migrations.rs    # Version-gated schema migrations (incl. v3.1)
    ├── routes/
    │   ├── mod.rs           # Router composition (all sub-routers merged)
    │   ├── entries.rs       # CRUD for entries (~10 routes)
    │   ├── programs.rs      # CRUD for programs (~8 routes)
    │   ├── goals.rs         # CRUD for goals + progress log (~8 routes)
    │   ├── projects.rs      # CRUD for projects + progress log (~8 routes)
    │   ├── scheduled.rs     # Scheduled items + instances (~12 routes)
    │   ├── tags.rs          # CRUD for tags (~5 routes)
    │   ├── settings.rs      # Settings + setup status (~5 routes)
    │   ├── export.rs        # Export/report generation (~3 routes)
    │   ├── backup.rs        # Backup/restore/import (~6 routes)
    │   ├── reports.rs       # Report presets + drafts (~8 routes)
    │   ├── notes.rs         # Prep notes CRUD (~5 routes)
    │   ├── dashboard.rs     # Dashboard aggregate + heatmap (~3 routes)
    │   ├── data.rs          # Time distribution (~2 routes)
    │   └── system.rs        # health, version, shutdown, query (~4 routes)
    ├── models/
    │   ├── mod.rs           # Re-exports
    │   ├── entry.rs         # Entry structs (Create, Update, Response)
    │   ├── program.rs       # Program structs
    │   ├── goal.rs          # Goal structs
    │   ├── project.rs       # Project structs
    │   ├── scheduled.rs     # ScheduledItem + Instance structs
    │   ├── export.rs        # ExportRequest, ExportResponse
    │   ├── settings.rs      # Settings structs
    │   └── common.rs        # Shared types (pagination, error response)
    └── engines/
        ├── mod.rs
        ├── scheduled.rs     # Instance generation, auto-complete, recurrence
        └── export.rs        # Report template rendering, program resolution
```

**Route modules (14):** entries, scheduled, goals, projects, programs, dashboard, notes, reports, export, backup, data, tags, system, settings

## View Architecture Notes

### Dashboard — Date-Organized Command Center

The Dashboard view organizes work by temporal relevance: due today, overdue, upcoming (7 days), and work at a glance. It uses a two-column tiered layout (60/40 grid) with Activity Pulse, project-grouped tasks, Prep Notes, and Report Ready banner. The Upcoming section supports "By Date" (flat chronological) and "By Program" (grouped hierarchy) view modes with localStorage persistence. Clicking a task opens the DetailPanel for triage.

### Portfolio — Scope-Organized Hierarchy

The Portfolio view organizes all work by scope (program → goal → project) rather than by date. Supports inline editing of tasks, entries, and cadence definitions. Completed projects hidden by default with "Show Completed" toggle. Server-side search via `?search=` parameter on programs/projects/goals endpoints.

### Timeline — Chronological Activity Log

The Timeline view is a date-grouped, filterable log of all entries. Supports deep-linking from Portfolio via "View in Timeline" with project filter and "All" time range. Clicking an entry row opens the DetailPanel (slide-in from right) showing full entry detail. Entry edit form includes a Delete button with confirmation dialog.

### Distribution — Time Allocation Visualization (v3.0)

The Distribution view shows percentage breakdown of work across programs and projects over selectable time periods (week, month, quarter, custom). Features a stacked horizontal bar, expandable program→project drill-down, and trend comparison against the equivalent previous period. Pure React + CSS rendering (no charting library). Backend endpoint: `GET /api/time-distribution`.

### Reports — Report Generator

Status Update and Modular templates with PDF export, presets, and report drafts lifecycle (draft → ready → sent). Section filtering respects toggled-off sections in both preview and PDF.

### Settings — Configuration

Profile, review period, program types, tags, data location, backup/restore, database repair.

### Guide — In-app Reference

Searchable reference view with collapsible sections covering workflows, features, and tips.

## Shared Style Architecture

| File | Scope | Used By |
|------|-------|---------|
| `index.css` | Design tokens: Squid Ink palette, spacing (8px base), elevation, radius, typography | All components via CSS variables |
| `styles/sharedStyles.ts` | View-level styles: cards, sections, form inputs, buttons, chips, pills, status badges, type icons, headings | All views |
| `styles/inlineEditStyles.ts` | Inline panel styles: panel container, compact buttons, compact inputs | useInlineTask, useInlineEntry, entity forms |

## Database Performance

Four indexes cover the most common query patterns:

| Index | Table | Columns | Benefits |
|-------|-------|---------|----------|
| `idx_entries_date` | entries | entry_date | Timeline filtering, dashboard date ranges |
| `idx_entries_program` | entries | program_id | Program-scoped entry queries |
| `idx_entries_project` | entries | project_id | Project detail entry lists |
| `idx_entries_type` | entries | entry_type | Type-filtered timeline queries |

Additional indexes on goals, projects, and scheduled_items support Portfolio and Dashboard queries.

## MCP Server Integration

The MCP server is a Python process that reads the SQLite database **directly** via the `sqlite3` module. It does NOT use the HTTP API — it opens `chronicle.db` as a separate reader (SQLite's WAL mode supports concurrent readers with the Rust backend writer).

1. Path resolution priority: `CHRONICLE_DB_PATH` env var → `--db-path` CLI arg → auto-discovered candidates (`Chronicle Data/`, `%APPDATA%/Chronicle/`)
2. MCP server connects with `PRAGMA foreign_keys = ON` for consistency
3. Schema-resilient: reads table structure from `sqlite_master` at startup and validates inputs against actual CHECK constraints
4. Two variants:
   - `server.py` — full read-write access for AI agents (primary, used by Kiro)
   - `chronicle_readonly_mcp.py` — read-only variant for safer exploration

**v3.0 MCP changes:**
- `create_entry` tool removed — entries are no longer created directly
- `create_and_complete_task` tool added — creates a task and immediately completes it, producing an entry (unified flow)
- The MCP server writes to both `scheduled_items` and `entries` tables in a single transaction

**v3.1 MCP changes:**
- Removed parameters from `create_and_complete_task`: work_type, impact, metrics, outcome
- Removed parameters from `update_entry`: work_type, impact, metrics, outcome, is_lesson_learned
- Removed parameter from `create_task` / `update_task`: template_work_type
- Response objects from `search_entries` no longer contain removed fields
- `chronicle_mcp.py` legacy variant removed

### MCP Tools (27 total)

| Tool | Purpose |
|------|---------|
| `create_and_complete_task` | Create task + immediately complete → entry |
| `search_entries` | Query entries with filters |
| `update_entry` | Modify entry fields |
| `delete_entry` | Remove an entry |
| `create_task` | Create a scheduled item (task) |
| `update_task` | Modify scheduled item fields |
| `list_tasks` | List active scheduled items |
| `list_projects` | List all projects |
| `get_project` | Get project detail |
| `create_project` | Create a project |
| `update_project` | Modify project fields |
| `list_goals` | List all goals |
| `get_goal` | Get goal detail |
| `create_goal` | Create a goal |
| `update_goal` | Modify goal fields |
| `add_goal_progress` | Add goal progress log entry |
| `add_project_progress` | Add project progress log entry |
| `delete_progress_log` | Remove a progress log entry |
| `create_note` | Create a prep note |
| `list_notes` | List active prep notes |
| `dismiss_note` | Dismiss a prep note |
| `create_report_draft` | Create a report draft |
| `list_report_drafts` | List all report drafts |
| `update_report_draft` | Modify report draft |
| `delete_report_draft` | Remove a report draft |
| `list_programs` | List all programs |
| `query` | Execute read-only SQL SELECT |

**Why direct SQLite instead of HTTP?** It survives the backend rewrite transparently (v2.0 Python → v2.5 Rust → v3.0 unified model → v3.1 lean) and sidesteps port-discovery complexity. The backend's write lock on the WAL is compatible with readers on the same database.

## Migration from v3.0 to v3.1

| Aspect | v3.0 | v3.1 |
|--------|------|------|
| Tables | 23 | 14 (9 dropped) |
| entries columns | 20 | 15 (5 removed: impact, work_type, metrics, outcome, is_lesson_learned) |
| scheduled_items columns | 26 | 19 (7 removed: time_of_day, day_range_start, day_range_end, template_tags, quick_complete, month_of_year, template_work_type) |
| Backend route modules | 19 | 14 (5 removed: links, attachments, lessons, reviews, stakeholders) |
| API route count | ~95 | ~70 |
| MCP tools | 28 | 27 |
| entry_type values | 8 | 6 (removed: development, action_item; program_update → project_update) |
| Design system | CSS variables (ad-hoc) | Squid Ink + Aviation tokens (8px-base, elevation, radius, typography) |
| Entry/task detail UX | Modal-based editing | DetailPanel (slide-in from right, inline edit) |

### Dropped tables (9)

- `review_sessions` — zero usage in 2+ months
- `review_notes` — child of review_sessions
- `lessons_learned` — superseded by entry-based capture
- `lesson_tags` — junction for lessons_learned
- `attachments` — never used in production
- `links` — never used in production
- `program_progress_log` — confused with project_progress_log, zero usage
- `stakeholders` — never used in production
- `project_stakeholders` — junction for stakeholders

### Migration procedure

The migration is a single transaction-wrapped SQL script that:
1. Prepends non-empty `impact` values to `description` (preserving narrative)
2. Recategorizes `program_update` entries to `project_update`
3. Drops the 9 dead tables
4. Recreates `entries` and `scheduled_items` without removed columns (SQLite lacks DROP COLUMN pre-3.35)
5. Rebuilds indexes on entries
6. Runs VACUUM

**Pre-requisite:** Backup file must exist before migration. Rollback requires restoring from backup (migration is irreversible once committed).

**What does NOT change:**
- SQLite database file path (`%APPDATA%/Chronicle/chronicle.db`)
- WAL mode and FK enforcement
- MCP server direct-access model
- Core workflow: task → completion → entry
- All 259 entries preserved (with impact text merged into description)
- All 246 scheduled items preserved

## Migration from v2.0 to v2.5

| Component | v2.0 | v2.5 |
|-----------|------|------|
| Backend runtime | Python 3.12 + FastAPI + PyInstaller | Rust (axum, compiled into Tauri binary) |
| Process model | Tauri shell + sidecar process | Single process |
| Startup time | 10–30s (PyInstaller extraction) | <2s (native binary) |
| Installer size | ~45 MB | ~6 MB MSI |
| Build dependencies | Python, pip, PyInstaller, Rust, Node.js | Rust, Node.js |
| Sidecar management | Orphan cleanup, health polling, port discovery, tree kill | None needed |

**What does NOT change:**
- SQLite database file (same schema, same path, same WAL mode)
- React frontend (same build, same API calls, same JSON shapes)
- MCP server (same Python scripts, same port discovery via `.port` file)
- User data location (`%APPDATA%/Chronicle/`)
- `chronicle_config.json` format

**Upgrade path:** Users install v2.5 `.msi` (overwrites v2.0 installation). On first launch, the Rust backend opens the existing `chronicle.db` and operates on it without migration.
