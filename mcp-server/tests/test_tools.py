"""
Property-based tests for Chronicle v3.1 MCP tool signature cleanup.

Property 6: MCP Tools Exclude Removed Parameters
For each MCP tool function, verify:
  - The function signature does NOT accept removed parameters
  - Response data does NOT contain removed field names
  - Docstrings do NOT reference removed parameters as accepted inputs

Uses Python hypothesis for generative testing of response shapes.

# Feature: chronicle-v3.1-leanout, Property 6
# **Validates: Requirements 10.1, 10.2, 10.3, 10.5**
"""
import inspect
import json
import sqlite3
import sys
import os

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st

# Add the mcp-server directory to path so we can import server module
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import server  # noqa: E402


# ---------------------------------------------------------------------------
# Constants: removed parameters and fields that must NOT appear
# ---------------------------------------------------------------------------

# Parameters removed from create_and_complete_task (Requirement 10.1)
REMOVED_CREATE_AND_COMPLETE_PARAMS = {"work_type", "impact", "metrics", "outcome"}

# Parameters removed from update_entry (Requirement 10.2)
REMOVED_UPDATE_ENTRY_PARAMS = {"work_type", "impact", "metrics", "outcome", "is_lesson_learned"}

# Parameters removed from create_task (Requirement 10.3)
REMOVED_CREATE_TASK_PARAMS = {"template_work_type"}

# Parameters removed from update_task allowed set (Requirement 10.5 via 10.3)
REMOVED_UPDATE_TASK_PARAMS = {"template_work_type"}

# Fields that must NOT appear in search_entries response (Requirement 10.5)
REMOVED_RESPONSE_FIELDS = {"work_type", "impact", "metrics", "outcome", "is_lesson_learned"}

# All removed parameter names across all tools (superset)
ALL_REMOVED_PARAMS = (
    REMOVED_CREATE_AND_COMPLETE_PARAMS
    | REMOVED_UPDATE_ENTRY_PARAMS
    | REMOVED_CREATE_TASK_PARAMS
    | REMOVED_UPDATE_TASK_PARAMS
)

# The 5 MCP tools under test
TOOLS_UNDER_TEST = [
    "create_and_complete_task",
    "update_entry",
    "search_entries",
    "create_task",
    "update_task",
]


# ---------------------------------------------------------------------------
# Feature: chronicle-v3.1-leanout, Property 6
# ---------------------------------------------------------------------------
# Property 6: MCP Tools Exclude Removed Parameters
# For each MCP tool function, verify the signature does not accept removed
# parameters AND response data does not contain removed field names.
# **Validates: Requirements 10.1, 10.2, 10.3, 10.5**


class TestSignatureExcludesRemovedParams:
    """Verify function signatures do NOT accept removed parameters."""

    def test_create_and_complete_task_signature(self):
        """create_and_complete_task must not accept work_type, impact, metrics, outcome."""
        sig = inspect.signature(server.create_and_complete_task)
        param_names = set(sig.parameters.keys())
        overlap = param_names & REMOVED_CREATE_AND_COMPLETE_PARAMS
        assert overlap == set(), (
            f"create_and_complete_task still accepts removed params: {overlap}"
        )

    def test_update_entry_signature(self):
        """update_entry must not accept work_type, impact, metrics, outcome, is_lesson_learned.

        update_entry uses **kwargs, so we check the docstring 'allowed' set
        and also verify no explicit parameter for removed fields.
        """
        sig = inspect.signature(server.update_entry)
        param_names = set(sig.parameters.keys())
        # Direct params should not include removed fields
        overlap = param_names & REMOVED_UPDATE_ENTRY_PARAMS
        assert overlap == set(), (
            f"update_entry still accepts removed params as explicit parameters: {overlap}"
        )

    def test_update_entry_allowed_set_excludes_removed(self):
        """update_entry's internal allowed set must not include removed fields.

        Inspects the function source to verify the allowed set.
        """
        source = inspect.getsource(server.update_entry)
        for removed_field in REMOVED_UPDATE_ENTRY_PARAMS:
            # Check the allowed set definition (quoted strings in the set literal)
            assert f'"{removed_field}"' not in source and f"'{removed_field}'" not in source, (
                f"update_entry source still references removed field '{removed_field}' in allowed set"
            )

    def test_search_entries_signature(self):
        """search_entries must not accept work_type as a filter parameter."""
        sig = inspect.signature(server.search_entries)
        param_names = set(sig.parameters.keys())
        # work_type was the only removed filter param for search
        assert "work_type" not in param_names, (
            "search_entries still accepts 'work_type' as a parameter"
        )

    def test_create_task_signature(self):
        """create_task must not accept template_work_type."""
        sig = inspect.signature(server.create_task)
        param_names = set(sig.parameters.keys())
        overlap = param_names & REMOVED_CREATE_TASK_PARAMS
        assert overlap == set(), (
            f"create_task still accepts removed params: {overlap}"
        )

    def test_update_task_signature(self):
        """update_task must not accept template_work_type as explicit parameter."""
        sig = inspect.signature(server.update_task)
        param_names = set(sig.parameters.keys())
        overlap = param_names & REMOVED_UPDATE_TASK_PARAMS
        assert overlap == set(), (
            f"update_task still accepts removed params as explicit parameters: {overlap}"
        )

    def test_update_task_allowed_set_excludes_removed(self):
        """update_task's internal allowed set must not include template_work_type."""
        source = inspect.getsource(server.update_task)
        for removed_field in REMOVED_UPDATE_TASK_PARAMS:
            assert f'"{removed_field}"' not in source and f"'{removed_field}'" not in source, (
                f"update_task source still references removed field '{removed_field}' in allowed set"
            )


class TestDocstringsExcludeRemovedParams:
    """Verify docstrings do NOT reference removed parameters as accepted inputs."""

    @given(
        removed_param=st.sampled_from(sorted(ALL_REMOVED_PARAMS)),
        tool_name=st.sampled_from(TOOLS_UNDER_TEST),
    )
    @settings(max_examples=50, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_docstrings_do_not_reference_removed_params(self, removed_param, tool_name):
        """No tool docstring should list a removed parameter in its Args section."""
        func = getattr(server, tool_name)
        docstring = func.__doc__ or ""

        # We specifically check the Args section for removed param mentions
        # A param is "documented" if it appears as an arg definition line like:
        #   "  param_name: description..."
        # We also check for it being listed as a kwarg option
        args_section = ""
        in_args = False
        for line in docstring.split("\n"):
            stripped = line.strip()
            if stripped.lower().startswith("args:"):
                in_args = True
                continue
            if in_args:
                if stripped and not stripped.startswith("*") and ":" not in stripped and stripped[0].isupper():
                    # New section header (e.g., "Returns:")
                    break
                args_section += line + "\n"

        # Check if the removed param is documented as an accepted parameter
        # Pattern: "param_name:" at beginning of a stripped line in args section
        for line in args_section.split("\n"):
            stripped = line.strip()
            if stripped.startswith(f"{removed_param}:"):
                pytest.fail(
                    f"Tool '{tool_name}' docstring documents removed param "
                    f"'{removed_param}' in Args section"
                )

    @given(
        tool_name=st.sampled_from(TOOLS_UNDER_TEST),
    )
    @settings(max_examples=10, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_kwargs_docstring_does_not_list_removed_fields(self, tool_name):
        """For **kwargs tools, the docstring's kwargs field list must not include removed params."""
        func = getattr(server, tool_name)
        docstring = func.__doc__ or ""

        # Check the **kwargs description line (e.g., "**kwargs: Fields to update (x, y, z)")
        for line in docstring.split("\n"):
            if "kwargs" in line.lower() or "fields to update" in line.lower():
                for removed_field in ALL_REMOVED_PARAMS:
                    if removed_field in line:
                        pytest.fail(
                            f"Tool '{tool_name}' docstring kwargs description "
                            f"references removed field '{removed_field}': {line.strip()}"
                        )


class TestResponseShapeExcludesRemovedFields:
    """Verify that search_entries response shape excludes removed field names.

    Uses an in-memory database with the v3.1 lean schema to verify that
    search_entries results do not include removed columns. This tests the
    code's behavior against the target schema, independent of the live DB state.
    """

    LEAN_SCHEMA_SQL = """
    CREATE TABLE programs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    );
    CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        program_id INTEGER REFERENCES programs(id)
    );
    CREATE TABLE scheduled_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        mode TEXT NOT NULL DEFAULT 'one_time',
        due_date TEXT,
        program_id INTEGER,
        project_id INTEGER,
        template_entry_type TEXT,
        template_visibility TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        item_class TEXT NOT NULL DEFAULT 'task',
        show_on_today INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entry_date TEXT NOT NULL DEFAULT (date('now','localtime')),
        entry_type TEXT NOT NULL DEFAULT 'quick_capture',
        title TEXT NOT NULL,
        description TEXT,
        project_id INTEGER REFERENCES projects(id),
        program_id INTEGER REFERENCES programs(id),
        status TEXT NOT NULL DEFAULT 'completed',
        visibility TEXT NOT NULL DEFAULT 'shareable',
        is_accomplishment INTEGER NOT NULL DEFAULT 0,
        is_weekly_highlight INTEGER NOT NULL DEFAULT 0,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        scheduled_item_id INTEGER REFERENCES scheduled_items(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE scheduled_item_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scheduled_item_id INTEGER NOT NULL REFERENCES scheduled_items(id),
        due_date TEXT,
        status TEXT DEFAULT 'pending',
        resolved_at TEXT,
        entry_id INTEGER REFERENCES entries(id)
    );
    """

    @pytest.fixture
    def lean_db(self, tmp_path, monkeypatch):
        """Create a temporary lean-schema database and point the server at it."""
        db_file = str(tmp_path / "test_chronicle.db")
        conn = sqlite3.connect(db_file)
        conn.executescript(self.LEAN_SCHEMA_SQL)
        # Seed sample data
        conn.execute("INSERT INTO programs (id, name) VALUES (1, 'Test Program')")
        conn.execute("INSERT INTO projects (id, name, program_id) VALUES (1, 'Test Project', 1)")
        conn.execute(
            "INSERT INTO entries (id, entry_date, entry_type, title, description, project_id, program_id) "
            "VALUES (1, '2026-01-15', 'project_update', 'Test Entry', 'Some description', 1, 1)"
        )
        conn.execute(
            "INSERT INTO entries (id, entry_date, entry_type, title, description) "
            "VALUES (2, '2026-01-16', 'milestone', 'Another Entry', 'Another desc')"
        )
        conn.commit()
        conn.close()

        # Patch the server's DB_PATH
        monkeypatch.setattr(server, "DB_PATH", db_file)
        return db_file

    def test_search_entries_response_excludes_removed_fields(self, lean_db):
        """search_entries results from lean schema must not contain removed field names.

        Validates: Requirement 10.5
        """
        result_json = server.search_entries(limit=5)
        entries = json.loads(result_json)

        assert len(entries) > 0, "Expected at least one entry in test DB"
        for entry in entries:
            entry_keys = set(entry.keys())
            overlap = entry_keys & REMOVED_RESPONSE_FIELDS
            assert overlap == set(), (
                f"search_entries response contains removed fields: {overlap} "
                f"in entry id={entry.get('id')}"
            )

    @given(
        removed_field=st.sampled_from(sorted(REMOVED_RESPONSE_FIELDS)),
    )
    @settings(max_examples=20, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_no_removed_field_in_search_response_shape(self, removed_field, lean_db):
        """For each removed field name, verify it doesn't appear in search_entries output keys."""
        result_json = server.search_entries(limit=3)
        entries = json.loads(result_json)

        assert len(entries) > 0, "Expected at least one entry in test DB"
        for entry in entries:
            assert removed_field not in entry, (
                f"Removed field '{removed_field}' found in search_entries response "
                f"for entry id={entry.get('id')}"
            )


class TestCreateAndCompleteTaskSQL:
    """Verify create_and_complete_task SQL does not reference removed columns."""

    def test_insert_sql_excludes_removed_columns(self):
        """The INSERT SQL in create_and_complete_task must not reference removed columns."""
        source = inspect.getsource(server.create_and_complete_task)

        for removed_field in REMOVED_CREATE_AND_COMPLETE_PARAMS:
            # Check that the removed field isn't used in SQL column lists
            # (but allow it in comments or string comparisons)
            lines = source.split("\n")
            for line in lines:
                stripped = line.strip()
                # Skip comment lines
                if stripped.startswith("#"):
                    continue
                # Check INSERT or VALUES statements for removed field
                if "INSERT" in line.upper() or "VALUES" in line.upper():
                    assert removed_field not in stripped, (
                        f"create_and_complete_task SQL still references "
                        f"removed column '{removed_field}': {stripped}"
                    )
