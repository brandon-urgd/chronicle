"""
Chronicle Read-Only MCP Server
================================
A read-only Model Context Protocol server for the Chronicle professional
narrative database. Designed for AI assistant integration via MCP.
— provides rich query access with zero write capability.

All tools are SELECT-only. No mutations, no deletions, no side effects.

Usage:
    python chronicle_readonly_mcp.py [--db-path PATH_TO_CHRONICLE_DB]

Environment:
    CHRONICLE_DB_PATH  — path to chronicle.db (overrides --db-path)
"""

import argparse
import json
import os
import re
import sqlite3
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Server setup
# ---------------------------------------------------------------------------

mcp = FastMCP(
    "Chronicle (Read-Only)",
    description=(
        "Read-only access to Brandon's Chronicle professional narrative database. "
        "Query entries, projects, goals, programs, scheduled items, stakeholders, "
        "and tags. No write operations available."
    ),
)

DB_PATH: str = ""


def _resolve_db_path(cli_path: str | None = None) -> str:
    """Resolve the chronicle.db path from env, CLI arg, or default."""
    if os.environ.get("CHRONICLE_DB_PATH"):
        return os.environ["CHRONICLE_DB_PATH"]
    if cli_path:
        return cli_path
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "..", "Chronicle Data", "chronicle.db"),
        os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Chronicle", "chronicle.db"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)
    raise FileNotFoundError("Cannot find chronicle.db. Set CHRONICLE_DB_PATH or pass --db-path.")


def _get_conn() -> sqlite3.Connection:
    """Get a read-only connection to the Chronicle database."""
    # Use file URI with mode=ro for true read-only at the SQLite level
    uri = f"file:{DB_PATH}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _dict_from_row(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a plain dict."""
    return dict(row)


def _rows_to_json(rows: list[sqlite3.Row]) -> str:
    """Convert list of Row objects to JSON string."""
    return json.dumps([_dict_from_row(r) for r in rows], indent=2, default=str)


def _safe_select(sql: str) -> bool:
    """Verify a SQL string is a safe SELECT (no mutations)."""
    stripped = sql.strip()
    # Remove leading comments
    while stripped.startswith("--") or stripped.startswith("/*"):
        if stripped.startswith("--"):
            stripped = stripped.split("\n", 1)[-1].strip()
        elif stripped.startswith("/*"):
            end = stripped.find("*/")
            stripped = stripped[end + 2:].strip() if end != -1 else ""
    upper = stripped.upper()
    # Block anything that isn't a SELECT or WITH ... SELECT
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        return False
    # Block dangerous keywords that could appear in CTEs or subqueries
    dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE",
                 "REPLACE", "ATTACH", "DETACH", "PRAGMA", "VACUUM", "REINDEX"]
    for kw in dangerous:
        # Match as whole word to avoid false positives (e.g. "UPDATED_AT")
        if re.search(rf"\b{kw}\b", upper):
            # Allow column/table names that contain these as substrings
            # but block standalone statements
            pattern = rf"(^|;|\s){kw}\s"
            if re.search(pattern, upper):
                return False
    return True


# ---------------------------------------------------------------------------
# Tool: Schema Discovery
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_schema() -> str:
    """Get the full Chronicle database schema — tables, columns, types, row counts,
    and valid enum values. Use this first to understand the data model."""
    conn = _get_conn()
    cursor = conn.cursor()

    cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
    tables_raw = cursor.fetchall()

    result = {}
    for name, sql in tables_raw:
        if name == "sqlite_sequence":
            continue

        # Columns
        cursor.execute(f"PRAGMA table_info([{name}])")
        columns = {row["name"]: row["type"] for row in cursor.fetchall()}

        # Row count
        cursor.execute(f"SELECT COUNT(*) as cnt FROM [{name}]")
        count = cursor.fetchone()["cnt"]

        # CHECK constraints (enum values)
        checks = {}
        if sql:
            for match in re.finditer(
                r"(\w+)\s+\w+[^,]*?CHECK\s*\(\s*\1\s+IN\s*\((.*?)\)\s*\)",
                sql, re.IGNORECASE | re.DOTALL,
            ):
                col = match.group(1)
                vals = [v.strip().strip("'\"") for v in match.group(2).split(",")]
                checks[col] = vals

        result[name] = {"columns": columns, "row_count": count, "enums": checks}

    conn.close()
    return json.dumps(result, indent=2)


# ---------------------------------------------------------------------------
# Tool: Flexible Read-Only Query
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_query(sql: str, limit: int = 100) -> str:
    """Execute a read-only SQL query against the Chronicle database.
    Only SELECT/WITH statements are allowed. Use for complex joins, searches,
    or anything the specialized tools don't cover.

    A LIMIT clause is auto-appended if not present (default 100).

    Args:
        sql: A SELECT or WITH...SELECT SQL statement.
        limit: Max rows to return (default 100, max 500).
    """
    if not _safe_select(sql):
        return json.dumps({
            "error": "Only SELECT queries are allowed. This is a read-only server."
        })

    limit = min(limit, 500)
    # Auto-append LIMIT if not present
    upper = sql.strip().upper()
    if "LIMIT" not in upper.split("ORDER")[-1] if "ORDER" in upper else upper:
        sql = sql.rstrip().rstrip(";") + f" LIMIT {limit}"

    conn = _get_conn()
    try:
        cursor = conn.execute(sql)
        rows = [_dict_from_row(r) for r in cursor.fetchall()]
        return json.dumps({"row_count": len(rows), "rows": rows}, indent=2, default=str)
    except Exception as e:
        return json.dumps({"error": str(e)})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tool: Dashboard / Overview
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_dashboard() -> str:
    """Get a high-level dashboard of Chronicle — programs, goal statuses,
    project counts by status, recent entry count, and upcoming deadlines.
    Best first call to get oriented."""
    conn = _get_conn()
    c = conn.cursor()

    # Programs
    programs = [_dict_from_row(r) for r in c.execute(
        "SELECT id, name, program_type, status, owner FROM programs ORDER BY sort_order"
    ).fetchall()]

    # Goals summary
    goals = [_dict_from_row(r) for r in c.execute(
        """SELECT g.id, g.title, g.status, g.target_date, g.fiscal_year, g.quarter,
                  p.name as program_name
           FROM goals g LEFT JOIN programs p ON g.program_id = p.id
           ORDER BY g.target_date"""
    ).fetchall()]

    # Project counts by status
    project_counts = {r["status"]: r["cnt"] for r in c.execute(
        "SELECT status, COUNT(*) as cnt FROM projects GROUP BY status"
    ).fetchall()}

    # Entries in last 7 days
    recent_entry_count = c.execute(
        "SELECT COUNT(*) as cnt FROM entries WHERE entry_date >= date('now', '-7 days')"
    ).fetchone()["cnt"]

    # Upcoming deadlines (projects with target_end_date in next 30 days)
    upcoming = [_dict_from_row(r) for r in c.execute(
        """SELECT name, status, target_end_date FROM projects
           WHERE target_end_date IS NOT NULL
             AND target_end_date >= date('now')
             AND target_end_date <= date('now', '+30 days')
           ORDER BY target_end_date"""
    ).fetchall()]

    conn.close()
    return json.dumps({
        "programs": programs,
        "goals": goals,
        "project_counts": project_counts,
        "entries_last_7_days": recent_entry_count,
        "upcoming_deadlines_30d": upcoming,
    }, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tool: Programs
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_programs() -> str:
    """List all programs with their descriptions and status."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM programs ORDER BY sort_order").fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Projects
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_projects(
    program_id: int | None = None,
    status: str | None = None,
    goal_id: int | None = None,
    search: str | None = None,
) -> str:
    """List projects, optionally filtered.

    Args:
        program_id: Filter by program ID.
        status: Filter by status (planning, active, completed, paused).
        goal_id: Filter by associated goal ID.
        search: Search project names (case-insensitive substring).
    """
    conn = _get_conn()
    query = """SELECT p.*, g.title as goal_title, pr.name as program_name
               FROM projects p
               LEFT JOIN goals g ON p.goal_id = g.id
               LEFT JOIN programs pr ON p.program_id = pr.id
               WHERE 1=1"""
    params: list = []
    if program_id is not None:
        query += " AND p.program_id = ?"
        params.append(program_id)
    if status:
        query += " AND p.status = ?"
        params.append(status)
    if goal_id is not None:
        query += " AND p.goal_id = ?"
        params.append(goal_id)
    if search:
        query += " AND p.name LIKE ?"
        params.append(f"%{search}%")
    query += " ORDER BY p.updated_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


@mcp.tool()
def chronicle_get_project(project_id: int) -> str:
    """Get full detail for a project — including progress logs, entries, and stakeholders.

    Args:
        project_id: The project ID.
    """
    conn = _get_conn()
    row = conn.execute(
        """SELECT p.*, g.title as goal_title, pr.name as program_name
           FROM projects p
           LEFT JOIN goals g ON p.goal_id = g.id
           LEFT JOIN programs pr ON p.program_id = pr.id
           WHERE p.id = ?""",
        (project_id,),
    ).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Project {project_id} not found"})
    project = _dict_from_row(row)

    project["progress_logs"] = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM project_progress_log WHERE project_id = ? ORDER BY created_at DESC",
        (project_id,),
    ).fetchall()]

    project["entries"] = [_dict_from_row(r) for r in conn.execute(
        """SELECT id, entry_date, entry_type, title, status, is_accomplishment, is_weekly_highlight
           FROM entries WHERE project_id = ? ORDER BY entry_date DESC""",
        (project_id,),
    ).fetchall()]

    project["stakeholders"] = [_dict_from_row(r) for r in conn.execute(
        """SELECT s.* FROM stakeholders s
           JOIN project_stakeholders ps ON s.id = ps.stakeholder_id
           WHERE ps.project_id = ?""",
        (project_id,),
    ).fetchall()]

    conn.close()
    return json.dumps(project, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tool: Goals
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_goals(
    program_id: int | None = None,
    status: str | None = None,
) -> str:
    """List goals, optionally filtered by program or status.

    Args:
        program_id: Filter by program ID.
        status: Filter by status (on_track, at_risk, behind, completed, paused).
    """
    conn = _get_conn()
    query = """SELECT g.*, p.name as program_name
               FROM goals g
               LEFT JOIN programs p ON g.program_id = p.id
               WHERE 1=1"""
    params: list = []
    if program_id is not None:
        query += " AND g.program_id = ?"
        params.append(program_id)
    if status:
        query += " AND g.status = ?"
        params.append(status)
    query += " ORDER BY g.target_date"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


@mcp.tool()
def chronicle_get_goal(goal_id: int) -> str:
    """Get full detail for a goal — including SMART fields, progress logs, and linked projects.

    Args:
        goal_id: The goal ID.
    """
    conn = _get_conn()
    row = conn.execute(
        """SELECT g.*, p.name as program_name
           FROM goals g LEFT JOIN programs p ON g.program_id = p.id
           WHERE g.id = ?""",
        (goal_id,),
    ).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Goal {goal_id} not found"})
    goal = _dict_from_row(row)

    goal["progress_logs"] = [_dict_from_row(r) for r in conn.execute(
        "SELECT * FROM goal_progress_log WHERE goal_id = ? ORDER BY created_at DESC",
        (goal_id,),
    ).fetchall()]

    goal["projects"] = [_dict_from_row(r) for r in conn.execute(
        "SELECT id, name, status, target_end_date FROM projects WHERE goal_id = ? ORDER BY id",
        (goal_id,),
    ).fetchall()]

    conn.close()
    return json.dumps(goal, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tool: Entries
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_entries(
    project_id: int | None = None,
    program_id: int | None = None,
    entry_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
    accomplishments_only: bool = False,
    highlights_only: bool = False,
    search: str | None = None,
    limit: int = 50,
) -> str:
    """List work entries with flexible filters.

    Args:
        project_id: Filter by project.
        program_id: Filter by program.
        entry_type: Filter by type (quick_capture, project_update, operational_rhythm,
                    development, recognition, decision, milestone, action_item).
        since: Entries on or after this date (YYYY-MM-DD).
        until: Entries on or before this date (YYYY-MM-DD).
        accomplishments_only: Only return entries marked as accomplishments.
        highlights_only: Only return entries marked as weekly highlights.
        search: Search title and description (case-insensitive substring).
        limit: Max results (default 50, max 200).
    """
    conn = _get_conn()
    query = """SELECT e.*, p.name as project_name, pr.name as program_name
               FROM entries e
               LEFT JOIN projects p ON e.project_id = p.id
               LEFT JOIN programs pr ON e.program_id = pr.id
               WHERE 1=1"""
    params: list = []

    if project_id is not None:
        query += " AND e.project_id = ?"
        params.append(project_id)
    if program_id is not None:
        query += " AND e.program_id = ?"
        params.append(program_id)
    if entry_type:
        query += " AND e.entry_type = ?"
        params.append(entry_type)
    if since:
        query += " AND e.entry_date >= ?"
        params.append(since)
    if until:
        query += " AND e.entry_date <= ?"
        params.append(until)
    if accomplishments_only:
        query += " AND e.is_accomplishment = 1"
    if highlights_only:
        query += " AND e.is_weekly_highlight = 1"
    if search:
        query += " AND (e.title LIKE ? OR e.description LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])

    limit = min(limit, 200)
    query += f" ORDER BY e.entry_date DESC, e.created_at DESC LIMIT {limit}"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


@mcp.tool()
def chronicle_get_entry(entry_id: int) -> str:
    """Get full detail for a single entry including tags.

    Args:
        entry_id: The entry ID.
    """
    conn = _get_conn()
    row = conn.execute(
        """SELECT e.*, p.name as project_name, pr.name as program_name
           FROM entries e
           LEFT JOIN projects p ON e.project_id = p.id
           LEFT JOIN programs pr ON e.program_id = pr.id
           WHERE e.id = ?""",
        (entry_id,),
    ).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Entry {entry_id} not found"})
    entry = _dict_from_row(row)

    # Tags
    entry["tags"] = [r["name"] for r in conn.execute(
        """SELECT t.name FROM tags t
           JOIN entry_tags et ON t.id = et.tag_id
           WHERE et.entry_id = ?""",
        (entry_id,),
    ).fetchall()]

    conn.close()
    return json.dumps(entry, indent=2, default=str)


# ---------------------------------------------------------------------------
# Tool: Scheduled Items & Cadences
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_scheduled_items(
    status: str = "active",
    item_class: str | None = None,
    program_id: int | None = None,
) -> str:
    """List scheduled items (cadences, recurring tasks, etc.).

    Args:
        status: Filter by status (default 'active').
        item_class: Filter by class (e.g. 'cadence', 'task').
        program_id: Filter by program.
    """
    conn = _get_conn()
    query = """SELECT si.*, p.name as program_name, proj.name as project_name
               FROM scheduled_items si
               LEFT JOIN programs p ON si.program_id = p.id
               LEFT JOIN projects proj ON si.project_id = proj.id
               WHERE 1=1"""
    params: list = []
    if status:
        query += " AND si.status = ?"
        params.append(status)
    if item_class:
        query += " AND si.item_class = ?"
        params.append(item_class)
    if program_id is not None:
        query += " AND si.program_id = ?"
        params.append(program_id)
    query += " ORDER BY si.sort_order, si.name"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Stakeholders
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_stakeholders() -> str:
    """List all stakeholders with their project associations."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT s.*, GROUP_CONCAT(p.name, '; ') as projects
           FROM stakeholders s
           LEFT JOIN project_stakeholders ps ON s.id = ps.stakeholder_id
           LEFT JOIN projects p ON ps.project_id = p.id
           GROUP BY s.id
           ORDER BY s.id"""
    ).fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Tags
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_list_tags() -> str:
    """List all tags with entry counts."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT t.id, t.name, COUNT(et.entry_id) as entry_count
           FROM tags t
           LEFT JOIN entry_tags et ON t.id = et.tag_id
           GROUP BY t.id
           ORDER BY entry_count DESC"""
    ).fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Accomplishments & Highlights
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_accomplishments(
    since: str | None = None,
    until: str | None = None,
    limit: int = 25,
) -> str:
    """Get all accomplishments and weekly highlights — ideal for report generation,
    self-reviews, and leadership updates.

    Args:
        since: Start date filter (YYYY-MM-DD).
        until: End date filter (YYYY-MM-DD).
        limit: Max results (default 25).
    """
    conn = _get_conn()
    query = """SELECT e.id, e.entry_date, e.entry_type, e.title, e.description,
                      e.impact, e.metrics, e.is_accomplishment, e.is_weekly_highlight,
                      p.name as project_name, pr.name as program_name
               FROM entries e
               LEFT JOIN projects p ON e.project_id = p.id
               LEFT JOIN programs pr ON e.program_id = pr.id
               WHERE (e.is_accomplishment = 1 OR e.is_weekly_highlight = 1)"""
    params: list = []
    if since:
        query += " AND e.entry_date >= ?"
        params.append(since)
    if until:
        query += " AND e.entry_date <= ?"
        params.append(until)
    query += f" ORDER BY e.entry_date DESC LIMIT {min(limit, 200)}"

    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Progress Logs
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_progress_logs(
    entity_type: str = "project",
    entity_id: int | None = None,
    limit: int = 25,
) -> str:
    """Get progress log entries for projects or goals.

    Args:
        entity_type: 'project' or 'goal'.
        entity_id: Filter to a specific project or goal ID.
        limit: Max results (default 25).
    """
    if entity_type == "project":
        table = "project_progress_log"
        id_col = "project_id"
    elif entity_type == "goal":
        table = "goal_progress_log"
        id_col = "goal_id"
    else:
        return json.dumps({"error": "entity_type must be 'project' or 'goal'"})

    conn = _get_conn()
    query = f"SELECT * FROM {table} WHERE 1=1"
    params: list = []
    if entity_id is not None:
        query += f" AND {id_col} = ?"
        params.append(entity_id)
    query += f" ORDER BY created_at DESC LIMIT {min(limit, 200)}"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return _rows_to_json(rows)


# ---------------------------------------------------------------------------
# Tool: Weekly Summary
# ---------------------------------------------------------------------------

@mcp.tool()
def chronicle_weekly_summary(week_start: str | None = None) -> str:
    """Generate a structured weekly summary — entries grouped by day and type,
    accomplishments highlighted, project touchpoints listed.

    If week_start is not given, defaults to the current week (Monday).

    Args:
        week_start: Monday of the target week (YYYY-MM-DD). Defaults to current week.
    """
    conn = _get_conn()

    if week_start:
        start = week_start
    else:
        row = conn.execute("SELECT date('now', 'weekday 0', '-6 days') as monday").fetchone()
        start = row["monday"]

    end_row = conn.execute("SELECT date(?, '+6 days') as sunday", (start,)).fetchone()
    end = end_row["sunday"]

    entries = [_dict_from_row(r) for r in conn.execute(
        """SELECT e.id, e.entry_date, e.entry_type, e.work_type, e.title,
                  e.description, e.impact, e.status,
                  e.is_accomplishment, e.is_weekly_highlight,
                  p.name as project_name, pr.name as program_name
           FROM entries e
           LEFT JOIN projects p ON e.project_id = p.id
           LEFT JOIN programs pr ON e.program_id = pr.id
           WHERE e.entry_date >= ? AND e.entry_date <= ?
           ORDER BY e.entry_date, e.created_at""",
        (start, end),
    ).fetchall()]

    # Group by date
    by_date: dict[str, list] = {}
    accomplishments = []
    highlights = []
    for e in entries:
        by_date.setdefault(e["entry_date"], []).append(e)
        if e["is_accomplishment"]:
            accomplishments.append(e)
        if e["is_weekly_highlight"]:
            highlights.append(e)

    conn.close()
    return json.dumps({
        "week_start": start,
        "week_end": end,
        "total_entries": len(entries),
        "accomplishments": accomplishments,
        "weekly_highlights": highlights,
        "entries_by_date": by_date,
    }, indent=2, default=str)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chronicle Read-Only MCP Server")
    parser.add_argument("--db-path", type=str, help="Path to chronicle.db")
    args = parser.parse_args()

    DB_PATH = _resolve_db_path(args.db_path)
    print(f"[Chronicle RO] Database: {DB_PATH}")
    print(f"[Chronicle RO] Mode: READ-ONLY (no write operations)")

    # Verify DB is accessible
    conn = _get_conn()
    tables = conn.execute("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").fetchone()
    print(f"[Chronicle RO] Tables found: {tables['cnt']}")
    conn.close()

    mcp.run()
