//! Schema initialization for the Chronicle SQLite database.
//!
//! Contains all CREATE TABLE IF NOT EXISTS statements and performance indexes.
//! This represents the final v2.0.0 schema with all migrations applied.
//! The Rust backend creates tables in their fully-migrated form so that
//! existing databases (already migrated) and fresh databases both work.

/// Initialize the full database schema.
///
/// Runs all CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS statements.
/// This is idempotent — safe to call on both new and existing databases.
///
/// # Errors
///
/// Returns a `rusqlite::Error` if any DDL statement fails.
pub fn initialize_schema(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    conn.execute_batch(INDEX_SQL)?;
    Ok(())
}

/// All CREATE TABLE IF NOT EXISTS statements for the Chronicle schema.
///
/// Tables are ordered to respect foreign key dependencies:
/// - Independent tables first (programs, goals, settings, tags, stakeholders)
/// - Dependent tables after their parents (projects → entries → instances, etc.)
const SCHEMA_SQL: &str = r#"
-- 0a. programs (no FK dependencies)
CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    description TEXT,
    program_type TEXT NOT NULL DEFAULT 'Primary',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'sunset'
    )),
    owner TEXT,
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- 0b. program_progress_log (references programs)
CREATE TABLE IF NOT EXISTS program_progress_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT NOT NULL,
    status_at_time TEXT NOT NULL
);

-- 1. goals (references programs)
CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    title TEXT NOT NULL,
    description TEXT,
    specific TEXT,
    measurable TEXT,
    achievable TEXT,
    relevant TEXT,
    time_bound TEXT,
    fiscal_year INTEGER,
    quarter INTEGER,
    status TEXT NOT NULL DEFAULT 'on_track' CHECK (status IN (
        'on_track', 'at_risk', 'behind', 'completed', 'paused'
    )),
    target_date TEXT,
    is_accomplishment INTEGER NOT NULL DEFAULT 0,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL
);

-- 2. projects (references goals, programs)
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    description TEXT,
    metrics TEXT,
    start_date TEXT,
    target_end_date TEXT,
    actual_end_date TEXT,
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN (
        'planning', 'active', 'completed', 'paused'
    )),
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    is_accomplishment INTEGER NOT NULL DEFAULT 0,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL
);

-- 2b. scheduled_items (references programs, projects)
CREATE TABLE IF NOT EXISTS scheduled_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    description TEXT,
    mode TEXT NOT NULL DEFAULT 'one_time' CHECK (mode IN ('one_time', 'recurring')),
    due_date TEXT,
    recurrence_type TEXT CHECK (recurrence_type IN (
        'daily', 'every_day', 'weekly', 'biweekly', 'monthly', 'quarterly', 'annual'
    )),
    day_of_week INTEGER,
    day_of_month INTEGER,
    month_of_year INTEGER,
    time_of_day TEXT,
    day_range_start INTEGER,
    day_range_end INTEGER,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    template_entry_type TEXT NOT NULL DEFAULT 'operational_rhythm',
    template_work_type TEXT NOT NULL DEFAULT 'operational_rhythm',
    template_tags TEXT,
    template_visibility TEXT NOT NULL DEFAULT 'shareable',
    quick_complete INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'active', 'paused', 'archived', 'completed'
    )),
    sort_order INTEGER NOT NULL DEFAULT 0,
    item_class TEXT NOT NULL DEFAULT 'cadence' CHECK (item_class IN ('cadence', 'task')),
    show_on_today INTEGER NOT NULL DEFAULT 1,
    require_acknowledgment INTEGER NOT NULL DEFAULT 0
);

-- 3. entries (references projects, programs, scheduled_items)
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    entry_date TEXT NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'quick_capture', 'project_update', 'operational_rhythm',
        'development', 'recognition', 'decision', 'milestone',
        'action_item', 'program_update'
    )),
    work_type TEXT NOT NULL CHECK (work_type IN ('project', 'operational_rhythm')),
    title TEXT NOT NULL,
    description TEXT,
    impact TEXT,
    metrics TEXT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN (
        'in_progress', 'completed', 'ongoing', 'paused'
    )),
    visibility TEXT NOT NULL DEFAULT 'shareable' CHECK (visibility IN (
        'personal', 'shareable'
    )),
    is_accomplishment INTEGER NOT NULL DEFAULT 0,
    is_lesson_learned INTEGER NOT NULL DEFAULT 0,
    is_weekly_highlight INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    outcome TEXT,
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    scheduled_item_id INTEGER
);

-- 3b. scheduled_item_instances (references scheduled_items, entries)
CREATE TABLE IF NOT EXISTS scheduled_item_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduled_item_id INTEGER NOT NULL REFERENCES scheduled_items(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    due_date TEXT NOT NULL,
    due_time TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'completed', 'skipped', 'auto_completed'
    )),
    resolved_at TEXT,
    notes TEXT,
    skip_reason TEXT,
    entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    UNIQUE(scheduled_item_id, due_date)
);

-- 4. goal_progress_log (references goals)
CREATE TABLE IF NOT EXISTS goal_progress_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT NOT NULL,
    status_at_time TEXT NOT NULL
);

-- 4b. project_progress_log (references projects)
CREATE TABLE IF NOT EXISTS project_progress_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    note TEXT NOT NULL,
    status_at_time TEXT NOT NULL
);

-- 5. lessons_learned (references entries, projects)
CREATE TABLE IF NOT EXISTS lessons_learned (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    title TEXT NOT NULL,
    context TEXT,
    lesson TEXT,
    application TEXT,
    source_entry_id INTEGER REFERENCES entries(id) ON DELETE SET NULL,
    source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    date_range_start TEXT,
    date_range_end TEXT,
    date_range_label TEXT
);

-- 6. tags (no FK dependencies)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. entry_tags (references entries, tags)
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, tag_id)
);

-- 8. lesson_tags (references lessons_learned, tags)
CREATE TABLE IF NOT EXISTS lesson_tags (
    lesson_id INTEGER NOT NULL REFERENCES lessons_learned(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (lesson_id, tag_id)
);

-- 9. links (no FK dependencies — polymorphic parent)
CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_type TEXT NOT NULL CHECK (parent_type IN (
        'entry', 'project', 'goal', 'lesson', 'program'
    )),
    parent_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 10. attachments (no FK dependencies — polymorphic parent)
CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_type TEXT NOT NULL CHECK (parent_type IN (
        'entry', 'project', 'goal', 'lesson', 'program'
    )),
    parent_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 11. settings (no FK dependencies)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 12. review_sessions (references programs)
CREATE TABLE IF NOT EXISTS review_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_date TEXT NOT NULL,
    date_range_start TEXT NOT NULL,
    date_range_end TEXT NOT NULL,
    review_type TEXT NOT NULL CHECK (review_type IN (
        'weekly', 'monthly', 'quarterly', 'annual', 'custom'
    )),
    session_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL
);

-- 13. review_notes (references review_sessions)
CREATE TABLE IF NOT EXISTS review_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
    parent_type TEXT CHECK (parent_type IN (
        'entry', 'project', 'goal', 'lesson', 'program'
    ) OR parent_type IS NULL),
    parent_id INTEGER,
    note_text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 14. stakeholders (no FK dependencies)
CREATE TABLE IF NOT EXISTS stakeholders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 15. project_stakeholders (references projects, stakeholders)
CREATE TABLE IF NOT EXISTS project_stakeholders (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stakeholder_id INTEGER NOT NULL REFERENCES stakeholders(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, stakeholder_id)
);

-- 16. report_presets (references programs)
CREATE TABLE IF NOT EXISTS report_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    template_type TEXT NOT NULL DEFAULT 'modular',
    scope TEXT NOT NULL DEFAULT 'week',
    program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
    sections TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT 0
);

-- 17. notes (no FK dependencies)
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    dismissed_at TEXT
);

-- 18. report_drafts (references report_presets)
CREATE TABLE IF NOT EXISTS report_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'sent')),
    preset_id INTEGER REFERENCES report_presets(id) ON DELETE SET NULL,
    date_range_start TEXT,
    date_range_end TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"#;

/// All CREATE INDEX IF NOT EXISTS statements for performance.
///
/// Includes the 9 general performance indexes plus 4 specialized indexes
/// for scheduled instances, notes, and report drafts.
const INDEX_SQL: &str = r#"
-- Scheduled item instance indexes (critical for due-date queries)
CREATE INDEX IF NOT EXISTS idx_si_instances_due ON scheduled_item_instances(due_date, status);
CREATE INDEX IF NOT EXISTS idx_si_instances_item ON scheduled_item_instances(scheduled_item_id, due_date);

-- Entry indexes (commonly filtered columns)
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_entries_program ON entries(program_id);
CREATE INDEX IF NOT EXISTS idx_entries_project ON entries(project_id);
CREATE INDEX IF NOT EXISTS idx_entries_type ON entries(entry_type);

-- Goal and project indexes
CREATE INDEX IF NOT EXISTS idx_goals_program ON goals(program_id);
CREATE INDEX IF NOT EXISTS idx_projects_program ON projects(program_id);
CREATE INDEX IF NOT EXISTS idx_projects_goal ON projects(goal_id);

-- Polymorphic parent indexes (links and attachments)
CREATE INDEX IF NOT EXISTS idx_links_parent ON links(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS idx_attachments_parent ON attachments(parent_type, parent_id);

-- Notes index (active/dismissed filtering)
CREATE INDEX IF NOT EXISTS idx_notes_active ON notes(dismissed_at);

-- Report drafts index (status filtering)
CREATE INDEX IF NOT EXISTS idx_report_drafts_status ON report_drafts(status);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// Verify that initialize_schema creates all 23 tables successfully.
    #[test]
    fn test_initialize_schema_creates_all_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        initialize_schema(&conn).unwrap();

        // Query sqlite_master for all user-defined tables (exclude sqlite_sequence)
        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            )
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected_tables = vec![
            "attachments",
            "entries",
            "entry_tags",
            "goal_progress_log",
            "goals",
            "lesson_tags",
            "lessons_learned",
            "links",
            "notes",
            "program_progress_log",
            "programs",
            "project_progress_log",
            "project_stakeholders",
            "projects",
            "report_drafts",
            "report_presets",
            "review_notes",
            "review_sessions",
            "scheduled_item_instances",
            "scheduled_items",
            "settings",
            "stakeholders",
            "tags",
        ];

        for table in &expected_tables {
            assert!(
                tables.contains(&table.to_string()),
                "Missing table: {table}"
            );
        }
        assert_eq!(tables.len(), expected_tables.len());
    }

    /// Verify that initialize_schema is idempotent (can be called twice without error).
    #[test]
    fn test_initialize_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        initialize_schema(&conn).unwrap();
        // Second call should succeed without error
        initialize_schema(&conn).unwrap();
    }

    /// Verify that all performance indexes are created.
    #[test]
    fn test_initialize_schema_creates_indexes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        initialize_schema(&conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
            .unwrap();
        let indexes: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected_indexes = vec![
            "idx_attachments_parent",
            "idx_entries_date",
            "idx_entries_program",
            "idx_entries_project",
            "idx_entries_type",
            "idx_goals_program",
            "idx_links_parent",
            "idx_notes_active",
            "idx_projects_goal",
            "idx_projects_program",
            "idx_report_drafts_status",
            "idx_si_instances_due",
            "idx_si_instances_item",
        ];

        for idx in &expected_indexes {
            assert!(
                indexes.contains(&idx.to_string()),
                "Missing index: {idx}"
            );
        }
    }

    /// Verify CHECK constraints work on entries.entry_type.
    #[test]
    fn test_entry_type_check_constraint() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        // Valid entry types should succeed
        let valid_types = [
            "quick_capture", "project_update", "operational_rhythm",
            "development", "recognition", "decision", "milestone",
            "action_item", "program_update",
        ];
        for entry_type in valid_types {
            conn.execute(
                "INSERT INTO entries (entry_date, entry_type, work_type, title) VALUES (?1, ?2, 'project', 'test')",
                rusqlite::params!["2025-01-01", entry_type],
            )
            .unwrap_or_else(|e| panic!("Valid entry_type '{entry_type}' was rejected: {e}"));
        }

        // Invalid entry type should fail
        let result = conn.execute(
            "INSERT INTO entries (entry_date, entry_type, work_type, title) VALUES ('2025-01-01', 'invalid_type', 'project', 'test')",
            [],
        );
        assert!(result.is_err(), "Invalid entry_type should be rejected");
    }

    /// Verify CHECK constraints work on scheduled_item_instances.status (includes auto_completed).
    #[test]
    fn test_instance_status_check_constraint() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        // Create a parent scheduled_item first
        conn.execute(
            "INSERT INTO scheduled_items (name) VALUES ('test item')",
            [],
        )
        .unwrap();

        let valid_statuses = ["pending", "completed", "skipped", "auto_completed"];
        for (i, status) in valid_statuses.iter().enumerate() {
            conn.execute(
                "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) VALUES (1, ?1, ?2)",
                rusqlite::params![format!("2025-01-{:02}", i + 1), status],
            )
            .unwrap_or_else(|e| panic!("Valid status '{status}' was rejected: {e}"));
        }

        // Invalid status should fail
        let result = conn.execute(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) VALUES (1, '2025-02-01', 'invalid')",
            [],
        );
        assert!(result.is_err(), "Invalid instance status should be rejected");
    }

    /// Verify foreign key CASCADE delete works (programs → program_progress_log).
    #[test]
    fn test_cascade_delete_program_progress() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        conn.execute("INSERT INTO programs (name) VALUES ('Test Program')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO program_progress_log (program_id, note, status_at_time) VALUES (1, 'progress', 'active')",
            [],
        )
        .unwrap();

        // Verify log exists
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM program_progress_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        // Delete program — should CASCADE to progress log
        conn.execute("DELETE FROM programs WHERE id = 1", []).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM program_progress_log", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    /// Verify foreign key SET NULL works (goals.program_id → programs).
    #[test]
    fn test_set_null_on_program_delete() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        conn.execute("INSERT INTO programs (name) VALUES ('Test Program')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO goals (title, program_id) VALUES ('Test Goal', 1)",
            [],
        )
        .unwrap();

        // Delete program — goal.program_id should become NULL
        conn.execute("DELETE FROM programs WHERE id = 1", []).unwrap();

        let program_id: Option<i64> = conn
            .query_row("SELECT program_id FROM goals WHERE id = 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(program_id, None);
    }

    /// Verify the UNIQUE constraint on scheduled_item_instances(scheduled_item_id, due_date).
    #[test]
    fn test_instance_unique_constraint() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        conn.execute("INSERT INTO scheduled_items (name) VALUES ('test')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) VALUES (1, '2025-01-15', 'pending')",
            [],
        )
        .unwrap();

        // Duplicate should fail
        let result = conn.execute(
            "INSERT INTO scheduled_item_instances (scheduled_item_id, due_date, status) VALUES (1, '2025-01-15', 'pending')",
            [],
        );
        assert!(result.is_err(), "Duplicate instance should be rejected by UNIQUE constraint");
    }

    // ─── Property-Based Tests ───────────────────────────────────────────────

    use proptest::prelude::*;

    /// Strategy to generate a valid operation type for referential integrity testing.
    #[derive(Debug, Clone)]
    enum FkOperation {
        CreateProgram,
        CreateEntryWithProgram,
        CreateEntryWithProject,
        CreateTagAndLink,
        DeleteProgram,
        DeleteProject,
        DeleteEntry,
    }

    fn arb_fk_operation() -> impl Strategy<Value = FkOperation> {
        prop::sample::select(vec![
            FkOperation::CreateProgram,
            FkOperation::CreateEntryWithProgram,
            FkOperation::CreateEntryWithProject,
            FkOperation::CreateTagAndLink,
            FkOperation::DeleteProgram,
            FkOperation::DeleteProject,
            FkOperation::DeleteEntry,
        ])
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        // Feature: rust-backend-rewrite, Property 12: Referential Integrity Preservation
        /// **Validates: Requirements 14.6**
        #[test]
        fn prop_referential_integrity(
            num_programs in 1usize..=5,
            num_entries in 1usize..=10,
        ) {
            let conn = Connection::open_in_memory().unwrap();
            conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
            initialize_schema(&conn).unwrap();

            // Phase 1: Create programs
            for i in 0..num_programs {
                conn.execute(
                    "INSERT INTO programs (name) VALUES (?1)",
                    rusqlite::params![format!("Program {}", i)],
                ).unwrap();
            }

            // Phase 2: Create a project referencing the first program
            conn.execute(
                "INSERT INTO projects (name, program_id) VALUES ('Test Project', 1)",
                [],
            ).unwrap();
            let project_id: i64 = conn.last_insert_rowid();

            // Phase 3: Create entries referencing the project
            for i in 0..num_entries {
                conn.execute(
                    "INSERT INTO entries (entry_date, entry_type, work_type, title, project_id, program_id) \
                     VALUES ('2025-01-15', 'quick_capture', 'project', ?1, ?2, 1)",
                    rusqlite::params![format!("Entry {}", i), project_id],
                ).unwrap();
            }

            // Phase 4: Create tags and entry_tags associations
            conn.execute("INSERT INTO tags (name) VALUES ('test-tag')", []).unwrap();
            let tag_id: i64 = conn.last_insert_rowid();
            // Link tag to first entry
            conn.execute(
                "INSERT INTO entry_tags (entry_id, tag_id) VALUES (1, ?1)",
                rusqlite::params![tag_id],
            ).unwrap();

            // Phase 5: Delete the project — entries.project_id should become NULL (SET NULL)
            conn.execute(
                "DELETE FROM projects WHERE id = ?1",
                rusqlite::params![project_id],
            ).unwrap();

            // Verify: entries still exist but project_id is NULL
            let entry_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
                .unwrap();
            prop_assert_eq!(entry_count, num_entries as i64,
                "Entries should not be deleted when project is deleted (SET NULL behavior)");

            let orphaned_entries: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM entries WHERE project_id IS NOT NULL",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            prop_assert_eq!(orphaned_entries, 0,
                "All entries should have NULL project_id after project deletion");

            // Phase 6: Delete the first entry — entry_tags should CASCADE delete
            conn.execute("DELETE FROM entries WHERE id = 1", []).unwrap();

            let tag_links: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM entry_tags WHERE entry_id = 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            prop_assert_eq!(tag_links, 0,
                "entry_tags should be CASCADE deleted when entry is deleted");

            // Phase 7: Delete the program — entries.program_id should become NULL
            conn.execute("DELETE FROM programs WHERE id = 1", []).unwrap();

            let orphaned_program_refs: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM entries WHERE program_id IS NOT NULL AND program_id = 1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            prop_assert_eq!(orphaned_program_refs, 0,
                "All entries should have NULL program_id after program deletion (SET NULL)");

            // Final integrity check: no FK violations exist
            let fk_violations: i64 = conn
                .query_row("PRAGMA foreign_key_check", [], |row| row.get::<_, i64>(0))
                .unwrap_or(0);
            // foreign_key_check returns rows only if violations exist; if query returns no rows, we get an error
            // So we use a different approach:
            let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
            let violation_count = stmt.query_map([], |_row| Ok(())).unwrap().count();
            prop_assert_eq!(violation_count, 0,
                "Database should have zero FK violations after all operations");
        }
    }
}
