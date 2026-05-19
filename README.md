# Chronicle

Professional narrative system — capture your work, communicate your impact.

Chronicle is a native desktop application that captures daily work, organizes it under programs, goals, and projects, tracks tasks and operational cadence, and generates leadership-ready reports. Built for program managers who need to answer "what did I accomplish?" without hours of archaeology.

## Features

- **Dashboard** — daily command center with activity pulse, project-grouped tasks, prep notes, and upcoming work
- **Portfolio** — program → goal → project hierarchy with inline editing, bulk task completion, and close-out flows
- **Timeline** — chronological activity log with filtering, search, cadence overlay, and entry management
- **Time Distribution** — percentage breakdown of work by program/project over selectable periods with trend comparison
- **Reports** — status update and modular templates with PDF export, presets, and report drafts lifecycle
- **MCP Server** — AI-assisted reporting, weekly updates, and manager 1:1 prep via Model Context Protocol

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tauri Desktop Shell                       │
│              Window management · Lifecycle hooks             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────┐    ┌────────────────────────────┐ │
│  │   React Frontend    │    │     Rust Backend (axum)     │ │
│  │                     │◄──►│                            │ │
│  │  TypeScript · Vite  │REST│  ~95 API routes · tokio    │ │
│  │  10 views · CSS     │    │  Engines · Migrations      │ │
│  └─────────────────────┘    └─────────────┬──────────────┘ │
│                                           │                 │
│                              ┌────────────▼──────────────┐  │
│                              │   SQLite (rusqlite/r2d2)  │  │
│                              │   WAL mode · 21 tables    │  │
│                              └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Single-process architecture: Tauri shell + axum HTTP server + rusqlite — all in one binary. Sub-second startup, ~6 MB installer.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript (strict), Vite |
| Backend | Rust (axum 0.7, tokio, serde, rusqlite) |
| Database | SQLite with WAL mode, r2d2 connection pool |
| Desktop | Tauri 1.6 (single native binary) |
| PDF Export | @react-pdf/renderer (client-side generation) |
| AI Integration | Custom MCP server (Python) for IDE tooling |

## Data Model

Three-layer hierarchy with promotion flow:

```
Programs
  └── Goals (SMART framework, stakeholder tracking)
       └── Projects (status, close-out flows)
            └── Tasks → Entries (completing a task creates an entry)
```

Supporting entities: cadence schedules (recurring work), prep notes, report drafts, file attachments, tags, stakeholders, and links between any entities.

## Project Structure

```
chronicle/
├── frontend/                    # React 19 + TypeScript + Vite
│   └── src/
│       ├── views/               # 10 page-level views
│       ├── components/          # 20+ shared components
│       ├── hooks/               # Custom hooks (inline task, dirty close, focus trap)
│       ├── utils/               # API client, date utils, fiscal year, smart parse
│       └── styles/              # Shared style definitions, design tokens
├── src-tauri/                   # Rust backend + Tauri shell
│   └── src/
│       ├── server.rs            # Axum router, CORS, shared state
│       ├── routes/              # ~95 API route handlers
│       ├── models/              # Serde request/response structs
│       ├── db/                  # Pool, schema, migrations
│       └── engines/             # Scheduled engine, export engine
├── mcp-server/                  # MCP integration for AI assistants
│   ├── chronicle_mcp.py        # Full read-write tools
│   └── chronicle_readonly_mcp.py
├── scripts/                     # PDF generation, utilities
├── docs/                        # Architecture, requirements, design docs
└── ARCHITECTURE.md              # System architecture deep-dive
```

## Quick Start

### Prerequisites

- Rust toolchain (stable)
- Node.js 18+
- MSVC C++ Build Tools (Windows)

### Development

```bash
# Frontend
cd frontend
npm install
npm run dev

# Full app (Tauri dev mode with hot reload)
cd src-tauri
cargo tauri dev
```

### Build

```bash
# Produces native installer (.msi on Windows)
cargo tauri build
```

## Key Design Decisions

- **Local-first** — all data stays on your machine in SQLite. No accounts, no cloud dependency, no subscriptions.
- **Single binary** — Rust backend embedded in the Tauri process. No sidecar, no Python runtime, no extraction step.
- **Task/Entry unification** — tasks are the only input, entries are the only output. Completing a task is the sole mechanism for creating entries.
- **Port discovery** — backend probes ports 8180–8199, writes a `.port` file. Frontend and MCP server both read it.
- **Auto-backup on close** — Tauri close handler triggers backup before shutdown with 5-second timeout.
- **Graceful recovery** — if database init fails, app launches into Recovery Mode with restore/fresh/retry options.

## Version History

| Version | Date | Highlights |
|---------|------|-----------|
| 3.0.0 | May 2026 | Unified data model, time distribution view, recovery flow, file attachments |
| 2.5.0 | May 2026 | Rust backend rewrite (axum replaces Python/FastAPI), sub-second startup |
| 2.0.0 | May 2026 | UX overhaul — dashboard redesign, prep notes, report drafts, MCP server |
| 1.3.x | April 2026 | Architecture tightening, N+1 fixes, shared styles, code signing |
| 1.1.0 | April 2026 | Backup/restore, Tauri desktop packaging, property-based tests |
| 1.0.0 | March 2026 | Initial release |

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture, data flow, and technical decisions
- [docs/CONCEPT.md](./docs/CONCEPT.md) — product vision and problem statement
- [docs/BUILD_PLAN.md](./docs/BUILD_PLAN.md) — development plan and milestones
- [docs/V3_REQUIREMENTS.md](./docs/V3_REQUIREMENTS.md) — v3.0 requirements specification
- [docs/SCOPE.md](./docs/SCOPE.md) — feature scope and boundaries

## License

MIT

---

*Built by [ur/gd Studios](https://urgdstudios.com)*
