"""
Chronicle MCP Server
====================
A Model Context Protocol server that provides structured access to the
Chronicle professional narrative database. Designed as a sidecar to the
Chronicle desktop app — both read/write the same chronicle.db file.

This server is schema-resilient: it reads table structure dynamically
on startup and validates inputs against actual CHECK constraints.

Usage:
    python chronicle_mcp.py [--db-path PATH_TO_CHRONICLE_DB]

Environment:
    CHRONICLE_DB_PATH  — path to chronicle.db (overrides --db-path)
"""

import argparse
import json
import os
import re
import sqlite3
from datetime import datetime
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Server setup
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "Chronicle",
    description="Professional narrative database — entries, projects, goals, tasks, programs, and progress logs.",
)

DB_PATH: str = ""


def _resolve_db_path(cli_path: str | None = None) -> str:
    """Resolve the chronicle.db path from env, CLI arg, or default."""
    if os.environ.get("CHRONICLE_DB_PATH"):
        return os.environ["CHRONICLE_DB_PATH"]
    if cli_path:
        return cli_path
    # Default: look in Chronicle Data relative to workspace
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "..", "Chronicle Data", "chronicle.db"),
        os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Chronicle", "chronicle.db"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    raise FileNotFoundError("Cannot find chronicle.db. Set CHRONICLE_DB_PATH or pass --db-path.")


def _get_conn() -> sqlite3.Connection:
    """Get a connection to the Chronicle database."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ---------------------------------------------------------------------------
# Schema introspection (resilience layer)
# ---------------------------------------------------------------------------

_SCHEMA_CACHE: dict[str, Any] = {}


def _load_schema() -> dict[str, Any]:
    """Load full schema from the database — tables, columns, constraints."""
    if _SCHEMA_CACHE:
        return _SCHEMA_CACHE

    conn = _get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
    tables = {}
    for name, sql in cursor.fetchall():
        # Extract columns
        cursor.execute(f"PRAGMA table_info([{name}])")
        columns = {row["name"]: {
            "type": row["type"],
            "notnull": bool(row["notnull"]),
            "default": row["dflt_value"],
            "pk": bool(row["pk"]),
        } for row in cursor.fetchall()}

        # Extract CHECK constraints from CREATE TABLE sql
        checks = {}
        if sql:
            # Match patterns like: column_name TEXT ... CHECK (column_name IN ('a', 'b'))
            for match in re.finditer(
                r"(\w+)\s+\w+[^,]*?CHECK\s*\(\s*\1\s+IN\s*\((.*?)\)\s*\)",
                sql, re.IGNORECASE | re.DOTALL
            ):
                col = match.group(1)
                vals = [v.strip().strip("'\"") for v in match.group(2).split(",")]
                checks[col] = vals

        tables[name] = {"columns": columns, "checks": checks}

    conn.close()
    _SCHEMA_CACHE.update(tables)
    return _SCHEMA_CACHE


def _validate_enum(table: str, column: str, value: str) -> str | None:
    """Validate a value against CHECK constraints. Returns error message or None."""
    schema = _load_schema()
    if table not in schema:
        return f"Unknown table: {table}"
    checks = schema[table].get("checks", {})
    if column in checks and value not in checks[column]:
        return f"Invalid {column}: '{value}'. Must be one of: {checks[column]}"
    return None


def _dict_from_row(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


# ---------------------------------------------------------------------------
# Tool: Schema Discovery
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_schema() -> str:
    """Get the full Chronicle database schema — tables, columns, types, and valid enum values.
    Use this to understand what fields are available before creating or updating records."""
    schema = _load_schema()
    result = {}
    for table, info in schema.items():
        if table == "sqlite_sequence":
            continue
        result[table] = {
            "columns": {col: meta["type"] for col, meta in info["columns"].items()},
            "enums": info["checks"],
        }
    return json.dumps(result, indent=2)


# ---------------------------------------------------------------------------
# Tool: Flexible Query (read-only)
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_query(sql: str) -> str:
    """Execute a read-only SQL query against the Chronicle database.
    Only SELECT statements are allowed. Use for complex queries, joins, or
    searches that don't fit the other tools. Returns JSON array of results.

    Args:
        sql: A SELECT SQL statement.
    """
    stripped = sql.strip().upper()
    if not stripped.startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed. Use other tools for writes."})

    conn = _get_conn()
    try:
        cursor = conn.execute(sql)
        rows = [_dict_from_row(r) for r in cursor.fetchall()]
        return json.dumps(rows, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tool: Projects
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_projects(
    program_id: int | None = None,
    status: str | None = None,
    search: str | None = None,
) -> str:
    """List projects, optionally filtered by program, status, or name search.

    Args:
        program_id: Filter by program ID.
        status: Filter by status (planning, active, completed, paused).
        search: Search project names (case-insensitive substring match).
    """
    conn = _get_conn()
    query = "SELECT * FROM projects WHERE 1=1"
    params: list = []
    if program_id is not None:
        query += " AND program_id = ?"
        params.append(program_id)
    if status:
        err = _validate_enum("projects", "status", status)
        if err:
            return json.dumps({"error": err})
        query += " AND status = ?"
        params.append(status)
    if search:
        query += " AND name LIKE ?"
        params.append(f"%{search}%")
    query += " ORDER BY id"
    rows = [_dict_from_row(r) for r in conn.execute(query, params).fetchall()]
    conn.close()
    return json.dumps(rows, indent=2, default=str)


@mcp.tool()
def chronicle_get_project(project_id: int) -> str:
    """Get full detail for a single project including its progress logs.

    Args:
        project_id: The project ID.
    """
    conn = _get_conn()
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Project {project_id} not found"})
    project = _dict_from_row(row)
    logs = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM project_progress_log WHERE project_id = ? ORDER BY created_at", (project_id,)
    ).fetchall()]
    project["progress_logs"] = logs
    entries = [_dict_from_row(r) for r in conn.execute(
        "SELECT id, entry_date, title, status, is_accomplishment FROM entries WHERE project_id = ? ORDER BY entry_date", (project_id,)
    ).fetchall()]
    project["entries"] = entries
    conn.close()
    return json.dumps(project, indent=2, default=str)


@mcp.tool()
def chronicle_create_project(
    name: str,
    description: str | None = None,
    status: str = "active",
    start_date: str | None = None,
    target_end_date: str | None = None,
    goal_id: int | None = None,
    program_id: int | None = None,
    is_accomplishment: bool = False,
) -> str:
    """Create a new project.

    Args:
        name: Project name.
        description: Project description.
        status: Project status (planning, active, completed, paused).
        start_date: Start date (YYYY-MM-DD).
        target_end_date: Target end date (YYYY-MM-DD).
        goal_id: Associated goal ID.
        program_id: Associated program ID.
        is_accomplishment: Whether this project is starred as an accomplishment.
    """
    err = _validate_enum("projects", "status", status)
    if err:
        return json.dumps({"error": err})
    conn = _get_conn()
    cursor = conn.execute(
        """INSERT INTO projects (name, description, status, start_date, target_end_date, goal_id, program_id, is_accomplishment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, description, status, start_date, target_end_date, goal_id, program_id, int(is_accomplishment)),
    )
    conn.commit()
    project_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": project_id, "message": f"Project '{name}' created"})


@mcp.tool()
def chronicle_update_project(project_id: int, **fields) -> str:
    """Update one or more fields on a project. Pass only the fields you want to change.

    Args:
        project_id: The project ID to update.
        **fields: Any project column to update (name, description, status, start_date,
                  target_end_date, actual_end_date, goal_id, program_id, metrics, is_accomplishment).
    """
    if not fields:
        return json.dumps({"error": "No fields provided to update"})

    # Validate enums
    if "status" in fields:
        err = _validate_enum("projects", "status", fields["status"])
        if err:
            return json.dumps({"error": err})

    schema = _load_schema()
    valid_cols = set(schema.get("projects", {}).get("columns", {}).keys()) - {"id", "created_at"}
    invalid = set(fields.keys()) - valid_cols
    if invalid:
        return json.dumps({"error": f"Invalid columns: {invalid}. Valid: {valid_cols}"})

    fields["updated_at"] = datetime.now().isoformat(sep=" ", timespec="seconds")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [project_id]

    conn = _get_conn()
    conn.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"message": f"Project {project_id} updated", "fields": list(fields.keys())})


# ---------------------------------------------------------------------------
# Tool: Goals
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_goals(program_id: int | None = None, status: str | None = None) -> str:
    """List goals, optionally filtered by program or status.

    Args:
        program_id: Filter by program ID.
        status: Filter by status (on_track, at_risk, behind, completed, paused).
    """
    conn = _get_conn()
    query = "SELECT * FROM goals WHERE 1=1"
    params: list = []
    if program_id is not None:
        query += " AND program_id = ?"
        params.append(program_id)
    if status:
        err = _validate_enum("goals", "status", status)
        if err:
            return json.dumps({"error": err})
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY id"
    rows = [_dict_from_row(r) for r in conn.execute(query, params).fetchall()]
    conn.close()
    return json.dumps(rows, indent=2, default=str)


@mcp.tool()
def chronicle_get_goal(goal_id: int) -> str:
    """Get full detail for a single goal including progress logs and linked projects.

    Args:
        goal_id: The goal ID.
    """
    conn = _get_conn()
    row = conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Goal {goal_id} not found"})
    goal = _dict_from_row(row)
    goal["progress_logs"] = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM goal_progress_log WHERE goal_id = ? ORDER BY created_at", (goal_id,)
    ).fetchall()]
    goal["projects"] = [_dict_from_row(r) for r in conn.execute(
        "SELECT id, name, status, target_end_date FROM projects WHERE goal_id = ? ORDER BY id", (goal_id,)
    ).fetchall()]
    conn.close()
    return json.dumps(goal, indent=2, default=str)


@mcp.tool()
def chronicle_update_goal(goal_id: int, **fields) -> str:
    """Update one or more fields on a goal. Pass only the fields you want to change.

    Args:
        goal_id: The goal ID to update.
        **fields: Any goal column to update (title, description, specific, measurable,
                  achievable, relevant, time_bound, fiscal_year, quarter, status,
                  target_date, is_accomplishment, program_id).
    """
    if not fields:
        return json.dumps({"error": "No fields provided to update"})
    if "status" in fields:
        err = _validate_enum("goals", "status", fields["status"])
        if err:
            return json.dumps({"error": err})

    schema = _load_schema()
    valid_cols = set(schema.get("goals", {}).get("columns", {}).keys()) - {"id", "created_at"}
    invalid = set(fields.keys()) - valid_cols
    if invalid:
        return json.dumps({"error": f"Invalid columns: {invalid}. Valid: {valid_cols}"})

    fields["updated_at"] = datetime.now().isoformat(sep=" ", timespec="seconds")
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [goal_id]

    conn = _get_conn()
    conn.execute(f"UPDATE goals SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"message": f"Goal {goal_id} updated", "fields": list(fields.keys())})


# ---------------------------------------------------------------------------
# Tool: Prep Notes
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_create_note(text: str) -> str:
    """Create a prep note for 1:1 topics, follow-up reminders, or communication prompts.

    Args:
        text: Note content.
    """
    if not text or not text.strip():
        return json.dumps({"error": "Note text cannot be empty"})
    conn = _get_conn()
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    cursor = conn.execute(
        "INSERT INTO notes (text, created_at) VALUES (?, ?)",
        (text.strip(), now),
    )
    conn.commit()
    note_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": note_id, "text": text.strip(), "created_at": now})


@mcp.tool()
def chronicle_list_notes() -> str:
    """List all active (non-dismissed) prep notes, ordered by newest first."""
    conn = _get_conn()
    rows = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM notes WHERE dismissed_at IS NULL ORDER BY created_at DESC"
    ).fetchall()]
    conn.close()
    return json.dumps(rows, indent=2, default=str)


@mcp.tool()
def chronicle_dismiss_note(note_id: int) -> str:
    """Dismiss a prep note by ID (soft-delete — sets dismissed_at timestamp).

    Args:
        note_id: The note ID to dismiss.
    """
    conn = _get_conn()
    row = conn.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Note {note_id} not found"})
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    conn.execute("UPDATE notes SET dismissed_at = ? WHERE id = ?", (now, note_id))
    conn.commit()
    conn.close()
    return json.dumps({"id": note_id, "status": "dismissed"})


# ---------------------------------------------------------------------------
# Tool: Report Drafts
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_create_report_draft(
    title: str,
    content: str,
    preset_id: int | None = None,
    date_range_start: str | None = None,
    date_range_end: str | None = None,
) -> str:
    """Create a new report draft.

    Args:
        title: Draft title.
        content: Draft content (markdown text).
        preset_id: Optional link to a report preset ID.
        date_range_start: Start of date range covered (YYYY-MM-DD).
        date_range_end: End of date range covered (YYYY-MM-DD).
    """
    if not title or not title.strip():
        return json.dumps({"error": "Title cannot be empty"})
    if not content or not content.strip():
        return json.dumps({"error": "Content cannot be empty"})
    conn = _get_conn()
    now = datetime.now().isoformat(sep=" ", timespec="seconds")
    cursor = conn.execute(
        """INSERT INTO report_drafts (title, content, status, preset_id, date_range_start, date_range_end, created_at, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)""",
        (title.strip(), content.strip(), preset_id, date_range_start, date_range_end, now, now),
    )
    conn.commit()
    draft_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": draft_id, "title": title.strip(), "status": "draft"})


@mcp.tool()
def chronicle_list_report_drafts() -> str:
    """List all report drafts, ordered by most recently updated first."""
    conn = _get_conn()
    rows = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM report_drafts ORDER BY updated_at DESC"
    ).fetchall()]
    conn.close()
    return json.dumps(rows, indent=2, default=str)


@mcp.tool()
def chronicle_update_report_draft(
    draft_id: int,
    title: str | None = None,
    content: str | None = None,
    status: str | None = None,
) -> str:
    """Update a report draft's title, content, or status.

    Args:
        draft_id: The report draft ID.
        title: New title (optional).
        content: New content (optional).
        status: New status — must be one of: draft, ready, sent (optional).
    """
    updates: dict[str, Any] = {}
    if title is not None:
        updates["title"] = title.strip()
    if content is not None:
        updates["content"] = content.strip()
    if status is not None:
        err = _validate_enum("report_drafts", "status", status)
        if err:
            return json.dumps({"error": err})
        updates["status"] = status
    if not updates:
        return json.dumps({"error": "No fields provided to update"})

    conn = _get_conn()
    row = conn.execute("SELECT id FROM report_drafts WHERE id = ?", (draft_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Report draft {draft_id} not found"})

    updates["updated_at"] = datetime.now().isoformat(sep=" ", timespec="seconds")
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [draft_id]
    conn.execute(f"UPDATE report_drafts SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"message": f"Report draft {draft_id} updated", "fields": list(updates.keys())})


@mcp.tool()
def chronicle_delete_report_draft(draft_id: int) -> str:
    """Permanently delete a report draft.

    Args:
        draft_id: The report draft ID to delete.
    """
    conn = _get_conn()
    row = conn.execute("SELECT id FROM report_drafts WHERE id = ?", (draft_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Report draft {draft_id} not found"})
    conn.execute("DELETE FROM report_drafts WHERE id = ?", (draft_id,))
    conn.commit()
    conn.close()
    return json.dumps({"id": draft_id, "status": "deleted"})
