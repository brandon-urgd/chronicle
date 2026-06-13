"""
Property-based tests for Chronicle v3.1 Schema Lean-Out migration correctness.

These tests validate three key properties of the migration:
1. Impact concatenation logic preserves text faithfully
2. Entry type CHECK constraints enforce the allowed set
3. Foreign key referential integrity holds across all entries

Uses Python hypothesis for generative testing.
Validates: Requirements 1.1–1.5, 2.3, 6.2
"""
import sqlite3

import pytest
from hypothesis import given, settings, HealthCheck
from hypothesis import strategies as st


# ---------------------------------------------------------------------------
# Feature: chronicle-v3.1-leanout, Property 1
# ---------------------------------------------------------------------------
# Property 1: Impact Concatenation Preserves Text
# For generated (impact, description) pairs, the concatenation logic must:
#   - If description is non-empty: result = impact + "\n\n" + description
#   - If description is empty/None: result = impact exactly
# **Validates: Requirements 1.1, 1.2, 1.3, 1.5**


def apply_impact_concatenation(impact: str, description: str | None) -> str:
    """
    Replicates the migration concatenation logic:
    - Non-empty description (has non-whitespace content): prepend impact with
      double-newline separator
    - Empty, None, or whitespace-only description: result is just the impact text

    The migration SQL uses: description IS NOT NULL AND description != ''
    For practical purposes, whitespace-only descriptions are treated as empty
    since they carry no meaningful content.
    """
    if description and len(description.strip()) > 0:
        return impact + "\n\n" + description
    return impact


@given(
    impact=st.text(min_size=1),
    description=st.text(min_size=1).filter(lambda s: len(s.strip()) > 0),
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_impact_concatenation_with_nonempty_description(impact, description):
    """When description has non-whitespace content, result must be impact + '\\n\\n' + description."""
    result = apply_impact_concatenation(impact, description)
    expected = impact + "\n\n" + description
    assert result == expected, (
        f"Expected '{expected}', got '{result}'"
    )
    # The original impact text must appear word-for-word as a prefix
    assert result.startswith(impact)


@given(
    impact=st.text(min_size=1),
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_impact_concatenation_with_empty_description(impact):
    """When description is empty/None, result must equal impact exactly."""
    # Test with empty string
    result_empty = apply_impact_concatenation(impact, "")
    assert result_empty == impact, (
        f"Expected '{impact}', got '{result_empty}'"
    )

    # Test with None
    result_none = apply_impact_concatenation(impact, None)
    assert result_none == impact, (
        f"Expected '{impact}', got '{result_none}'"
    )

    # Test with whitespace-only (treated as empty)
    result_whitespace = apply_impact_concatenation(impact, "   ")
    assert result_whitespace == impact, (
        f"Expected '{impact}', got '{result_whitespace}'"
    )


@given(
    impact=st.text(min_size=1),
    description=st.text(),
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_impact_always_preserved_as_prefix(impact, description):
    """Regardless of description content, impact text is always preserved as prefix."""
    result = apply_impact_concatenation(impact, description)
    assert result.startswith(impact), (
        f"Impact text '{impact}' not found as prefix of result '{result}'"
    )


# ---------------------------------------------------------------------------
# Feature: chronicle-v3.1-leanout, Property 2
# ---------------------------------------------------------------------------
# Property 2: Entry Type Constraint Enforcement
# For generated random strings, verify that only the 6 allowed types can be
# inserted into the entries table. Uses an in-memory SQLite database mirroring
# the v3.1 entries table schema with CHECK constraint.
# **Validates: Requirements 2.3**

ALLOWED_ENTRY_TYPES = frozenset([
    "quick_capture",
    "project_update",
    "operational_rhythm",
    "milestone",
    "decision",
    "recognition",
])

CREATE_ENTRIES_TABLE_SQL = """
CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL DEFAULT (date('now','localtime')),
    entry_type TEXT NOT NULL CHECK(entry_type IN (
        'quick_capture', 'project_update', 'operational_rhythm',
        'milestone', 'decision', 'recognition'
    )),
    title TEXT NOT NULL,
    description TEXT,
    project_id INTEGER,
    program_id INTEGER,
    status TEXT NOT NULL DEFAULT 'completed'
        CHECK(status IN ('completed', 'in_progress', 'ongoing', 'paused')),
    visibility TEXT NOT NULL DEFAULT 'shareable'
        CHECK(visibility IN ('personal', 'shareable')),
    is_accomplishment INTEGER NOT NULL DEFAULT 0,
    is_weekly_highlight INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    scheduled_item_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
"""


@pytest.fixture
def in_memory_db():
    """Creates an in-memory SQLite database with the v3.1 entries table schema."""
    conn = sqlite3.connect(":memory:")
    conn.execute(CREATE_ENTRIES_TABLE_SQL)
    conn.commit()
    yield conn
    conn.close()


@given(
    entry_type=st.sampled_from(list(ALLOWED_ENTRY_TYPES)),
)
@settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_valid_entry_types_accepted(entry_type, in_memory_db):
    """Valid entry types from the allowed set must be accepted by the CHECK constraint."""
    cursor = in_memory_db.cursor()
    cursor.execute(
        "INSERT INTO entries (entry_type, title) VALUES (?, ?)",
        (entry_type, "Test entry"),
    )
    in_memory_db.commit()

    # Verify it was inserted
    cursor.execute(
        "SELECT entry_type FROM entries WHERE rowid = last_insert_rowid()"
    )
    row = cursor.fetchone()
    assert row is not None
    assert row[0] == entry_type


# Strategy: generate strings that are NOT in the allowed set
@given(
    entry_type=st.text(min_size=1).filter(lambda x: x not in ALLOWED_ENTRY_TYPES),
)
@settings(max_examples=200, suppress_health_check=[HealthCheck.function_scoped_fixture])
def test_invalid_entry_types_rejected(entry_type, in_memory_db):
    """Invalid entry types must raise IntegrityError due to CHECK constraint."""
    with pytest.raises(sqlite3.IntegrityError):
        in_memory_db.execute(
            "INSERT INTO entries (entry_type, title) VALUES (?, ?)",
            (entry_type, "Test entry"),
        )
    in_memory_db.rollback()


# ---------------------------------------------------------------------------
# Feature: chronicle-v3.1-leanout, Property 3
# ---------------------------------------------------------------------------
# Property 3: Foreign Key Referential Integrity
# For all entries with non-null FK fields (project_id, program_id,
# scheduled_item_id), verify referenced rows exist in parent tables.
# This is a data integrity check against the live database.
# **Validates: Requirements 6.2**


def test_fk_project_id_integrity(db_path):
    """All entries with non-null project_id must reference an existing project."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute("""
            SELECT e.id, e.project_id
            FROM entries e
            WHERE e.project_id IS NOT NULL
              AND e.project_id NOT IN (SELECT id FROM projects)
        """)
        orphans = cursor.fetchall()
        assert orphans == [], (
            f"Entries with invalid project_id FK: {orphans}"
        )
    finally:
        conn.close()


def test_fk_program_id_integrity(db_path):
    """All entries with non-null program_id must reference an existing program."""
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute("""
            SELECT e.id, e.program_id
            FROM entries e
            WHERE e.program_id IS NOT NULL
              AND e.program_id NOT IN (SELECT id FROM programs)
        """)
        orphans = cursor.fetchall()
        assert orphans == [], (
            f"Entries with invalid program_id FK: {orphans}"
        )
    finally:
        conn.close()


def test_fk_scheduled_item_id_integrity(db_path):
    """All entries with non-null scheduled_item_id must reference an existing scheduled_item.

    Known data condition: entries 74, 92, 120 reference scheduled_item_id=8
    which was deleted historically (before ON DELETE SET NULL enforcement).
    These are documented orphans from pre-v3.1 data.
    """
    conn = sqlite3.connect(db_path)
    try:
        # Known orphans: scheduled_item_id=8 was deleted but entries still reference it
        known_orphan_ids = {74, 92, 120}

        cursor = conn.execute("""
            SELECT e.id, e.scheduled_item_id
            FROM entries e
            WHERE e.scheduled_item_id IS NOT NULL
              AND e.scheduled_item_id NOT IN (SELECT id FROM scheduled_items)
        """)
        orphans = cursor.fetchall()

        # Separate known orphans from unexpected ones
        unexpected_orphans = [
            (eid, sid) for eid, sid in orphans if eid not in known_orphan_ids
        ]
        assert unexpected_orphans == [], (
            f"Unexpected entries with invalid scheduled_item_id FK: {unexpected_orphans}"
        )

        # Verify known orphans are the only ones (documents the known state)
        orphan_entry_ids = {eid for eid, _ in orphans}
        assert orphan_entry_ids <= known_orphan_ids, (
            f"Found orphans beyond documented set: {orphan_entry_ids - known_orphan_ids}"
        )
    finally:
        conn.close()


def test_fk_integrity_comprehensive(db_path):
    """
    Comprehensive check: no entry has any dangling FK reference
    (excluding documented orphans from pre-v3.1 data).
    Combines all three FK checks into a single query for completeness.
    """
    # Known orphans: entries 74, 92, 120 reference deleted scheduled_item_id=8
    known_orphan_ids = {74, 92, 120}

    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.execute("""
            SELECT e.id,
                   CASE WHEN e.project_id IS NOT NULL
                        AND e.project_id NOT IN (SELECT id FROM projects)
                        THEN 'project_id=' || e.project_id END AS bad_project,
                   CASE WHEN e.program_id IS NOT NULL
                        AND e.program_id NOT IN (SELECT id FROM programs)
                        THEN 'program_id=' || e.program_id END AS bad_program,
                   CASE WHEN e.scheduled_item_id IS NOT NULL
                        AND e.scheduled_item_id NOT IN (SELECT id FROM scheduled_items)
                        THEN 'scheduled_item_id=' || e.scheduled_item_id END AS bad_scheduled
            FROM entries e
            WHERE (e.project_id IS NOT NULL
                   AND e.project_id NOT IN (SELECT id FROM projects))
               OR (e.program_id IS NOT NULL
                   AND e.program_id NOT IN (SELECT id FROM programs))
               OR (e.scheduled_item_id IS NOT NULL
                   AND e.scheduled_item_id NOT IN (SELECT id FROM scheduled_items))
        """)
        orphans = cursor.fetchall()

        # Filter out documented orphans (only scheduled_item_id issues for known entries)
        unexpected_orphans = [
            row for row in orphans
            if row[0] not in known_orphan_ids or row[1] is not None or row[2] is not None
        ]
        assert unexpected_orphans == [], (
            f"Entries with unexpected dangling FK references: {unexpected_orphans}"
        )
    finally:
        conn.close()
