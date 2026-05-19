# SCOPE.md — CHRONICLE

Professional Narrative System
Stage 1 — Scoping
Date: March 31, 2026 (Updated: April 3, 2026 — v2.0)
Author: Brandon Hill-Rogers
Source: CONCEPT.md (Stage 0, March 31, 2026)

---

## Scoping Context

CHRONICLE is a local-first, single-user Professional Narrative System. Many standard scoping categories (auth, multi-environment deployment, CI/CD, IAM, monitoring) don't apply. This document focuses on what's actually in scope for a V2 build, maps every CONCEPT.md feature to a build scope item, and identifies boundaries clearly.

---

## Feature Inventory (Traced to CONCEPT.md)

Every feature from CONCEPT.md is listed below with its scope classification.

### Data Capture

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 1 | Quick Capture mode | V1 | Minimal fields, auto-timestamp, fast save |
| 2 | Full Entry mode | V1 | All fields: type, impact, metrics, tags, visibility, status |
| 3 | Entry type classification | V1 | 8 types: quick_capture, project_update, operational_rhythm, development, recognition, decision, milestone, action_item |
| 4 | Work type distinction (project vs. operational rhythm) | V1 | First-class field, not just a tag |
| 5 | Tag as Accomplishment / Lesson Learned | V1 | Boolean flags on entries, available on completed entries |
| 6 | Backdating entries | V1 | Entry date picker defaults to today, allows past dates |
| 7 | Save & New (batch entry) | V1 | Continue creating entries without returning to list |
| 8 | Markdown in description fields | V1 | Render markdown in display, plain textarea for input |

### Projects

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 9 | Project CRUD | V1 | Create, read, update, delete projects |
| 10 | Project status tracking | V1 | planning, active, completed, paused |
| 11 | Project-to-goal linking | V1 | Optional FK to a goal |
| 12 | Project close-out with tagging | V1 | Mark as accomplishment/lesson learned on completion |
| 13 | Linked entries per project | V1 | Entries reference project_id |

### SMART Goals

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 14 | Goal CRUD with SMART fields | V1 | All 5 SMART fields as separate editable text areas |
| 15 | Goal status tracking | V1 | on_track, at_risk, behind, completed, paused |
| 16 | Goal progress log | V1 | Timestamped notes per goal (progress, roadblocks, pivots) |
| 17 | Fiscal year / quarter association | V1 | Configurable FY start in Settings |
| 18 | Goal-to-project linking | V1 | Projects reference goal_id |
| 19 | Goal-to-entry linking | V1 | Via project association (entry → project → goal) |

### Lessons Learned

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 20 | Dedicated Lessons Learned section | V1 | Separate from entry tagging — standalone entity |
| 21 | Lesson fields: title, context, lesson, application | V1 | Structured capture |
| 22 | Source linking (entry or project) | V1 | Optional FK to entry or project |
| 23 | Date range + label | V1 | e.g., "Peak 2025", "Q1 2026" |
| 24 | Lesson tagging | V1 | Same managed tag system as entries |

### Views & Navigation

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 25 | Dashboard with stat cards | V1 | Entries this week/month/quarter, active projects, goal status |
| 26 | Catch-up prompt (3+ days gap) | V1 | Surfaces backfill shortcuts when gaps detected |
| 27 | Recent entries feed | V1 | Last 10 entries on dashboard |
| 28 | Win of the Week / Highlight pin | V1 | Boolean flag, surfaced on dashboard and weekly export |
| 29 | Quick Capture view | V1 | Minimal form + recent captures list |
| 30 | Entry Form view (full) | V1 | All fields, edit mode, accomplishment/lesson tagging |
| 31 | Timeline view | V1 | Chronological, filterable, searchable, expandable |
| 32 | Projects view | V1 | Card layout, linked entries, goal alignment |
| 33 | Goals view | V1 | SMART cards, progress log, FY/quarter filter |
| 34 | Lessons Learned view | V1 | List/card, filterable, linked sources |
| 35 | Review view (includes export) | V1 | Review session with metrics, item modals, notes, action items, export engine — replaces standalone Export tab |
| 36 | Settings view | V1 | Identity config, tags, review period, export preferences, collaborators |
| 37 | About modal | V1 | App info, version, workflow overview |
| 38 | Sidebar navigation | V2 | SYSTEM group (Dashboard, Timeline, Projects, Goals) + TOOLS group (Review, Lessons, Data, Settings). Replaced tab-based navigation |
| 38b | Data view | V2 | Smart Upload, Backup & Restore, Reset Application, Advanced seed. Extracted from Settings |

### Export & Output

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 39 | Leadership Update template | V1 | Grouped by project/goal, accomplishments first |
| 40 | Self-Review template | V1 | Organized by goal with SMART context |
| 41 | Weekly Summary template | V1 | Highlight + completed + in-progress + quick notes |
| 42 | PDF export via @react-pdf/renderer | V2 | Client-side PDF generation with executive styling, signal blocks, fixed footer |
| 43 | Copy-paste modal | V2 | Clean plain text for pasting into any system (Asana, email, Slack, wiki) |
| 44 | Export preview pane | V2 | Live preview with per-item/per-section toggles, section reorder |
| 45 | Shareable visibility filter | V1 | Exports default to "shareable" entries only |
| 46 | Operational rhythm section in exports | V1 | Distinct from project accomplishments |

### Data Management

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 47 | Full database export (JSON) | V1 | Backup entire DB to a JSON file |
| 48 | Full database import (JSON) | V1 | Restore from backup |
| 49 | Initial data seed import | V1 | One-time script to bootstrap from existing data |
| 50 | Managed tag list (predefined + editable) | V1 | Ships with ~15 predefined tags, user can add/remove/rename |

### Settings & Configuration

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 51 | Setup wizard (first launch) | V1 | Configure identity before first use |
| 52 | Name, role, title, org fields | V1 | Used in export headers |
| 53 | Manager name | V1 | Used in export context |
| 54 | Fiscal year start month | V1 | Drives quarter calculations |
| 55 | Export default preferences | V1 | Default template, default filters |

### Links & References

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 56 | URL links on entries | V1 | Link to CRs, Taskei tasks, docs, wikis |
| 57 | URL links on projects | V1 | Same pattern |
| 58 | URL links on goals | V1 | Same pattern |
| 59 | URL links on lessons | V1 | Same pattern |

### Visual Design

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 60 | Executive slate light mode | V2 | #F9FAFB background, #2F3A4A primary, #3F7D58 success, #E5E7EB borders |
| 61 | Executive slate dark mode | V2 | #111827 background, #1F2937 secondary, matching restrained palette |
| 62 | Subtle card styling | V2 | 1px solid borders, minimal shadows, increased padding — structured, not floating |
| 63 | Stoplight status indicators | V1 | 🟢🟡🔴 consistent with ops outputs |
| 64 | Entry type icons / color coding | V1 | Visual differentiation by type |
| 65 | Desktop-first responsive | V1 | Functional on tablet, optimized for desktop |

### Review & 1:1 Prep

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 66 | Review session creation | V1 | Select date range scope: weekly, monthly, quarterly, annual, or custom |
| 67 | Review dashboard with metrics | V1 | Entries count, accomplishments, projects, goals, lessons, action items for selected date range |
| 68 | Review item modal | V1 | Click item to open modal with blurred background — view details, add notes, update |
| 69 | Review notes | V1 | 1:1 session notes + entity-linked notes captured during review |
| 70 | Action item creation during review | V1 | New entry_type: action_item — created as follow-on tasks from review context |
| 71 | Log Review (save session) | V1 | Save completed review session as a permanent record in review_sessions |
| 72 | Past review session browsing | V1 | Browse and view detail of previously logged review sessions |
| 73 | Review database schema | V1 | review_sessions + review_notes tables (CREATE TABLE IF NOT EXISTS) |
| 74 | Adaptive review format | V1 | Weekly = tactical focus, quarterly/annual = strategic focus |

### Punch List Enhancements

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 75 | ASANA-optimized export template | V1 | 4th export template: TL;DR, What's On Track, What Needs Attention, Key Decisions, Op Rhythm summary, Next Steps. 800-1200 word target. Designed for ASANA paste + AI polishing |
| 76 | Quick Capture to-do mode | V1 | "This is a to-do" toggle in Quick Capture creates action_items with due date. Open to-dos on Dashboard sorted by due date. Timeline completion checkbox for action items |

### Final Punch List Enhancements

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 77 | Project stakeholders / collaborators | V1 | stakeholders table + project_stakeholders junction. Add/remove people on projects. "People I've Worked With" summary view |
| 78 | App reset and transfer | V1 | POST /api/data/reset clears all tables. Two-step confirmation in UI. Export/import includes stakeholder tables |
| 79 | Portable app packaging | V1 | setup_portable.bat bundles venv + node_modules. Improved start.bat with DO NOT CLOSE windows, auto-close launcher, browser auto-open. TRANSFER_GUIDE.md |

### Punch List 2: Executive Upgrade

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 80 | Executive slate design system | V2 | Replaced glassmorphism with restrained slate palette (#F9FAFB, #2F3A4A, #3F7D58, #E5E7EB). Inter font stack. Dark mode restyled to dark slate |
| 81 | Sidebar restructuring | V2 | SYSTEM group (Dashboard, Timeline, Projects, Goals) + TOOLS group (Review, Lessons, Data, Settings). Capture Entry as floating modal button |
| 82 | Dashboard operational summary | V2 | Auto-generated summary line, renamed metrics, two-column layout (Action Items + Recent Activity), 96px header |
| 83 | Formal microcopy pass | V2 | "Capture Entry", "Recent Activity", "Goals Tracking to Plan", "Log Activity". All decorative emojis removed |
| 84 | Brand identity | V2 | "CHRONICLE — Professional Narrative System. Capture your work. Communicate your impact." Version 2.0.0 |
| 85 | Smart Parse engine | V2 | smartParse.ts categorizes entries into 4 template types with toggle/reorder controls |
| 86 | PDF export | V2 | @react-pdf/renderer, executive styling, signal blocks, fixed footer ("Generated by CHRONICLE") |
| 87 | Copy-paste modal | V2 | Clean plain text for pasting into any system. Replaces raw markdown copy |
| 88 | Export Preview | V2 | Live preview with per-item/per-section toggles, section reorder, template switching |
| 89 | Smart Upload | V2 | Template Generator + Upload Parser + three-step UI (Generate Prompt → Paste Output → Review & Commit) |
| 90 | Data page | V2 | Extracted from Settings. Smart Upload, Backup & Restore, Reset (requires typing "DELETE"), Advanced seed |
| 91 | Edit-in-place on Timeline | V2 | Edit Entry button on every expanded entry opens EntryFormView in edit mode |
| 92 | Toggle switch on Capture Entry | V2 | Replaces checkbox for to-do toggle |
| 93 | Favicon update | V2 | Slate "C" favicon matching executive design system |

### Punch List 3: Polish & Data Architecture

| # | Feature | Scope | Notes |
|---|---------|-------|-------|
| 94 | Accomplishment architecture refactor | V2.1 | Moved from entry level to project/goal level. `is_accomplishment` on projects and goals tables |
| 95 | Visual timeline strip | V2.1 | Horizontal line graph with entry-date dots, month labels, click-to-filter |
| 96 | Three-color card borders | V2.1 | Green = project-linked, red = action item, slate = standalone |
| 97 | Standardized card layout | V2.1 | Two-row: title+date, project pill+tags, description preview |
| 98 | Projects search and status filter | V2.1 | Search box + status dropdown matching Timeline pattern |
| 99 | Clickable linked entries in Projects | V2.1 | Navigate to Timeline with entry focused |
| 100 | Clickable aligned goal in Projects | V2.1 | Navigate to Goals with goal expanded |
| 101 | Progress log edit/delete | V2.1 | PUT/DELETE routes + inline edit UI on project progress notes |
| 102 | Goals linked projects count fix | V2.1 | `linked_projects_count` field with GROUP BY count query |
| 103 | Capture Entry alphabetical sort + close on save | V2.1 | Tags/projects sorted, Save closes modal |
| 104 | Export buttons below preview | V2.1 | Prepare Export at top, Download/Copy below preview |
| 105 | Export duplicate suppression | V2.1 | Project name hidden when identical to entry title |

---

## Total Feature Count: 79 V1 + 14 V2 + 12 V2.1 (105 total)

---

## What's Out of Scope (Explicitly)

These are things that could exist but are intentionally excluded:

- Authentication / login (single user, local data, no need)
- Multi-user / team features
- Cloud deployment (local-first; AWS migration path preserved in architecture but not built)
- CI/CD pipelines
- Built-in AI/ML (Smart Upload generates prompts for external AI tools; no embedded AI)
- Time tracking / hours logging
- Calendar integration
- Email notifications or reminders (catch-up prompt is in-app only)
- Mobile-specific UI (responsive is sufficient)
- DOCX export (PDF + clipboard covers the use case)
- Automated data sync with Asana/Taskei/other tools

---

## Technical Scope

### Backend (Python FastAPI)

API surface — estimated routes:

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/health | Health check |
| POST | /api/entries | Create entry (quick or full) |
| GET | /api/entries | List entries (with filters: date range, type, project, tags, status, work_type, search) |
| GET | /api/entries/{id} | Get single entry |
| PUT | /api/entries/{id} | Update entry |
| DELETE | /api/entries/{id} | Delete entry |
| PUT | /api/entries/{id}/highlight | Toggle weekly highlight |
| PUT | /api/entries/{id}/accomplishment | Toggle accomplishment flag |
| PUT | /api/entries/{id}/lesson-learned | Toggle lesson learned flag |
| POST | /api/projects | Create project |
| GET | /api/projects | List projects (with filters) |
| GET | /api/projects/{id} | Get project with linked entries |
| PUT | /api/projects/{id} | Update project |
| DELETE | /api/projects/{id} | Delete project |
| POST | /api/goals | Create goal |
| GET | /api/goals | List goals (with FY/quarter filter) |
| GET | /api/goals/{id} | Get goal with progress log + linked projects |
| PUT | /api/goals/{id} | Update goal |
| DELETE | /api/goals/{id} | Delete goal |
| POST | /api/goals/{id}/progress | Add progress log entry |
| POST | /api/lessons | Create lesson |
| GET | /api/lessons | List lessons (with filters) |
| GET | /api/lessons/{id} | Get single lesson |
| PUT | /api/lessons/{id} | Update lesson |
| DELETE | /api/lessons/{id} | Delete lesson |
| GET | /api/tags | List all tags |
| POST | /api/tags | Create tag |
| PUT | /api/tags/{id} | Rename tag |
| DELETE | /api/tags/{id} | Delete tag |
| POST | /api/links | Add URL link to any entity |
| DELETE | /api/links/{id} | Remove URL link |
| GET | /api/dashboard | Dashboard stats (entries count, active projects, goal status, last entry date, gaps) |
| GET | /api/settings | Get all settings |
| PUT | /api/settings | Update settings (batch key-value) |
| POST | /api/export | Generate export (template type, date range, filters) → returns markdown |
| POST | /api/data/export | Full database export → JSON file |
| POST | /api/data/import | Full database import from JSON |
| POST | /api/data/seed | Initial data seed import |
| POST | /api/review-sessions | Create review session (log a completed review) |
| GET | /api/review-sessions | List review sessions |
| GET | /api/review-sessions/{id} | Get review session with notes |
| POST | /api/review-notes | Create review note (session-level or entity-linked) |

Estimated: ~42 routes

### Frontend (React 19 + Vite + TypeScript)

- 11 views (Dashboard, Capture Entry modal, Entry Form, Timeline, Projects, Goals, Lessons Learned, Review, Data, Settings, About modal) + ReviewModal, ExportPreview, ExportPDF, CopyModal, SmartUpload components
- Sidebar navigation: SYSTEM (Dashboard, Timeline, Projects, Goals) + TOOLS (Review, Lessons, Data, Settings)
- CSS variables for all theming (no hardcoded colors)
- Executive slate design system (light/dark mode, Inter font stack)
- Smart Parse engine (smartParse.ts) for export categorization
- Upload Parser (uploadParser.ts) for Smart Upload data ingestion
- PDF export via @react-pdf/renderer (client-side)
- Vite dev proxy (/api/* → localhost:8180)

### Database (SQLite)

- 16 tables: entries, projects, goals, goal_progress_log, project_progress_log, lessons_learned, tags, entry_tags, lesson_tags, links, attachments, settings, review_sessions, review_notes, stakeholders, project_stakeholders
- 16 tables total
- WAL journal mode (same as V6)
- Single file: data/chronicle.db
- Cascade deletes where appropriate (delete project → unlink entries, not delete them)

### Dependencies (Estimated)

Backend:
- fastapi, uvicorn (API framework)
- pydantic (data validation)
- python-multipart (if needed for file import)
- config.py for environment variable configuration
- No pandas, no openpyxl — this app doesn't process Excel files

Frontend:
- react, react-dom (UI)
- vite, typescript (build)
- @react-pdf/renderer (client-side PDF generation)
- No additional UI libraries — custom executive slate components

---

## Complexity Assessment

### What's Simple (Known Patterns from V6)

- FastAPI + SQLite backend (same stack, same patterns)
- React + Vite + TypeScript frontend (same stack)
- Sidebar navigation
- CRUD operations for all entities
- Executive slate CSS (CSS variables, light/dark mode)
- Vite proxy config
- start.bat launcher
- Database initialization and schema creation

### What's Moderately Complex

- Dashboard aggregation queries (stats across entries, projects, goals with date math)
- Export template engine (filtering, grouping, formatting entries into structured markdown)
- Timeline view with multi-field filtering and full-text search
- Managed tag system with autocomplete and junction tables
- Catch-up prompt logic (gap detection, backfill shortcuts)
- Settings persistence with first-launch wizard flow
- Fiscal year / quarter calculation based on configurable start month
- Review session workflow with adaptive format based on date range scope

### What's New (Not in V6)

- SMART goal data model with progress log (V6 had no goal concept)
- Two-mode capture (quick vs. full — V6 had one input flow)
- Export template rendering with preview (V6 exported Excel; this exports markdown)
- Full database backup/restore as JSON (V6 didn't have this)
- Initial data seed import (V6 started empty)
- Work type distinction (project vs. operational rhythm — new mental model)
- Highlight/pin feature (V6 didn't have curation)
- URL links as a polymorphic entity (parent_type + parent_id pattern)
- Review sessions with item modals, review notes, and action item creation (no equivalent in V6)

---

## Build Estimate

Based on V6 patterns and the feature inventory:

- Backend: ~42 API routes across 8 entity types (6 original + review-sessions + review-notes) + dashboard + export + data management. Moderate-to-high complexity. The export engine and review session workflow are the most involved backend pieces.
- Frontend: 11 views + modals + components (ExportPDF, CopyModal, SmartUpload, ExportPreview), custom executive slate component set, Smart Parse engine, Upload Parser, @react-pdf/renderer. The Dashboard and Review views are the heaviest — Review combines metrics, item modals, notes, action item creation, Smart Parse, PDF export, and copy-for-export in one workflow.
- Database: 16 tables, straightforward relational schema. Migration from V6 patterns is clean.
- Theme: Executive slate design system with CSS variables. Light mode default, dark mode toggle.

Estimated build: This is roughly 1.5–2x the V6 Audit App in feature count, but the patterns are established. The new complexity is in the review session workflow (adaptive format, item modals, review notes, action items), the export engine, goal management, and the two-mode capture flow.

---

## Risk & Considerations

1. Export quality: The export templates need to produce output that's genuinely useful when pasted into Kiro/Q for polishing. If the structure is wrong, the intermediate step adds friction instead of removing it. Mitigation: test exports against real data early.

2. Tag sprawl: Even with a managed list, tags can proliferate. Mitigation: ship with a curated default set, make the tag manager easy to access, and show tag usage counts so unused tags are visible.

3. Retroactive entry fatigue: The initial data seed is critical. If the app launches empty, the "catch up" burden is high and adoption drops. Mitigation: build the seed script as part of V1, not as a follow-up.

4. Scope size: 74 features in one build is ambitious. The V6 app was simpler. Mitigation: the build methodology's slice approach will break this into manageable chunks. Most features are CRUD variations on the same patterns. The review features (66–74) add a new workflow layer but reuse existing entity data.

5. Export as intermediate artifact: Since exports go to AI for polishing, the format needs to be AI-friendly (clean markdown, clear structure, no ambiguous formatting). Mitigation: design templates with AI consumption in mind — labeled sections, consistent structure, explicit context.

---

## Parity Verification

All 16 CONCEPT.md V1 features accounted for:

1. ✅ Quick Capture mode → Features 1, 29
2. ✅ Full Entry mode → Features 2–8, 30
3. ✅ Project tracking → Features 9–13, 32
4. ✅ SMART Goals with progress logs → Features 14–19, 33
5. ✅ Lessons Learned → Features 20–24, 34
6. ✅ Operational Rhythm distinction → Feature 4, 46
7. ✅ Dashboard with stats, catch-up, highlight → Features 25–28
8. ✅ Timeline view → Feature 31
9. ✅ Export templates (via Review) → Features 39–46, 35
10. ✅ Settings/Setup wizard → Features 51–55, 36
11. ✅ URL links → Features 56–59
12. ✅ Database backup/restore → Features 47–48
13. ✅ Initial data seed → Feature 49
14. ✅ Managed tag list → Feature 50
15. ✅ Win of the Week / Highlight → Feature 28
16. ✅ Review & 1:1 Prep → Features 66–74

All CONCEPT.md success criteria mapped:

- ✅ "Capture a quick note in under 10 seconds" → Quick Capture view (Feature 29)
- ✅ "Create a full entry in under 2 minutes" → Entry Form view (Feature 30)
- ✅ "Generate a leadership update in under 30 seconds" → Review view with export (Feature 35, 66–74)
- ✅ "Answer 'what did I do in Q1?' in under 5 seconds" → Timeline filters (Feature 31)
- ✅ "Distinguish project work and operational rhythm" → Work type field (Feature 4)
- ✅ "Seed initial data from Work Context Document" → Seed import (Feature 49)
- ✅ "Back up and restore full database" → JSON export/import (Features 47–48)
- ✅ "Hand app to colleague, they configure for themselves" → Settings wizard (Feature 51)

---

Stage 1 complete. Ready for Stage 2 (Architecture) on your call.
