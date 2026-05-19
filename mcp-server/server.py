"""
Chronicle MCP Server — Local bridge between Kiro and the Chronicle database.

Provides structured tools for reading and writing to chronicle.db without
requiring throwaway Python scripts. Connects directly to the SQLite file;
does not require the Chronicle backend to be running.

Usage (Kiro MCP config):
    {
        "mcpServers": {
            "chronicle": {
                "command": "python",
                "args": ["<path>/server.py"],
                "env": {
                    "CHRONICLE_DB_PATH": "<path>/chronicle.db"
                }
            }
        }
    }
"""

import json
import os
import sqlite3
from datetime import datetime
from typing import Any

from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DB_PATH = os.environ.get(
    "CHRONICLE_DB_PATH",
    os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")),
        "Chronicle",
        "chronicle.db",
    ),
)

mcp = FastMCP(
    "Chronicle",
    instructions="Local MCP server for the Chronicle professional narrative database.",
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    """Return a connection with row_factory and foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict]:
    return [dict(r) for r in rows]


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# PROJECTS
# ---------------------------------------------------------------------------

@mcp.tool()
def list_projects(
    program_id: int | None = None,
    status: str | None = None,
) -> str:
    """List projects, optionally filtered by program or status.

    Args:
        program_id: Filter by program ID
        status: Filter by status (planning, active, completed, paused)
    """
    conn = _get_conn()
    query = "SELECT p.*, pr.name as program_name, g.title as goal_title FROM projects p LEFT JOIN programs pr ON p.program_id = pr.id LEFT JOIN goals g ON p.goal_id = g.id WHERE 1=1"
    params: list = []
    if program_id is not None:
        query += " AND p.program_id = ?"
        params.append(program_id)
    if status:
        query += " AND p.status = ?"
        params.append(status)
    query += " ORDER BY p.id"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


@mcp.tool()
def get_project(project_id: int) -> str:
    """Get full project detail including progress logs and entries.

    Args:
        project_id: The project ID
    """
    conn = _get_conn()
    project = _row_to_dict(conn.execute(
        "SELECT p.*, pr.name as program_name, g.title as goal_title FROM projects p LEFT JOIN programs pr ON p.program_id = pr.id LEFT JOIN goals g ON p.goal_id = g.id WHERE p.id = ?",
        (project_id,),
    ).fetchone())
    if not project:
        conn.close()
        return json.dumps({"error": f"Project {project_id} not found"})
    project["progress_log"] = _rows_to_dicts(conn.execute(
        "SELECT * FROM project_progress_log WHERE project_id = ? ORDER BY created_at", (project_id,)
    ).fetchall())
    project["entries"] = _rows_to_dicts(conn.execute(
        "SELECT id, entry_date, entry_type, title, status, is_accomplishment FROM entries WHERE project_id = ? ORDER BY entry_date", (project_id,)
    ).fetchall())
    conn.close()
    return json.dumps(project, indent=2)


@mcp.tool()
def create_project(
    name: str,
    description: str | None = None,
    status: str = "active",
    start_date: str | None = None,
    target_end_date: str | None = None,
    goal_id: int | None = None,
    program_id: int | None = None,
) -> str:
    """Create a new project.

    Args:
        name: Project name
        description: Project description
        status: planning, active, completed, paused
        start_date: Start date (YYYY-MM-DD)
        target_end_date: Target end date (YYYY-MM-DD)
        goal_id: Link to a goal
        program_id: Link to a program
    """
    conn = _get_conn()
    now = _now()
    cursor = conn.execute(
        "INSERT INTO projects (created_at, updated_at, name, description, status, start_date, target_end_date, goal_id, program_id) VALUES (?,?,?,?,?,?,?,?,?)",
        (now, now, name, description, status, start_date, target_end_date, goal_id, program_id),
    )
    conn.commit()
    project_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": project_id, "name": name, "status": "created"})


@mcp.tool()
def update_project(project_id: int, **kwargs: Any) -> str:
    """Update any field on a project.

    Args:
        project_id: The project ID
        **kwargs: Fields to update (name, description, status, start_date, target_end_date, actual_end_date, goal_id, program_id)
    """
    # MCP framework may pass fields nested inside a 'kwargs' key — unpack if so
    if "kwargs" in kwargs and isinstance(kwargs["kwargs"], dict):
        kwargs = kwargs["kwargs"]
    allowed = {"name", "description", "status", "start_date", "target_end_date", "actual_end_date", "goal_id", "program_id", "metrics", "is_accomplishment"}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return json.dumps({"error": "No valid fields to update"})
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [project_id]
    conn = _get_conn()
    conn.execute(f"UPDATE projects SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"id": project_id, "updated_fields": list(updates.keys())})


# ---------------------------------------------------------------------------
# GOALS
# ---------------------------------------------------------------------------

@mcp.tool()
def list_goals(program_id: int | None = None, status: str | None = None) -> str:
    """List goals, optionally filtered by program or status.

    Args:
        program_id: Filter by program ID
        status: Filter by status (on_track, at_risk, behind, completed, paused)
    """
    conn = _get_conn()
    query = "SELECT g.*, pr.name as program_name FROM goals g LEFT JOIN programs pr ON g.program_id = pr.id WHERE 1=1"
    params: list = []
    if program_id is not None:
        query += " AND g.program_id = ?"
        params.append(program_id)
    if status:
        query += " AND g.status = ?"
        params.append(status)
    query += " ORDER BY g.id"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


@mcp.tool()
def get_goal(goal_id: int) -> str:
    """Get full goal detail including SMART fields and progress logs.

    Args:
        goal_id: The goal ID
    """
    conn = _get_conn()
    goal = _row_to_dict(conn.execute("SELECT * FROM goals WHERE id = ?", (goal_id,)).fetchone())
    if not goal:
        conn.close()
        return json.dumps({"error": f"Goal {goal_id} not found"})
    goal["progress_log"] = _rows_to_dicts(conn.execute(
        "SELECT * FROM goal_progress_log WHERE goal_id = ? ORDER BY created_at", (goal_id,)
    ).fetchall())
    goal["projects"] = _rows_to_dicts(conn.execute(
        "SELECT id, name, status, start_date, target_end_date FROM projects WHERE goal_id = ? ORDER BY id", (goal_id,)
    ).fetchall())
    conn.close()
    return json.dumps(goal, indent=2)


@mcp.tool()
def update_goal(goal_id: int, **kwargs: Any) -> str:
    """Update any field on a goal.

    Args:
        goal_id: The goal ID
        **kwargs: Fields to update (title, description, specific, measurable, achievable, relevant, time_bound, fiscal_year, quarter, status, target_date, is_accomplishment, program_id)
    """
    # MCP framework may pass fields nested inside a 'kwargs' key — unpack if so
    if "kwargs" in kwargs and isinstance(kwargs["kwargs"], dict):
        kwargs = kwargs["kwargs"]
    allowed = {"title", "description", "specific", "measurable", "achievable", "relevant", "time_bound", "fiscal_year", "quarter", "status", "target_date", "is_accomplishment", "program_id"}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return json.dumps({"error": "No valid fields to update"})
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [goal_id]
    conn = _get_conn()
    conn.execute(f"UPDATE goals SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"id": goal_id, "updated_fields": list(updates.keys())})


@mcp.tool()
def create_goal(
    title: str,
    description: str | None = None,
    specific: str | None = None,
    measurable: str | None = None,
    achievable: str | None = None,
    relevant: str | None = None,
    time_bound: str | None = None,
    fiscal_year: int | None = None,
    quarter: int | None = None,
    status: str = "on_track",
    target_date: str | None = None,
    is_accomplishment: int = 0,
    program_id: int | None = None,
) -> str:
    """Create a new goal with SMART fields.

    Args:
        title: Goal title
        description: Goal description
        specific: SMART - Specific
        measurable: SMART - Measurable
        achievable: SMART - Achievable
        relevant: SMART - Relevant
        time_bound: SMART - Time-bound
        fiscal_year: Fiscal year (e.g. 2026)
        quarter: Quarter (1-4)
        status: on_track, at_risk, behind, completed, paused
        target_date: Target date (YYYY-MM-DD)
        is_accomplishment: 1 to star the goal
        program_id: Link to a program
    """
    conn = _get_conn()
    now = _now()
    cursor = conn.execute(
        """INSERT INTO goals (created_at, updated_at, title, description, specific, measurable, achievable, relevant, time_bound, fiscal_year, quarter, status, target_date, is_accomplishment, program_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (now, now, title, description, specific, measurable, achievable, relevant, time_bound, fiscal_year, quarter, status, target_date, is_accomplishment, program_id),
    )
    conn.commit()
    goal_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": goal_id, "title": title, "status": "created"})


# ---------------------------------------------------------------------------
# ENTRIES
# ---------------------------------------------------------------------------

@mcp.tool()
def create_and_complete_task(
    title: str,
    entry_date: str | None = None,
    entry_type: str = "quick_capture",
    work_type: str = "project",
    description: str | None = None,
    impact: str | None = None,
    project_id: int | None = None,
    program_id: int | None = None,
    status: str = "completed",
    visibility: str = "shareable",
    is_accomplishment: int = 0,
    is_weekly_highlight: int = 0,
) -> str:
    """Create a task and immediately complete it, producing an entry in Timeline.

    This is the v3.0 unified way to log completed work. Every entry in Chronicle
    is created through task completion — this tool handles both steps in one call.

    Args:
        title: Entry title
        entry_date: Date (YYYY-MM-DD), defaults to today
        entry_type: quick_capture, project_update, operational_rhythm, development, recognition, decision, milestone, action_item, program_update
        work_type: project or operational_rhythm
        description: Detailed description
        impact: Impact statement
        project_id: Link to a project
        program_id: Link to a program
        status: in_progress, completed, ongoing, paused
        visibility: personal or shareable
        is_accomplishment: 1 to star the entry
        is_weekly_highlight: 1 to mark as weekly highlight
    """
    conn = _get_conn()
    now = _now()
    date = entry_date or datetime.now().strftime("%Y-%m-%d")

    # v3.0: Inherit program_id from project if not explicitly set
    effective_program_id = program_id
    if effective_program_id is None and project_id is not None:
        row = conn.execute("SELECT program_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row and row["program_id"]:
            effective_program_id = row["program_id"]

    # 1. Create the scheduled_item (task)
    cursor = conn.execute(
        """INSERT INTO scheduled_items (created_at, updated_at, name, description, mode, due_date,
           program_id, project_id, template_entry_type, template_work_type, template_visibility,
           status, item_class, show_on_today)
        VALUES (?,?,?,?,'one_time',?,?,?,?,?,?,'completed','task',1)""",
        (now, now, title, description, date, effective_program_id, project_id,
         entry_type, work_type, visibility),
    )
    task_id = cursor.lastrowid

    # 2. Create the entry linked to the task
    cursor = conn.execute(
        """INSERT INTO entries (created_at, updated_at, entry_date, entry_type, work_type, title,
           description, impact, project_id, program_id, status, visibility,
           is_accomplishment, is_lesson_learned, is_weekly_highlight, scheduled_item_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)""",
        (now, now, date, entry_type, work_type, title, description, impact,
         project_id, effective_program_id, status, visibility, is_accomplishment,
         is_weekly_highlight, task_id),
    )
    entry_id = cursor.lastrowid

    # 3. Create a completed instance linking task to entry
    conn.execute(
        """INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status, resolved_at, entry_id)
        VALUES (?, ?, 'completed', ?, ?)""",
        (task_id, date, now, entry_id),
    )

    conn.commit()
    conn.close()
    return json.dumps({"id": entry_id, "task_id": task_id, "title": title, "starred": bool(is_accomplishment)})


@mcp.tool()
def search_entries(
    keyword: str | None = None,
    project_id: int | None = None,
    program_id: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    entry_type: str | None = None,
    starred_only: bool = False,
    limit: int = 50,
) -> str:
    """Search entries with flexible filters.

    Args:
        keyword: Search in title and description
        project_id: Filter by project
        program_id: Filter by program
        date_from: Start date (YYYY-MM-DD)
        date_to: End date (YYYY-MM-DD)
        entry_type: Filter by type (milestone, project_update, etc.)
        starred_only: Only return starred entries
        limit: Max results (default 50)
    """
    conn = _get_conn()
    query = "SELECT e.*, p.name as project_name, pr.name as program_name FROM entries e LEFT JOIN projects p ON e.project_id = p.id LEFT JOIN programs pr ON e.program_id = pr.id WHERE 1=1"
    params: list = []
    if keyword:
        query += " AND (e.title LIKE ? OR e.description LIKE ?)"
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    if project_id is not None:
        query += " AND e.project_id = ?"
        params.append(project_id)
    if program_id is not None:
        query += " AND e.program_id = ?"
        params.append(program_id)
    if date_from:
        query += " AND e.entry_date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND e.entry_date <= ?"
        params.append(date_to)
    if entry_type:
        query += " AND e.entry_type = ?"
        params.append(entry_type)
    if starred_only:
        query += " AND e.is_accomplishment = 1"
    query += f" ORDER BY e.entry_date DESC LIMIT {limit}"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


@mcp.tool()
def update_entry(entry_id: int, **kwargs: Any) -> str:
    """Update any field on an entry.

    Args:
        entry_id: The entry ID
        **kwargs: Fields to update (title, description, impact, entry_date, entry_type, work_type, project_id, program_id, status, visibility, is_accomplishment, is_weekly_highlight, is_pinned, outcome)
    """
    # MCP framework may pass fields nested inside a 'kwargs' key — unpack if so
    if "kwargs" in kwargs and isinstance(kwargs["kwargs"], dict):
        kwargs = kwargs["kwargs"]
    allowed = {"title", "description", "impact", "entry_date", "entry_type", "work_type", "project_id", "program_id", "status", "visibility", "is_accomplishment", "is_weekly_highlight", "is_lesson_learned", "is_pinned", "outcome", "metrics"}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return json.dumps({"error": "No valid fields to update"})
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [entry_id]
    conn = _get_conn()
    conn.execute(f"UPDATE entries SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"id": entry_id, "updated_fields": list(updates.keys())})


# ---------------------------------------------------------------------------
# PROGRESS LOGS
# ---------------------------------------------------------------------------

@mcp.tool()
def add_goal_progress(goal_id: int, note: str, status_at_time: str = "on_track") -> str:
    """Add a progress log entry to a goal.

    Args:
        goal_id: The goal ID
        note: Progress note text
        status_at_time: Status snapshot (on_track, at_risk, behind, completed, paused)
    """
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO goal_progress_log (goal_id, created_at, note, status_at_time) VALUES (?,?,?,?)",
        (goal_id, _now(), note, status_at_time),
    )
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": log_id, "goal_id": goal_id})


@mcp.tool()
def add_project_progress(project_id: int, note: str, status_at_time: str = "on_track") -> str:
    """Add a progress log entry to a project.

    Args:
        project_id: The project ID
        note: Progress note text
        status_at_time: Status snapshot (planning, active, completed, paused, on_track)
    """
    conn = _get_conn()
    cursor = conn.execute(
        "INSERT INTO project_progress_log (project_id, created_at, note, status_at_time) VALUES (?,?,?,?)",
        (project_id, _now(), note, status_at_time),
    )
    conn.commit()
    log_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": log_id, "project_id": project_id})


@mcp.tool()
def delete_progress_log(log_type: str, log_id: int) -> str:
    """Delete a progress log entry.

    Args:
        log_type: 'goal' or 'project'
        log_id: The progress log entry ID
    """
    table = "goal_progress_log" if log_type == "goal" else "project_progress_log"
    conn = _get_conn()
    conn.execute(f"DELETE FROM {table} WHERE id = ?", (log_id,))
    conn.commit()
    conn.close()
    return json.dumps({"deleted": log_id, "type": log_type})


# ---------------------------------------------------------------------------
# SCHEDULED ITEMS (Tasks & Cadences)
# ---------------------------------------------------------------------------

@mcp.tool()
def create_task(
    name: str,
    description: str | None = None,
    due_date: str | None = None,
    project_id: int | None = None,
    program_id: int | None = None,
) -> str:
    """Create a one-time task (scheduled item with item_class='task').

    Args:
        name: Task name
        description: Task description
        due_date: Due date (YYYY-MM-DD)
        project_id: Link to a project
        program_id: Link to a program
    """
    conn = _get_conn()
    now = _now()
    # v3.0: Inherit program_id from project if not explicitly set
    effective_program_id = program_id
    if effective_program_id is None and project_id is not None:
        row = conn.execute("SELECT program_id FROM projects WHERE id = ?", (project_id,)).fetchone()
        if row and row["program_id"]:
            effective_program_id = row["program_id"]
    cursor = conn.execute(
        """INSERT INTO scheduled_items (created_at, updated_at, name, description, mode, due_date, program_id, project_id, status, item_class, show_on_today)
        VALUES (?,?,?,?,'one_time',?,?,?,'active','task',1)""",
        (now, now, name, description, due_date, effective_program_id, project_id),
    )
    task_id = cursor.lastrowid
    # Create the instance row so the task appears in Today/Upcoming immediately
    if due_date:
        conn.execute(
            """INSERT OR IGNORE INTO scheduled_item_instances (scheduled_item_id, due_date, status)
            VALUES (?, ?, 'pending')""",
            (task_id, due_date),
        )
    conn.commit()
    conn.close()
    return json.dumps({"id": task_id, "name": name, "due_date": due_date})


@mcp.tool()
def update_task(task_id: int, **kwargs: Any) -> str:
    """Update any field on a scheduled item (task or cadence).

    Args:
        task_id: The scheduled item ID
        **kwargs: Fields to update (name, description, due_date, status, project_id, program_id, show_on_today)
    """
    # MCP framework may pass fields nested inside a 'kwargs' key — unpack if so
    if "kwargs" in kwargs and isinstance(kwargs["kwargs"], dict):
        kwargs = kwargs["kwargs"]
    allowed = {"name", "description", "due_date", "status", "project_id", "program_id", "show_on_today", "sort_order"}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return json.dumps({"error": "No valid fields to update"})
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [task_id]
    conn = _get_conn()
    conn.execute(f"UPDATE scheduled_items SET {set_clause} WHERE id = ?", values)

    # Sync instance when due_date changes on a one-time task
    if "due_date" in kwargs:
        mode = conn.execute("SELECT mode FROM scheduled_items WHERE id = ?", (task_id,)).fetchone()
        if mode and mode["mode"] == "one_time":
            new_due = kwargs["due_date"]
            # Remove old pending instance
            conn.execute(
                "DELETE FROM scheduled_item_instances WHERE scheduled_item_id = ? AND status = 'pending'",
                (task_id,),
            )
            # Create new one if due_date is set
            if new_due:
                conn.execute(
                    "INSERT OR IGNORE INTO scheduled_item_instances (scheduled_item_id, due_date, status) VALUES (?, ?, 'pending')",
                    (task_id, new_due),
                )

    conn.commit()
    conn.close()
    return json.dumps({"id": task_id, "updated_fields": list(updates.keys())})


@mcp.tool()
def list_tasks(
    status: str = "active",
    program_id: int | None = None,
    project_id: int | None = None,
    due_before: str | None = None,
) -> str:
    """List scheduled items (tasks and cadences).

    Args:
        status: Filter by status (active, completed, paused, archived)
        program_id: Filter by program
        project_id: Filter by project
        due_before: Only items due on or before this date (YYYY-MM-DD)
    """
    conn = _get_conn()
    query = """SELECT si.*, p.name as project_name, pr.name as program_name
        FROM scheduled_items si
        LEFT JOIN projects p ON si.project_id = p.id
        LEFT JOIN programs pr ON si.program_id = pr.id
        WHERE si.status = ?"""
    params: list = [status]
    if program_id is not None:
        query += " AND si.program_id = ?"
        params.append(program_id)
    if project_id is not None:
        query += " AND si.project_id = ?"
        params.append(project_id)
    if due_before:
        query += " AND si.due_date <= ?"
        params.append(due_before)
    query += " ORDER BY si.due_date"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


# ---------------------------------------------------------------------------
# PROGRAMS
# ---------------------------------------------------------------------------

@mcp.tool()
def list_programs() -> str:
    """List all programs with basic info."""
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM programs ORDER BY sort_order, id").fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


# ---------------------------------------------------------------------------
# PREP NOTES
# ---------------------------------------------------------------------------

@mcp.tool()
def create_note(text: str) -> str:
    """Create a prep note for 1:1 topics, follow-up reminders, or communication prompts.

    Args:
        text: Note content
    """
    if not text or not text.strip():
        return json.dumps({"error": "Note text cannot be empty"})
    conn = _get_conn()
    now = _now()
    cursor = conn.execute(
        "INSERT INTO notes (text, created_at) VALUES (?, ?)",
        (text.strip(), now),
    )
    conn.commit()
    note_id = cursor.lastrowid
    conn.close()
    return json.dumps({"id": note_id, "text": text.strip(), "created_at": now})


@mcp.tool()
def list_notes() -> str:
    """List all active (non-dismissed) prep notes, ordered by newest first."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM notes WHERE dismissed_at IS NULL ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


@mcp.tool()
def dismiss_note(note_id: int) -> str:
    """Dismiss a prep note by ID (soft-delete — sets dismissed_at timestamp).

    Args:
        note_id: The note ID to dismiss
    """
    conn = _get_conn()
    row = conn.execute("SELECT id FROM notes WHERE id = ?", (note_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Note {note_id} not found"})
    conn.execute(
        "UPDATE notes SET dismissed_at = ? WHERE id = ?",
        (_now(), note_id),
    )
    conn.commit()
    conn.close()
    return json.dumps({"id": note_id, "status": "dismissed"})


# ---------------------------------------------------------------------------
# REPORT DRAFTS
# ---------------------------------------------------------------------------

@mcp.tool()
def create_report_draft(
    title: str,
    content: str,
    preset_id: int | None = None,
    date_range_start: str | None = None,
    date_range_end: str | None = None,
) -> str:
    """Create a new report draft.

    Args:
        title: Draft title
        content: Draft content (markdown text)
        preset_id: Optional link to a report preset
        date_range_start: Start of date range covered (YYYY-MM-DD)
        date_range_end: End of date range covered (YYYY-MM-DD)
    """
    if not title or not title.strip():
        return json.dumps({"error": "Title cannot be empty"})
    if not content or not content.strip():
        return json.dumps({"error": "Content cannot be empty"})
    conn = _get_conn()
    now = _now()
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
def list_report_drafts() -> str:
    """List all report drafts, ordered by most recently updated first."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM report_drafts ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return json.dumps(_rows_to_dicts(rows), indent=2)


@mcp.tool()
def update_report_draft(
    draft_id: int,
    title: str | None = None,
    content: str | None = None,
    status: str | None = None,
) -> str:
    """Update a report draft's title, content, or status.

    Args:
        draft_id: The report draft ID
        title: New title (optional)
        content: New content (optional)
        status: New status — must be one of: draft, ready, sent (optional)
    """
    updates: dict[str, Any] = {}
    if title is not None:
        updates["title"] = title.strip()
    if content is not None:
        updates["content"] = content.strip()
    if status is not None:
        valid_statuses = ("draft", "ready", "sent")
        if status not in valid_statuses:
            return json.dumps({"error": f"Invalid status: '{status}'. Must be one of: {valid_statuses}"})
        updates["status"] = status
    if not updates:
        return json.dumps({"error": "No fields provided to update"})

    conn = _get_conn()
    row = conn.execute("SELECT id FROM report_drafts WHERE id = ?", (draft_id,)).fetchone()
    if not row:
        conn.close()
        return json.dumps({"error": f"Report draft {draft_id} not found"})

    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [draft_id]
    conn.execute(f"UPDATE report_drafts SET {set_clause} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return json.dumps({"id": draft_id, "updated_fields": list(updates.keys())})


@mcp.tool()
def delete_report_draft(draft_id: int) -> str:
    """Permanently delete a report draft.

    Args:
        draft_id: The report draft ID to delete
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


# ---------------------------------------------------------------------------
# RAW QUERY (read-only)
# ---------------------------------------------------------------------------

@mcp.tool()
def query(sql: str) -> str:
    """Execute a read-only SQL query against the Chronicle database.
    Only SELECT statements are allowed.

    Args:
        sql: A SELECT SQL statement
    """
    stripped = sql.strip().upper()
    if not stripped.startswith("SELECT"):
        return json.dumps({"error": "Only SELECT queries are allowed. Use the dedicated tools for writes."})
    conn = _get_conn()
    try:
        rows = conn.execute(sql).fetchall()
        conn.close()
        return json.dumps(_rows_to_dicts(rows), indent=2)
    except sqlite3.Error as e:
        conn.close()
        return json.dumps({"error": str(e)})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run()
