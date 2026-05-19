# CONCEPT.md — CHRONICLE

Professional Narrative System
Stage 0 — Conceptual
Date: March 31, 2026
Author: Brandon Hill-Rogers

---

## Core Idea

CHRONICLE is a Professional Narrative System — a "library of you" tied to date ranges. It captures daily work, projects, accomplishments, lessons learned, milestones, SMART goals, and structured review sessions in one local-first browser app. The end goal: communicate your value to leadership with one click, review your own performance on your own terms, and keep a living record of your professional narrative that builds over time.

Capture your work. Communicate your impact.

This is not a replacement for Asana, Taskei, or any project management tool. It's the personal narrative layer on top of whatever tracking tools exist. It answers the question every professional dreads at review time: "What did I actually do this quarter?" And when it's time for a 1:1, self-assessment, or leadership update, the Review session pulls everything together — metrics, entries, goals, lessons — so you can reflect, annotate, create action items, and export in one sitting.

## Who It's For

Single user. No authentication. Data lives on your local machine. But the app is portable — no hardcoded identity. A Settings/Setup screen lets you configure name, role, org, fiscal year start, etc. Copy the folder to a colleague and they start fresh with their own config.

## Why It Matters

- Self-reviews and leadership updates require structured recall across months of work
- Daily operational work is invisible at review time — you do it every day so it feels routine, but it's a huge chunk of your value
- The gap between "I did stuff" and "here's what I did" is usually hours of archaeology through emails, docs, and memory
- CHRONICLE closes that gap by capturing as you go, reviewing on your schedule, and exporting on demand

## Tech Stack & Architecture Pattern

Same local-first pattern as Irregular Audit App V6:

- Frontend: React 19 + Vite + TypeScript
- Backend: Python FastAPI + Uvicorn
- Database: SQLite (single file, portable)
- Theme: Executive slate design system, light/dark mode, Inter font stack
- No auth, no cloud dependencies — runs entirely on localhost
- AWS migration path preserved (same V6 translation: SQLite→DynamoDB, FastAPI→Lambda, React→CloudFront+S3)

```
Chronicle/
├── backend/
│   ├── main.py              # API routes
│   ├── database.py          # SQLite persistence
│   ├── models.py            # Pydantic models
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Root component, sidebar routing
│   │   ├── index.css        # Executive slate design system (light/dark)
│   │   ├── main.tsx         # React entry point
│   │   └── views/
│   │       ├── DashboardView.tsx
│   │       ├── QuickCaptureView.tsx
│   │       ├── EntryFormView.tsx
│   │       ├── TimelineView.tsx
│   │       ├── ProjectsView.tsx
│   │       ├── GoalsView.tsx
│   │       ├── LessonsLearnedView.tsx
│   │       ├── ReviewView.tsx
│   │       ├── SettingsView.tsx
│   │       └── AboutModal.tsx
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── data/
│   ├── chronicle.db         # SQLite database
│   └── exports/             # Generated export files
├── start.bat
├── CONCEPT.md
└── ARCHITECTURE.md
```

## Two Capture Modes

### Quick Capture

Fast, low-friction. For notes, call takeaways, small wins, observations. System date/time auto-applied. Minimal fields:

- Title (short headline)
- Note body (freeform text)
- Tags (autocomplete from managed list)
- Optional: link to a project

Think of it as a professional scratch pad that's searchable and exportable. You could use it to capture notes during a call, log a quick win, or jot down something you want to remember.

Quick Capture also supports a "to-do" toggle — flip it on and the capture becomes an action item with a due date, tracked on the Dashboard and completable from the Timeline. This bridges the gap between "I need to remember this" and "I need to do this."

### Full Entry

Structured, intentional. For projects, major work streams, AI development, operational initiatives. When you open it, you categorize what you're doing so it falls into clean buckets:

- Entry date (defaults to today, allows backdating)
- Entry type: project_update, operational_rhythm, development, recognition, decision, milestone, action_item
- Title
- Description (markdown-capable)
- Impact ("so what" — who benefited, what changed)
- Metrics (optional — quantifiable: "saved 40 hrs/month", "reduced errors by 30%")
- Project association (dropdown of active projects)
- Tags (autocomplete from managed list, on-the-fly creation allowed)
- Status: in_progress, completed, ongoing, paused
- Visibility: personal / shareable (controls what shows up in exports)

When you close out a project or complete a body of work, you can tag entries as "Accomplishment" and/or "Lesson Learned" — these tags feed directly into export templates.

## Operational Rhythm vs. Project Work

This is a first-class distinction in CHRONICLE, not just a tag. The mental model matters:

- Project Work: has a start, an end, and deliverables. feature builds, documentation projects, tool development. These show up as discrete accomplishments.
- Operational Rhythm: recurring, ongoing, never "done." Daily reviews, weekly syncs, monthly business reviews, recurring assessments. This is the work that's invisible at review time but represents a massive chunk of value.

Both show up on the dashboard and in exports, but they're visually and categorically distinct. Operational rhythm entries accumulate into a narrative of sustained contribution. Project entries tell the story of discrete impact.

## SMART Goals

Goals are a first-class entity. Structured using the SMART framework:

- Specific: What exactly will be accomplished
- Measurable: How you'll know it's done (quantifiable criteria)
- Achievable: Why it's realistic given current resources
- Relevant: How it connects to broader objectives
- Time-bound: Deadline or target date

Goal features:
- Established at any time (typically beginning of fiscal year)
- Editable — title, description, SMART fields, status, target dates
- Progress log — each meaningful update gets a timestamped entry (progress notes, roadblocks, pivots, completions). Not full revision history, but a running log of what happened and when.
- Status: on_track, at_risk, behind, completed, paused
- Fiscal year and quarter association
- Linked projects and entries (which work maps to which goal)

## Lessons Learned

Separate from entry tagging. A dedicated Lessons Learned section for capturing insights from specific events, seasons, or work streams:

- Title
- Context (what happened — the situation)
- Lesson (what was learned)
- Application (how this changes future behavior)
- Source: linked entry, project, or freeform reference
- Date range (e.g., "Peak 2025" or "Q1 2026 CADRE rollout")
- Tags

This is where things like "High Volume Season lessons" or "what I learned from the first 3 months of CADRE" live. They're exportable as a standalone section in self-reviews.

## Settings / Setup

No hardcoded identity. Everything configurable:

- Name, role, title, organization
- Manager name (for export headers)
- Fiscal year start month (configurable — default January)
- Managed tag list (predefined categories, editable)
- Export preferences (default template, default filters)
- Theme preferences (future: if we ever want light mode)

Settings persist in the database. First launch shows a setup wizard to configure basics before you start.

## Views & Modals

### Dashboard (Landing Page)

At-a-glance view of your professional state:

- Stat cards: entries this week / month / quarter, active projects, goals on track vs. at risk (🟢🟡🔴), days since last entry
- Catch-up prompt: if 3+ days since last entry, surface a "catch up" view showing calendar gaps with backfill shortcuts
- Recent entries feed (last 10, with type icons and tags)
- Highlight / Win of the Week: pinned entry you'd lead with if someone asked "what did you do this week?"
- Quick action buttons: New Quick Capture, New Full Entry, Start Review
- Active projects with progress indicators
- Operational rhythm summary (what recurring work happened this period)

### Quick Capture View

Minimal input surface. Opens fast, saves fast:

- Title field
- Note body (text area)
- Tags (autocomplete chips)
- Optional project link
- Save button (auto-timestamps with system date/time)
- Recent quick captures list below the form

### Entry Form View (Full Entry)

The structured input surface for substantive entries. All fields described in the Full Entry section above. Includes:

- Save, Save & New (for batch entry sessions)
- Edit mode for existing entries
- "Tag as Accomplishment" / "Tag as Lesson Learned" actions available on completed entries

### Timeline View

The "library of you" — chronological view of all entries:

- Vertical timeline layout
- Filter bar: date range, entry type, project, tags, status, work type (project vs. operational rhythm)
- Each entry: date, type icon, title, first line of description, tags
- Click to expand inline or open edit modal
- Color coding by entry type
- Full-text search across all entries

### Projects View

Project-centric grouping:

- Card layout, one card per project
- Each card: name, status badge, date range, entry count, goal alignment, last updated
- Click into a project to see linked entries as a mini-timeline
- Create/edit project modal
- Close out project with accomplishment/lesson learned tagging

### Goals View

SMART goal management:

- Goal cards with status indicators (🟢🟡🔴)
- Each card: title, status, target date, progress summary, linked projects count
- Click into a goal for full SMART breakdown + progress log
- Add/edit goals
- Add progress log entries (timestamped notes)
- Fiscal year / quarter filtering

### Lessons Learned View

Dedicated lessons repository:

- List or card view
- Filter by date range, source project, tags
- Each lesson: title, context summary, lesson, application
- Create/edit lessons
- Link to source entries or projects

### Review View

The reflection and export hub — where you review a period of work, annotate it, and generate outputs.

Starting a review:
- Select a date range: weekly, monthly, quarterly, annual, or custom
- Review type selector determines the scope and default grouping

Review session surface:
- Dashboard-style metrics for the selected period (entries, projects touched, goals status, lessons captured)
- Tabbed or sectioned display of entries, projects, goals, and lessons that fall within the date range
- Click any item to open a detail modal (blurred background overlay) showing full content
- From the modal: view details, add review notes tied to that item, create action items (saved as entries with entry_type "action_item" and entry_date as target/due date)
- General session notes field for free-form review commentary not tied to a specific item
- "Log Review" button saves the session as a permanent record (review_sessions table) with all associated review notes

Browsing past reviews:
- List of previously logged review sessions, filterable by review type and date range
- Click into a past review to see the session notes, review notes, and what was covered

Export (integrated into Review):
- Template selector: Leadership Update, Self-Review, Weekly Summary
- Filters: by project, tags, entry type, visibility (defaults to "shareable" only), work type
- Preview pane — shows formatted output before generating
- Export actions: clipboard copy, download as Markdown (.md)
- Win of the Week highlighted in weekly exports
- Leadership Update auto-groups by project/goal, accomplishments first, then in-progress, then lessons learned, metrics highlighted
- Self-Review format: organized by goal with accomplishments, impact, metrics, key decisions under each
- Operational rhythm gets its own section showing sustained contribution

Review is the hub for 1:1 prep, self-assessments, and generating exports. No separate Export tab — it all lives here.

### Settings View

Configuration screen (also serves as first-launch setup wizard):

- All fields from Settings section above
- Managed tag list editor (add/remove/rename)
- Data management: full database export (JSON), database import, archive fiscal year
- About / version info

### About Modal

Same pattern as V6 — app description, version, workflow overview.

## Data Model

### Core Tables (16 tables)

entries
- id, created_at, updated_at
- entry_date (when the work happened)
- entry_type: quick_capture | project_update | operational_rhythm | development | recognition | decision | milestone | action_item
- work_type: project | operational_rhythm (first-class distinction)
- title, description, impact, metrics
- project_id (FK, nullable)
- status: in_progress | completed | ongoing | paused
- visibility: personal | shareable
- is_accomplishment: boolean
- is_lesson_learned: boolean
- is_weekly_highlight: boolean

projects
- id, created_at, updated_at
- name, description
- start_date, target_end_date, actual_end_date
- status: planning | active | completed | paused
- goal_id (FK, nullable)

goals
- id, created_at, updated_at
- title, description
- specific, measurable, achievable, relevant, time_bound (SMART fields)
- fiscal_year, quarter
- status: on_track | at_risk | behind | completed | paused
- target_date

goal_progress_log
- id, goal_id (FK), created_at
- note (what happened — progress, roadblock, pivot, completion)
- status_at_time (snapshot of goal status when log was written)

lessons_learned
- id, created_at, updated_at
- title, context, lesson, application
- source_entry_id (FK, nullable)
- source_project_id (FK, nullable)
- date_range_start, date_range_end
- date_range_label (e.g., "Peak 2025", "Q1 2026")

entry_tags (junction)
- entry_id (FK), tag_id (FK)

lesson_tags (junction)
- lesson_id (FK), tag_id (FK)

tags
- id, name, created_at

settings
- key, value (key-value store for all config)

links
- id, parent_type (entry | project | goal | lesson), parent_id
- url, label

review_sessions
- id, created_at
- review_date (when the review was logged)
- date_range_start, date_range_end
- review_type: weekly | monthly | quarterly | annual | custom
- session_notes (free-form review commentary)

review_notes
- id, review_session_id (FK), created_at
- parent_type: entry | project | goal | lesson (nullable — null means general session note)
- parent_id (nullable)
- note_text

### Predefined Tags (Ship With App)

Categories: accomplishment, lesson-learned, operational, project, ai-development, leadership, career-development, process-improvement, team-enablement, stakeholder-management, dispute, audit, reporting, strategic, quick-win

Users can add/remove/rename via Settings.

## Data Import

Two import paths:

1. Initial seed script: A one-time JSON import we build together. We take existing data from the Work Context Document (goals, projects, agent work, operational context) and structure it into CHRONICLE's schema. Run once to bootstrap the database with historical context.

2. Full database backup/restore: JSON export of the entire database for backup, migration to a new machine, or archiving a fiscal year. Import restores everything.

## Export Templates

### Leadership Update
```
# Performance Update — [Date Range]
## [Goal/Project Name]
- [Accomplishment]: [Title] — [Impact]. [Metrics if available].
- [In Progress]: [Title] — [Current status]. [Expected completion].
## Operational Contributions
- [Recurring work summary with volume/frequency context]
## Lessons Learned
- [Title]: [Key takeaway]
```

### Self-Review
```
# [FY] Self-Review — [Name]
## Goal 1: [Title]
### Accomplishments
- ...
### Impact & Metrics
- ...
### Key Decisions
- ...
## Operational Rhythm
- [Sustained contributions, volume, consistency]
```

### Weekly Summary
```
# Week of [Date] — [Name]
## Highlight of the Week
- [Pinned highlight entry]
## Completed
- ...
## In Progress
- ...
## Quick Notes
- [Quick captures from the week]
```

Note: Exports are accessed from within the Review view — not a standalone tab. They're designed to be intermediate artifacts. The expectation is they get pasted into an AI assistant for polishing before sending to leadership. They need to look good and be well-structured, but there's no AI built into CHRONICLE itself.

### ASANA Status Update (Punch List Addition)
```
# {Name} — Status Update ({Date Range})
{Role}, {Org}

## TL;DR
{2-3 sentence executive summary}

## What's On Track
- {Top 3-5 accomplishments with metrics, one line each}

## What Needs Attention
- {At-risk items, blockers, overdue action items — max 3}

## Key Decisions
- {Decisions made this period — max 3}

## Operational Rhythm
{Count} operational items completed. Highlights: {top 1-2}

## Next Steps
- [ ] {Open action items + in-progress work — max 5}
```

Designed for: ASANA status update paste, 5-8 minute read (~800-1200 words), AI polishing as intermediate step. Smart truncation caps each section to keep it scannable for leadership.

## Visual Design

- Background: #F9FAFB (light mode default), #111827 (dark mode)
- Component surfaces: clean white cards with subtle 1px borders (#E5E7EB)
- Primary accent: #2F3A4A (deep slate blue)
- Success accent: #3F7D58 (muted green)
- Typography: Inter (or system equivalent sans-serif), clear hierarchy
- Status indicators: 🟢🟡🔴 stoplight system consistent with existing operational outputs
- Entry type differentiation: visual by type (no decorative emojis)
- Cards: structured with subtle borders, minimal shadows — not floating
- Responsive: desktop-first but functional on tablet
- Design aesthetic: Stripe Dashboard / Linear / Notion (minimal mode)

## V1 Feature Set (All-In-One Build)

Everything listed above ships in V1. No phased rollout. Summary:

1. Quick Capture mode (fast, timestamped notes)
2. Full Entry mode (structured, categorized entries)
3. Project tracking with linked entries
4. SMART Goals with progress logs
5. Lessons Learned (dedicated section)
6. Operational Rhythm vs. Project Work distinction
7. Dashboard with stats, catch-up prompts, weekly highlight
8. Timeline view with filters and search
9. Review sessions (date range selection, metrics, item modals, review notes, action items, session logging)
10. Export templates via Review (Leadership Update, Self-Review, Weekly Summary)
11. Settings/Setup wizard (portable identity, managed tags, FY config)
12. Action items (created during reviews, tracked via entry status, due date via entry_date)
13. URL links on entries, projects, goals, lessons
14. Full database backup/restore (JSON)
15. Initial data seed import
16. Managed tag list with predefined categories
17. Win of the Week / Highlight pinning

## What CHRONICLE Is Not

- Not a project management tool (use Asana/Taskei for that)
- Not a time tracker (no hours logging)
- Not a team tool (single user, local data)
- Not an AI agent (Smart Upload generates prompts for external AI tools; exports are designed for AI polishing as an intermediate step)
- Not a replacement for operational reporting (PRISM, CADRE, MARGIN handle that)

## Stakeholders / Collaborators

Projects don't happen in isolation. CHRONICLE tracks who you worked with on each project:

- Name, email, role (e.g., "Technical Lead", "Stakeholder", "SME")
- Linked to projects via a junction table — one person can appear on multiple projects
- "People I've Worked With" summary view shows all collaborators with project counts
- Useful for self-reviews ("I partnered with X on Y") and networking documentation
- Stakeholders are included in database export/import for portability

## App Transfer

CHRONICLE is designed to be handed to a colleague:

- Run `setup_portable.bat` to bundle all dependencies (Python venv + node_modules) into the folder
- Export your data and reset the app (Settings → Data Management → Reset App)
- Copy the folder to a USB drive or shared location
- Recipient runs `start.bat`, completes the setup wizard, and they're running their own instance

## Success Criteria

- Can capture a quick note in under 10 seconds
- Can create a full entry with all fields in under 2 minutes
- Can generate a leadership update for any date range in under 30 seconds
- Can answer "what did I do in Q1?" with filters in under 5 seconds
- Can distinguish between project work and operational rhythm in exports
- Can seed initial data from existing Work Context Document
- Can back up and restore the full database
- Can hand the app folder to a colleague and they configure it for themselves
- Can start a review session, add notes, create action items, and log the review in under 5 minutes

---

Stage 0 complete. Ready for Stage 1 (Scoping) on your call.
