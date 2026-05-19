# BUILD_PLAN.md — CHRONICLE

Professional Narrative System
Stage 4 — Build Plan
Date: March 31, 2026 (Updated: April 3, 2026 — v2.0)
Author: Brandon Hill-Rogers
Sources: CONCEPT.md, SCOPE.md, ARCHITECTURE.md

---

## Slice Strategy

CHRONICLE has 74 features across 7 entity types (entries, projects, goals, lessons, tags, links, review_sessions), 10 views, and a review + export engine. The slicing follows dependency order: foundation first, then entities bottom-up (tags → goals → projects → entries), then the views that consume them, then review & export, then data management.

Since this is a local app (no CloudFormation, no Lambda, no CI/CD pipelines), the 5-batch deploy gate pattern simplifies. Each slice follows:

1. Backend (database schema + API routes)
2. Frontend (views + components)
3. Verification (manual testing against acceptance criteria)

No infrastructure batch. No deploy checkpoints. Build, test, move on.

---

## Slice Overview

| Slice | Name | Features | Dependency |
|-------|------|----------|------------|
| 00 | Walking Skeleton | — | None |
| 01 | Settings & Tags | 50–55, 60–65 | Slice 00 |
| 02 | Goals | 14–19 | Slice 01 |
| 03 | Projects | 9–13 | Slice 02 |
| 04 | Entries & Quick Capture | 1–8 | Slice 03 |
| 05 | Lessons Learned | 20–24 | Slice 04 |
| 06 | Links | 56–59 | Slice 05 |
| 07 | Timeline & Dashboard | 25–31 | Slice 06 |
| 08 | Review & Export | 35, 39–46, 66–74 | Slice 07 |
| 09 | Data Management & Seed | 47–49 | Slice 08 |
| 10 | Punch List Enhancements | 75–76 | Slice 09 |

---

## Slice 00: Walking Skeleton

### Purpose
Get the app running end-to-end: backend serves API, frontend renders in browser, Vite proxies to FastAPI, start.bat launches both. No real features — just the wiring.

### Features & Stories
- I am able to run `start.bat` and see the app in my browser at localhost:5180
- I am able to see a tab navigation bar with placeholder tabs
- I am able to hit /api/health and get a 200 response
- Backend initializes SQLite database with WAL mode on first run

### Acceptance Criteria (EARS)
- WHEN start.bat is executed, THE backend SHALL start on port 8180 AND the frontend SHALL start on port 5180
- WHEN the user navigates to localhost:5180, THE app SHALL render a tab navigation bar with the CHRONICLE title
- WHEN GET /api/health is called, THE backend SHALL return `{"status": "ok"}`
- WHEN the backend starts for the first time, THE database file SHALL be created at data/chronicle.db with WAL journal mode

### Technical Specification

Backend:
- `backend/main.py`: FastAPI app with CORS, /api/health route
- `backend/database.py`: SQLite connection, init_db() creates all tables, WAL mode
- `backend/models.py`: Empty for now (Pydantic models added per slice)
- `backend/requirements.txt`: fastapi, uvicorn, pydantic, python-multipart

Frontend:
- `frontend/src/App.tsx`: Tab navigation shell with placeholder content per tab
- `frontend/src/index.css`: Base glassmorphism theme (black bg, squid ink, CSS variables, glass panels)
- `frontend/src/main.tsx`: React entry point
- `frontend/vite.config.ts`: Proxy /api → localhost:8180
- `frontend/package.json`: react, react-dom, vite, typescript

Root:
- `start.bat`: Launches backend (uvicorn) and frontend (npm run dev) in parallel
- `data/` directory created by backend on first run

### Verification
- start.bat launches both servers without errors
- Browser shows tab navigation at localhost:5180
- /api/health returns 200
- data/chronicle.db exists after first run

---

## Slice 01: Settings & Tags

### Purpose
Settings persistence, setup wizard, managed tag system, and the full visual theme. This is the foundation everything else references — identity fields appear in exports, tags are used by entries and lessons, FY config drives goal quarters.

### Features & Stories
- I am able to complete a first-launch setup wizard that asks for my name, role, title, org, manager name, and FY start month
- I am able to view and edit my settings after initial setup
- I am able to see a predefined list of tags that shipped with the app
- I am able to add, rename, and delete tags from the managed list
- I am able to see the full glassmorphism theme (black background, squid ink panels, glass effects)

### Acceptance Criteria (EARS)
- WHEN the app launches for the first time (setup_completed != "true"), THE app SHALL display the setup wizard before any other view
- WHEN the user completes the setup wizard, THE settings SHALL be persisted AND setup_completed SHALL be set to "true"
- WHEN the user navigates to Settings, THE current settings values SHALL be displayed and editable
- WHEN the backend initializes for the first time, THE 15 predefined tags SHALL be seeded into the tags table
- WHEN the user creates a new tag, THE tag SHALL appear in the managed list AND be available for autocomplete
- WHEN the user deletes a tag, THE tag SHALL be removed AND all junction table references SHALL be cascade deleted
- WHEN the user renames a tag, THE new name SHALL be reflected everywhere the tag appears

### Technical Specification

Backend:
- Settings CRUD: GET /api/settings, PUT /api/settings, GET /api/settings/setup-status
- Tags CRUD: GET /api/tags, POST /api/tags, PUT /api/tags/{id}, DELETE /api/tags/{id}
- Seed 15 predefined tags on first init_db()
- Pydantic models for settings and tag requests/responses

Frontend:
- `SettingsView.tsx`: Identity fields form, tag manager (list with add/rename/delete), FY start month selector
- Setup wizard: conditional render in App.tsx — if setup not completed, show wizard overlay
- Full CSS theme implementation: all CSS variables from ARCHITECTURE.md, glass panel component styles, input/button/card/chip styles
- Tab navigation fully styled

### Verification
- First launch shows setup wizard; completing it persists settings
- Settings view shows saved values and allows editing
- 15 predefined tags exist after first launch
- Tags can be added, renamed, deleted
- Full glassmorphism theme renders correctly (black bg, squid ink panels, glass effects)

### SCOPE.md Features Covered
50 (managed tags), 51 (setup wizard), 52 (identity fields), 53 (manager name), 54 (FY start), 55 (export preferences), 60–65 (visual design)

---

## Slice 02: Goals

### Purpose
SMART goal management with progress logs. Goals are the top of the entity hierarchy — projects link to goals, entries link to projects, so goals need to exist first.

### Features & Stories
- I am able to create a goal with all SMART fields (specific, measurable, achievable, relevant, time-bound)
- I am able to set a goal's fiscal year, quarter, status, and target date
- I am able to edit any goal field after creation
- I am able to delete a goal
- I am able to add timestamped progress log entries to a goal
- I am able to see a goal's full progress history
- I am able to filter goals by fiscal year and quarter

### Acceptance Criteria (EARS)
- WHEN a goal is created, THE goal SHALL have all SMART fields stored AND status SHALL default to "on_track"
- WHEN a progress log entry is added, THE entry SHALL capture the current timestamp AND the goal's status at that moment
- WHEN a goal is deleted, THE linked projects SHALL have their goal_id set to NULL (not deleted)
- WHEN goals are listed with FY/quarter filter, THE results SHALL only include goals matching the filter criteria
- WHEN a goal's status is updated, THE status change SHALL be reflected on the Goals view immediately

### Technical Specification

Backend:
- Goals CRUD: POST/GET/PUT/DELETE /api/goals, GET /api/goals/{id}
- Progress log: POST /api/goals/{id}/progress
- FY/quarter filter on GET /api/goals
- Pydantic models for goal and progress log

Frontend:
- `GoalsView.tsx`: Goal cards with status indicators (🟢🟡🔴), SMART field display, progress log timeline, FY/quarter filter, create/edit modal, add progress note form

### Verification
- Goals can be created with all SMART fields
- Progress log entries appear in chronological order with timestamps
- Deleting a goal doesn't delete linked projects (once projects exist)
- FY/quarter filter works correctly based on configured FY start month

### SCOPE.md Features Covered
14 (goal CRUD), 15 (status tracking), 16 (progress log), 17 (FY/quarter), 18 (goal-to-project linking — schema ready, UI in Slice 03), 19 (goal-to-entry linking — via project chain)

---

## Slice 03: Projects

### Purpose
Project tracking with goal linking. Projects group entries and connect to goals, forming the middle of the entity hierarchy.

### Features & Stories
- I am able to create a project with name, description, dates, and status
- I am able to link a project to a goal
- I am able to edit project fields and change status
- I am able to close out a project (set status to completed, set actual_end_date)
- I am able to delete a project without losing linked entries
- I am able to see which goal a project is aligned to

### Acceptance Criteria (EARS)
- WHEN a project is created, THE status SHALL default to "planning"
- WHEN a project is linked to a goal, THE goal association SHALL be visible on the project card
- WHEN a project is deleted, THE linked entries SHALL have their project_id set to NULL (not deleted)
- WHEN a project status is changed to "completed", THE actual_end_date SHALL be set if not already provided
- WHEN projects are listed, THE goal alignment SHALL be displayed on each project card

### Technical Specification

Backend:
- Projects CRUD: POST/GET/PUT/DELETE /api/projects, GET /api/projects/{id}
- GET /api/projects/{id} returns project + linked entries (once entries exist)
- Goal dropdown populated from GET /api/goals
- Pydantic models for project

Frontend:
- `ProjectsView.tsx`: Project cards with status badge, date range, goal alignment indicator, create/edit modal, close-out flow

### Verification
- Projects can be created, edited, deleted
- Goal linking works (dropdown of existing goals)
- Deleting a project doesn't delete entries (once entries exist)
- Project cards show goal alignment

### SCOPE.md Features Covered
9 (project CRUD), 10 (status tracking), 11 (project-to-goal linking), 12 (close-out), 13 (linked entries — schema ready, populated in Slice 04)

---

## Slice 04: Entries & Quick Capture

### Purpose
The core data capture — both Quick Capture (fast, minimal) and Full Entry (structured, all fields). This is the atomic unit of CHRONICLE.

### Features & Stories
- I am able to create a quick capture with just a title and note, auto-timestamped
- I am able to create a full entry with all fields: type, work_type, title, description, impact, metrics, project, tags, status, visibility
- I am able to edit any entry after creation
- I am able to delete an entry
- I am able to tag an entry as an accomplishment or lesson learned
- I am able to pin an entry as the weekly highlight
- I am able to backdate an entry to a past date
- I am able to use Save & New to create multiple entries in sequence
- I am able to see tag autocomplete from the managed tag list when adding tags
- I am able to select markdown-formatted text in description fields

### Acceptance Criteria (EARS)
- WHEN a quick capture is created, THE entry_type SHALL be "quick_capture" AND entry_date SHALL be the current system date/time AND work_type SHALL default to "operational_rhythm"
- WHEN a full entry is created, THE user SHALL select entry_type and work_type from predefined options
- WHEN tags are added to an entry, THE entry_tags junction table SHALL be updated AND tag autocomplete SHALL suggest from existing tags
- WHEN an entry is toggled as accomplishment, THE is_accomplishment flag SHALL be set to 1
- WHEN an entry is toggled as weekly highlight, THE previous highlight (if any) for that week SHALL be unset AND the new entry SHALL be set
- WHEN an entry is deleted, THE entry_tags junction rows SHALL be cascade deleted AND lessons_learned.source_entry_id references SHALL be set to NULL
- WHEN Save & New is clicked, THE current entry SHALL be saved AND the form SHALL reset for a new entry

### Technical Specification

Backend:
- Entries CRUD: POST/GET/PUT/DELETE /api/entries, GET /api/entries/{id}
- Toggle routes: PUT /api/entries/{id}/highlight, /accomplishment, /lesson-learned
- GET /api/entries supports filters: date_range, entry_type, work_type, project_id, tag_ids, status, visibility, search (full-text on title + description)
- Highlight toggle: unset previous highlight for same week when setting new one
- Pydantic models for entry create/update (handles both quick and full)

Frontend:
- `QuickCaptureView.tsx`: Minimal form (title, note, tags), auto-timestamp, recent captures list below
- `EntryFormView.tsx`: Full form with all fields, entry type chips, work type selector, project dropdown, tag autocomplete chips, visibility toggle, status selector, Save + Save & New buttons, edit mode

### Verification
- Quick capture creates entry with auto-timestamp in under 10 seconds
- Full entry captures all fields correctly
- Tags autocomplete from managed list, new tags can be created on the fly
- Accomplishment/lesson learned/highlight toggles work
- Backdating works (entry_date picker allows past dates)
- Save & New resets form after save
- Entries list with filters returns correct results

### SCOPE.md Features Covered
1 (quick capture), 2 (full entry), 3 (entry types), 4 (work type), 5 (accomplishment/lesson tagging), 6 (backdating), 7 (save & new), 8 (markdown in description), 28 (highlight pin — toggle), 29 (quick capture view), 30 (entry form view)

---

## Slice 05: Lessons Learned

### Purpose
Dedicated lessons learned section — separate from entry tagging. Structured capture of insights from events, seasons, or work streams.

### Features & Stories
- I am able to create a lesson learned with title, context, lesson, and application fields
- I am able to link a lesson to a source entry or source project
- I am able to set a date range and label (e.g., "Peak 2025")
- I am able to tag lessons using the managed tag system
- I am able to edit and delete lessons
- I am able to filter lessons by date range, source project, and tags

### Acceptance Criteria (EARS)
- WHEN a lesson is created, THE title, context, lesson, and application fields SHALL be stored
- WHEN a source entry or project is linked, THE FK reference SHALL be set AND the source SHALL be displayed on the lesson card
- WHEN a lesson is deleted, THE lesson_tags junction rows SHALL be cascade deleted
- WHEN lessons are filtered by project, THE results SHALL only include lessons with matching source_project_id

### Technical Specification

Backend:
- Lessons CRUD: POST/GET/PUT/DELETE /api/lessons, GET /api/lessons/{id}
- GET /api/lessons supports filters: date_range, source_project_id, tag_ids
- Pydantic models for lesson create/update

Frontend:
- `LessonsLearnedView.tsx`: Lesson cards with context summary, source link, date range label, tags. Create/edit modal with source entry/project dropdowns, date range picker, tag chips.

### Verification
- Lessons can be created with all fields
- Source linking works (dropdown of entries and projects)
- Date range label displays correctly
- Tags work via junction table
- Filters return correct results

### SCOPE.md Features Covered
20 (dedicated section), 21 (structured fields), 22 (source linking), 23 (date range + label), 24 (lesson tagging)

---

## Slice 06: Links

### Purpose
URL links on any entity — entries, projects, goals, lessons. Polymorphic via parent_type + parent_id.

### Features & Stories
- I am able to add a URL link with an optional label to any entry, project, goal, or lesson
- I am able to see links displayed on the entity's detail view
- I am able to delete a link

### Acceptance Criteria (EARS)
- WHEN a link is added, THE parent_type and parent_id SHALL correctly reference the target entity
- WHEN an entity is displayed, THE associated links SHALL be shown as clickable URLs with labels
- WHEN a link is deleted, THE link row SHALL be removed from the links table

### Technical Specification

Backend:
- Links: POST /api/links, DELETE /api/links/{id}
- Links returned as part of entity detail responses (GET /api/entries/{id}, /projects/{id}, /goals/{id}, /lessons/{id})
- Pydantic model for link create

Frontend:
- Link component: reusable "add link" button + link list, embedded in Entry Form, Project detail, Goal detail, Lesson detail views
- Links render as clickable URLs with labels (or URL as label if no label provided)

### Verification
- Links can be added to all 4 entity types
- Links display correctly on detail views
- Links can be deleted
- Clicking a link opens the URL in a new tab

### SCOPE.md Features Covered
56 (entry links), 57 (project links), 58 (goal links), 59 (lesson links)

---

## Slice 07: Timeline & Dashboard

### Purpose
The two primary consumption views. Dashboard is the landing page with stats, catch-up prompts, and quick actions. Timeline is the "library of you" — chronological, filterable, searchable.

### Features & Stories
- I am able to see dashboard stats: entries this week/month/quarter, active projects, goals on track vs. at risk, days since last entry
- I am able to see a catch-up prompt when I haven't logged in 3+ days, with backfill shortcuts
- I am able to see my recent entries feed (last 10)
- I am able to see my weekly highlight pinned on the dashboard
- I am able to use quick action buttons to jump to Quick Capture, Full Entry, or Review
- I am able to see an operational rhythm summary on the dashboard
- I am able to browse all entries chronologically on the Timeline view
- I am able to filter the timeline by date range, entry type, project, tags, status, and work type
- I am able to search across all entry text (title + description)
- I am able to expand an entry inline on the timeline to see full details

### Acceptance Criteria (EARS)
- WHEN the dashboard loads, THE stat cards SHALL show accurate counts based on current data
- WHEN 3+ days have passed since the last entry, THE catch-up prompt SHALL display with gap dates as backfill shortcuts
- WHEN a backfill shortcut is clicked, THE Quick Capture form SHALL open pre-filled with that date
- WHEN the weekly highlight exists, THE dashboard SHALL display it prominently
- WHEN timeline filters are applied, THE results SHALL update to show only matching entries
- WHEN a search term is entered, THE timeline SHALL filter to entries where title or description contains the term
- WHEN an entry is expanded on the timeline, THE full details (description, impact, metrics, tags, links) SHALL be visible

### Technical Specification

Backend:
- GET /api/dashboard: returns stats object with counts, active projects, goal status summary, last_entry_date, gap_dates array, current highlight, recent entries (last 10), operational rhythm summary for current period
- Dashboard query aggregates across entries, projects, goals tables
- FY quarter calculation uses configured fiscal_year_start_month
- Gap detection: compare last entry_date to current date, generate array of missing dates if gap >= 3

Frontend:
- `DashboardView.tsx`: Stat cards row, catch-up prompt (conditional), recent feed, highlight card, quick action buttons, operational rhythm summary
- `TimelineView.tsx`: Vertical timeline layout, filter bar (date range picker, dropdowns for type/project/status/work_type, tag multi-select, search input), entry cards with expand/collapse, color coding by entry type

### Verification
- Dashboard stats are accurate against known data
- Catch-up prompt appears when gap >= 3 days, disappears otherwise
- Backfill shortcut opens Quick Capture with correct date
- Weekly highlight displays on dashboard
- Timeline filters work independently and in combination
- Search returns entries matching title or description text
- Entry expansion shows all fields

### SCOPE.md Features Covered
25 (dashboard stats), 26 (catch-up prompt), 27 (recent feed), 28 (highlight — display), 31 (timeline view), 32 (projects view — already built, dashboard references it), 33 (goals view — already built, dashboard references it), 34 (lessons view — already built), 37 (about modal — add here), 38 (tab navigation — already built)

---

## Slice 08: Review & Export

### Purpose
The payoff. Review is the 1:1 prep and self-reflection workflow — select a date range, see your metrics, click into items, take notes, create action items, and when you're ready, generate structured markdown exports right from the same context. Leadership Update, Self-Review, Weekly Summary. The review adapts its format based on scope: weekly reviews are tactical (granular detail), quarterly and annual reviews are strategic (summary-level). Export lives inside Review, not as a standalone tab.

### Features & Stories
- I am able to create a review session by selecting a date range scope (weekly, monthly, quarterly, annual, or custom)
- I am able to see a review dashboard with metrics for the selected period: entries count, accomplishments, projects, goals, lessons, action items
- I am able to see the review format adapt based on scope — weekly shows tactical detail, quarterly/annual shows strategic summary
- I am able to click on any entry, project, goal, or lesson during review to open an item modal with blurred background
- I am able to view full item details, add review notes, create action items, and update items from within the modal
- I am able to capture review notes — both general 1:1 session notes and entity-linked notes
- I am able to create action items during review (entry_type: "action_item") as follow-on tasks
- I am able to Log Review to save the completed session as a permanent record
- I am able to browse and view detail of past review sessions
- I am able to select an export template (Leadership Update, Self-Review, Weekly Summary) from within the review context
- I am able to filter exports by project, tags, entry type, visibility, and work type
- I am able to preview the export before generating
- I am able to copy the export to clipboard
- I am able to download the export as a .md file
- I am able to see accomplishments grouped before in-progress items
- I am able to see operational rhythm as a distinct section in exports
- I am able to see my weekly highlight featured in weekly summaries
- I am able to see only "shareable" entries by default in exports

### Acceptance Criteria (EARS)
- WHEN a review session is created with a date range scope, THE Review_View SHALL display metrics and items for the selected period
- WHEN the review scope is weekly, THE format SHALL emphasize tactical detail (individual entries, granular metrics)
- WHEN the review scope is quarterly or annual, THE format SHALL emphasize strategic summary (aggregated metrics, goal-level progress, accomplishment highlights)
- WHEN an item (entry, project, goal, or lesson) is clicked during review, THE Review_Modal SHALL open with a blurred background showing full item details
- WHEN a review note is created, THE note SHALL be stored as either a general session note (no parent) or linked to a specific entity (parent_type + parent_id)
- WHEN an action item is created during review, THE action item SHALL be saved as an Entry with entry_type "action_item"
- WHEN Log Review is clicked, THE session SHALL be saved to review_sessions with review_date, date range, review_type, and session_notes
- WHEN past review sessions are browsed, THE list SHALL show all previously logged sessions with date, type, and summary
- WHEN Leadership Update is selected, THE export SHALL group entries by project/goal with accomplishments first, then in-progress, then operational rhythm section, then lessons learned
- WHEN Self-Review is selected, THE export SHALL organize by goal with SMART context, accomplishments, impact/metrics, and decisions under each goal, plus operational rhythm section
- WHEN Weekly Summary is selected, THE export SHALL show the weekly highlight at top, then completed, in-progress, and quick captures
- WHEN visibility filter defaults to "shareable", THE export SHALL exclude entries marked "personal"
- WHEN the preview pane renders, THE markdown SHALL be displayed as formatted text
- WHEN copy to clipboard is clicked, THE raw markdown SHALL be copied to the system clipboard
- WHEN download is clicked, THE markdown SHALL be saved as a .md file in data/exports/

### Technical Specification

Backend:
- Review sessions CRUD: POST /api/review-sessions, GET /api/review-sessions, GET /api/review-sessions/{id}
- Review notes CRUD: POST /api/review-notes (supports both session-level and entity-linked notes)
- `backend/export_engine.py`: Template rendering module
  - `generate_leadership_update(date_range, filters, settings)` → markdown string
  - `generate_self_review(fiscal_year, filters, settings)` → markdown string
  - `generate_weekly_summary(week_start, filters, settings)` → markdown string
- POST /api/export: accepts template_type, date_range, filters → returns markdown string + optional file save
- Export engine queries database.py for entries, projects, goals, lessons
- Settings (user_name, user_role, etc.) injected into export headers
- Action item creation uses existing POST /api/entries with entry_type "action_item"

Database:
- `CREATE TABLE IF NOT EXISTS review_sessions` (id, review_date, date_range_start, date_range_end, review_type, session_notes, created_at)
- `CREATE TABLE IF NOT EXISTS review_notes` (id, review_session_id, parent_type, parent_id, note_text, created_at)
- Added to init_db() — non-destructive, runs alongside existing table creation

Frontend:
- `ReviewView.tsx` (replaces `ExportView.tsx`): Date range scope selector (weekly/monthly/quarterly/annual/custom), review dashboard with metrics, item cards/tables for entries/projects/goals/lessons, export template selector (3 templates), filter panel, preview pane (renders markdown as HTML), copy to clipboard button, download .md button, Log Review button, past sessions browser
- `ReviewModal.tsx`: Blurred background overlay, full item detail display, review note input, action item creation form, item update controls

### Verification
- Review session can be created with any date range scope
- Metrics accurately reflect the selected period
- Adaptive format works: weekly shows tactical detail, quarterly/annual shows strategic summary
- Item modals open with blurred background and show full details
- Review notes can be created as session-level or entity-linked
- Action items are created as entries with entry_type "action_item"
- Log Review saves the session and it appears in past sessions
- Past review sessions can be browsed and viewed
- Each export template produces correctly structured markdown
- Filters correctly narrow the exported data
- Preview matches the final output
- Clipboard copy works
- Downloaded .md file is valid and well-formatted
- Shareable filter excludes personal entries
- Operational rhythm appears as distinct section

### SCOPE.md Features Covered
35 (review view — includes export), 39 (leadership update), 40 (self-review), 41 (weekly summary), 42 (markdown export), 43 (clipboard), 44 (preview), 45 (visibility filter), 46 (operational rhythm in exports), 66 (review session creation), 67 (review dashboard with metrics), 68 (review item modal), 69 (review notes), 70 (action item creation during review), 71 (log review), 72 (past review session browsing), 73 (review database schema), 74 (adaptive review format)

---

## Slice 09: Data Management & Seed

### Purpose
Full database backup/restore and the initial data seed import. This is the portability and bootstrapping layer.

### Features & Stories
- I am able to export my entire database as a JSON file
- I am able to import a JSON backup to restore my database
- I am able to run an initial data seed to bootstrap CHRONICLE with existing goals, projects, and entries
- I am able to see data management options in Settings

### Acceptance Criteria (EARS)
- WHEN database export is triggered, THE entire database (all tables including review_sessions and review_notes) SHALL be serialized to a JSON file and saved to data/exports/
- WHEN database import is triggered, THE existing data SHALL be cleared (with confirmation) AND all tables SHALL be populated from the JSON file
- WHEN the initial seed is run, THE goals, projects, entries, tags, lessons, and settings SHALL be created from the seed payload
- WHEN import completes, THE app SHALL reflect the imported data immediately without restart
- WHEN export is downloaded, THE JSON file SHALL be a complete, re-importable snapshot

### Technical Specification

Backend:
- POST /api/data/export: serialize all tables → JSON, save to data/exports/chronicle_backup_{timestamp}.json, return as download
- POST /api/data/import: accept JSON upload, validate schema, clear existing data (within transaction), populate all tables (including review_sessions and review_notes), return success/failure
- POST /api/data/seed: accept JSON payload matching seed schema, create all entities with relationships preserved (goal_ids → project.goal_id, project_ids → entry.project_id, etc.)
- JSON schema: `{ settings: {}, goals: [], projects: [], entries: [], lessons: [], tags: [], links: [], goal_progress_log: [], review_sessions: [], review_notes: [] }`
- Import/export use transactions for atomicity

Frontend:
- Data management section in `SettingsView.tsx`: Export Database button, Import Database button (file picker + confirmation dialog), Seed Data button (file picker, one-time use)
- Confirmation dialog before import: "This will replace all existing data. Are you sure?"

### Verification
- Export produces valid JSON with all data
- Import restores data correctly (round-trip: export → import → verify data matches)
- Seed creates entities with correct relationships
- Import confirmation prevents accidental data loss
- App reflects imported data without restart

### SCOPE.md Features Covered
47 (database export), 48 (database import), 49 (initial seed)

---

## Parity Verification (BUILD_PLAN ↔ SCOPE.md)

All 74 SCOPE.md features accounted for across slices:

| Feature # | Description | Slice |
|-----------|-------------|-------|
| 1 | Quick Capture mode | 04 |
| 2 | Full Entry mode | 04 |
| 3 | Entry type classification | 04 |
| 4 | Work type distinction | 04 |
| 5 | Tag as Accomplishment / Lesson Learned | 04 |
| 6 | Backdating entries | 04 |
| 7 | Save & New | 04 |
| 8 | Markdown in description | 04 |
| 9 | Project CRUD | 03 |
| 10 | Project status tracking | 03 |
| 11 | Project-to-goal linking | 03 |
| 12 | Project close-out | 03 |
| 13 | Linked entries per project | 03+04 |
| 14 | Goal CRUD with SMART fields | 02 |
| 15 | Goal status tracking | 02 |
| 16 | Goal progress log | 02 |
| 17 | FY/quarter association | 02 |
| 18 | Goal-to-project linking | 02+03 |
| 19 | Goal-to-entry linking | 02+03+04 |
| 20 | Dedicated Lessons Learned section | 05 |
| 21 | Lesson fields | 05 |
| 22 | Source linking | 05 |
| 23 | Date range + label | 05 |
| 24 | Lesson tagging | 05 |
| 25 | Dashboard stats | 07 |
| 26 | Catch-up prompt | 07 |
| 27 | Recent entries feed | 07 |
| 28 | Win of the Week / Highlight | 04+07 |
| 29 | Quick Capture view | 04 |
| 30 | Entry Form view | 04 |
| 31 | Timeline view | 07 |
| 32 | Projects view | 03 |
| 33 | Goals view | 02 |
| 34 | Lessons Learned view | 05 |
| 35 | Review view (includes export) | 08 |
| 36 | Settings view | 01 |
| 37 | About modal | 07 |
| 38 | Tab navigation | 00 |
| 39 | Leadership Update template | 08 |
| 40 | Self-Review template | 08 |
| 41 | Weekly Summary template | 08 |
| 42 | Export to Markdown | 08 |
| 43 | Export to clipboard | 08 |
| 44 | Export preview | 08 |
| 45 | Shareable visibility filter | 08 |
| 46 | Operational rhythm in exports | 08 |
| 47 | Database export (JSON) | 09 |
| 48 | Database import (JSON) | 09 |
| 49 | Initial data seed | 09 |
| 50 | Managed tag list | 01 |
| 51 | Setup wizard | 01 |
| 52 | Identity fields | 01 |
| 53 | Manager name | 01 |
| 54 | FY start month | 01 |
| 55 | Export preferences | 01 |
| 56 | URL links on entries | 06 |
| 57 | URL links on projects | 06 |
| 58 | URL links on goals | 06 |
| 59 | URL links on lessons | 06 |
| 60 | Black background | 01 |
| 61 | Squid ink surfaces | 01 |
| 62 | Glassmorphism effects | 01 |
| 63 | Stoplight indicators | 01 |
| 64 | Entry type icons/colors | 01 |
| 65 | Desktop-first responsive | 01 |
| 66 | Review session creation | 08 |
| 67 | Review dashboard with metrics | 08 |
| 68 | Review item modal | 08 |
| 69 | Review notes | 08 |
| 70 | Action item creation during review | 08 |
| 71 | Log Review (save session) | 08 |
| 72 | Past review session browsing | 08 |
| 73 | Review database schema | 08 |
| 74 | Adaptive review format | 08 |

All 74 features mapped. Zero gaps.

---

## Slice 10: Punch List Enhancements

### Purpose
Two targeted enhancements identified during post-build review: an ASANA-optimized export template for leadership tracking, and a Quick Capture to-do mode for action item creation.

### Features & Stories
- I am able to generate an ASANA-formatted status update that's a 5-8 minute read with TL;DR, What's On Track, What Needs Attention, Key Decisions, Operational Rhythm summary, and Next Steps
- I am able to copy the ASANA export and paste it into ASANA or hand it to AI for polishing
- I am able to toggle "This is a to-do" in Quick Capture to create an action item with a due date
- I am able to see my open to-dos on the Dashboard sorted by due date
- I am able to mark to-dos complete from the Timeline with a checkbox click

### Acceptance Criteria (EARS)
- WHEN "ASANA Status" template is selected, THE export SHALL produce a structured markdown document with TL;DR, What's On Track (max 5), What Needs Attention (max 3), Key Decisions (max 3), Operational Rhythm (count + highlights), and Next Steps (max 5)
- WHEN the ASANA export is generated, THE output SHALL be 800-1200 words (5-8 minute read) with descriptions trimmed to one line
- WHEN the to-do toggle is enabled in Quick Capture, THE entry SHALL be created with entry_type "action_item", status "in_progress", and the selected due date
- WHEN the Dashboard loads, THE "Open To-Dos" section SHALL show up to 10 action items sorted by due date ascending
- WHEN a to-do checkbox is clicked on the Timeline, THE entry status SHALL be updated to "completed"

### Technical Specification

Backend:
- New `generate_asana_status()` in export_engine.py with smart truncation logic
- POST /api/export accepts template_type "asana_status"
- DashboardResponse model extended with open_todos + open_todos_count
- GET /api/dashboard queries open action_items sorted by entry_date ASC

Frontend:
- QuickCaptureView.tsx: "This is a to-do" toggle, conditional due date picker
- DashboardView.tsx: "Open To-Dos" section with completion checkboxes
- TimelineView.tsx: completion checkbox for action_item entries
- ReviewView.tsx: 4th export template button "ASANA Status"

### Verification
- ASANA export produces clean, scannable markdown within 800-1200 word target
- Quick Capture to-do toggle creates action_items with correct defaults
- Dashboard shows open to-dos sorted by due date
- Timeline allows completing to-dos via checkbox
- All existing tests still pass

### SCOPE.md Features Covered
75 (ASANA export template), 76 (Quick Capture to-do mode)

### Parity Table Addition

| 75 | ASANA-optimized export template | 10 |
| 76 | Quick Capture to-do mode | 10 |
| 77 | Project stakeholders / collaborators | 10 |
| 78 | App reset and transfer | 10 |
| 79 | Portable app packaging | 10 |

---

## DEFINITION_OF_DONE.md

Created as a separate file: `repository/Chronicle/DEFINITION_OF_DONE.md`

## LESSONS_LEARNED.md

Created as a separate file: `repository/Chronicle/LESSONS_LEARNED.md`

---

Stage 4 complete. Ready to begin Slice 00 (Walking Skeleton) on your call.
