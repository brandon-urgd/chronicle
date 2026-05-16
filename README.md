# Chronicle

Professional narrative system — capture daily work, link to goals, generate structured reports.

Chronicle closes the gap between "I did stuff" and "here's what I did, why it mattered, and what it achieved." It captures daily work entries, manages projects linked to SMART goals with stakeholders, tracks action items, and generates structured exports for leadership updates, self-reviews, and status reports.

## Features

- **Daily entries** with tagging, file attachments, and promotion to projects
- **Three-layer hierarchy** — Entries → Projects → Goals with bidirectional linking
- **SMART goal tracking** with stakeholder management and progress indicators
- **Action items** with status, priority, and due dates
- **Four export templates** — query by date range, render structured markdown, export to PDF or clipboard
- **Scheduled items** — recurring tasks and reminders
- **Light/dark mode** with responsive design
- **MCP server integration** — AI-assisted reporting, weekly updates, manager 1:1 prep

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Frontend (React 19 + Vite)              │
│         TypeScript · 10 views · CSS Modules         │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────────┐
│              Backend (Python FastAPI)                │
│           75+ routes · Pydantic validation          │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              Database (SQLite + WAL)                 │
│    20 tables · cascade deletes · junction tables    │
│    polymorphic links · file attachments             │
└─────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript (strict), Vite, CSS Modules |
| Backend | Python 3.12, FastAPI, Pydantic |
| Database | SQLite with WAL journaling (20 tables) |
| PDF Export | @react-pdf/renderer with Smart Parse pipeline |
| Testing | 350+ tests including Hypothesis property-based testing |
| MCP | Custom MCP server for IDE integration |

## Data Model

Three-layer hierarchy with promotion flow:

- **Entries** — daily work log items (what you did, tagged by category)
- **Projects** — groups of related work with stakeholders and status
- **Goals** — SMART goals that projects roll up into, with progress tracking

Supporting entities: action items, scheduled items, file attachments, tags, stakeholders, and four export template types.

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 22+

### Install

```bash
# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
```

### Run

```bash
# Start backend (port 8000)
cd backend
uvicorn main:app --reload

# Start frontend (port 5173)
cd frontend
npm run dev
```

Open `http://localhost:5173` — the app runs entirely on your machine. No cloud account needed.

## Design Philosophy

Chronicle is a **local-first** application. Your data stays on your machine in a SQLite database. No accounts, no subscriptions, no cloud dependency.

The architecture is designed for optional AWS migration without rewriting logic:
- SQLite → DynamoDB
- FastAPI → API Gateway + Lambda
- React → CloudFront + S3
- File attachments → S3

## Testing

```bash
# Run all backend tests
cd backend
pytest

# With coverage
pytest --cov=. --cov-report=html
```

350+ tests covering API routes, data model integrity, export generation, and edge cases. Includes Hypothesis property-based tests for fuzzy input validation.

## License

MIT

---

*Built by [ur/gd Studios](https://urgdstudios.com)*
