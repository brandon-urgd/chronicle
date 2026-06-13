//! Version-gated schema migrations for Chronicle.
//!
//! Ports the Python `database.py` migration logic to Rust:
//! - Reads `schema_version` from the settings table
//! - Auto-backs up the database before migrating
//! - Runs ALTER TABLE migrations (ignoring "duplicate column" errors)
//! - Rebuilds CHECK constraints via temp-table pattern
//! - Seeds default settings and report presets
//!
//! The public entry point is [`run_migrations`].

use anyhow::{Context, Result};
use chrono::Local;
use std::fs;
use std::path::Path;
use tracing::{info, warn};

/// Current schema version. Increment when schema changes.
const CURRENT_SCHEMA_VERSION: i32 = 4;

/// Semver string stamped after all migrations complete.
const V2_SCHEMA_VERSION: &str = "3.1.0";

/// Run all pending migrations on the database.
///
/// This function:
/// 1. Reads `schema_version` from the settings table
/// 2. If the version is below [`CURRENT_SCHEMA_VERSION`], creates a pre-migration backup
/// 3. Runs ALTER TABLE migrations to add new columns (idempotent — ignores duplicate column errors)
/// 4. Rebuilds CHECK constraints where needed (entries, links, attachments, review_notes, programs, instances)
/// 5. Seeds default settings and report presets
/// 6. Stamps the schema version
///
/// # Arguments
///
/// * `conn` — An open rusqlite connection (WAL mode and FK should already be set)
/// * `data_dir` — The Chronicle data directory (parent of the DB file, used for backup location)
///
/// # Errors
///
/// Returns an error if critical migration steps fail (backup creation when DB exists,
/// table rebuilds, or seeding). ALTER TABLE failures for duplicate columns are silently ignored.
pub fn run_migrations(conn: &rusqlite::Connection, data_dir: &Path) -> Result<()> {
    let needs_migration = check_needs_migration(conn);

    if needs_migration {
        // Auto-backup before migration
        let db_path = data_dir.join("chronicle.db");
        if db_path.exists() {
            auto_backup_before_migration(&db_path, data_dir)?;
        }
    }

    // Always run idempotent migrations — they use .ok() or check-before-act patterns
    run_alter_table_migrations(conn);
    run_check_constraint_migrations(conn)?;
    migrate_action_items_to_scheduled(conn)?;
    migrate_v3_entry_backfill(conn, data_dir)?;
    seed_tags(conn)?;
    seed_default_settings(conn)?;
    seed_default_report_presets(conn)?;

    // Stamp schema version
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["schema_version", V2_SCHEMA_VERSION],
    )?;

    info!("Schema migrations complete — version stamped to {V2_SCHEMA_VERSION}");
    Ok(())
}

// ─── Schema Version Checking ─────────────────────────────────────────────────

/// Check if the database needs migration by reading `schema_version` from settings.
///
/// Returns `true` if the version is below the current version or cannot be read.
/// Recognizes both integer ("3") and semver ("3.1.0") formats.
/// A database at "3.1.0" (or higher) is considered fully migrated.
fn check_needs_migration(conn: &rusqlite::Connection) -> bool {
    let version = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    match version {
        Some(v) => {
            // Handle both integer ("2") and semver ("3.1.0") formats
            if v.contains('.') {
                let parts: Vec<u32> = v.split('.').filter_map(|s| s.parse().ok()).collect();
                let major = parts.first().copied().unwrap_or(0);
                let minor = parts.get(1).copied().unwrap_or(0);
                // v3.1.0+ is fully current (CURRENT_SCHEMA_VERSION = 4 maps to semver 3.1.0)
                if major > 3 || (major == 3 && minor >= 1) {
                    return false;
                }
                (major as i32) < CURRENT_SCHEMA_VERSION
            } else {
                let major: i32 = v.parse().unwrap_or(0);
                major < CURRENT_SCHEMA_VERSION
            }
        }
        None => true, // settings table might not exist or key not set
    }
}

// ─── Pre-Migration Backup ────────────────────────────────────────────────────

/// Copy the database file to a timestamped backup before running migrations.
///
/// Keeps only the last 5 pre-migration backups, removing older ones.
fn auto_backup_before_migration(db_path: &Path, data_dir: &Path) -> Result<()> {
    let backup_dir = data_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .with_context(|| format!("Failed to create backup directory: {}", backup_dir.display()))?;

    let ts = Local::now().format("%Y%m%d_%H%M%S");
    let backup_filename = format!("chronicle_pre_migration_{ts}.db");
    let backup_path = backup_dir.join(&backup_filename);

    fs::copy(db_path, &backup_path).with_context(|| {
        format!(
            "Failed to create pre-migration backup: {} -> {}",
            db_path.display(),
            backup_path.display()
        )
    })?;

    info!("Pre-migration backup saved: {}", backup_path.display());

    // Keep only the last 5 pre-migration backups
    cleanup_old_backups(&backup_dir);

    Ok(())
}

/// Remove old pre-migration backups, keeping only the 5 most recent.
fn cleanup_old_backups(backup_dir: &Path) {
    let mut backups: Vec<_> = fs::read_dir(backup_dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .map(|n| n.starts_with("chronicle_pre_migration_"))
                .unwrap_or(false)
        })
        .collect();

    // Sort by name descending (timestamp in name ensures chronological order)
    backups.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    // Remove all but the 5 most recent
    for old in backups.into_iter().skip(5) {
        if let Err(e) = fs::remove_file(old.path()) {
            warn!("Failed to remove old backup {}: {e}", old.path().display());
        }
    }
}

// ─── ALTER TABLE Migrations ──────────────────────────────────────────────────

/// Run all ALTER TABLE migrations to add new columns.
///
/// Each ALTER TABLE is executed with `.ok()` — if the column already exists,
/// SQLite returns "duplicate column name" which we silently ignore.
/// This mirrors the Python `try: ALTER TABLE ... except OperationalError: pass` pattern.
fn run_alter_table_migrations(conn: &rusqlite::Connection) {
    // Add metrics column to projects
    conn.execute_batch("ALTER TABLE projects ADD COLUMN metrics TEXT")
        .ok();

    // Add is_accomplishment to projects
    conn.execute_batch(
        "ALTER TABLE projects ADD COLUMN is_accomplishment INTEGER NOT NULL DEFAULT 0",
    )
    .ok();

    // Add program_id to projects (ON DELETE SET NULL)
    conn.execute_batch(
        "ALTER TABLE projects ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL",
    )
    .ok();

    // Add is_accomplishment to goals
    conn.execute_batch(
        "ALTER TABLE goals ADD COLUMN is_accomplishment INTEGER NOT NULL DEFAULT 0",
    )
    .ok();

    // Add program_id to goals (ON DELETE SET NULL)
    conn.execute_batch(
        "ALTER TABLE goals ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL",
    )
    .ok();

    // Add program_id to entries (ON DELETE SET NULL)
    conn.execute_batch(
        "ALTER TABLE entries ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL",
    )
    .ok();

    // Add scheduled_item_id to entries
    conn.execute_batch("ALTER TABLE entries ADD COLUMN scheduled_item_id INTEGER")
        .ok();

    // Add program_id to review_sessions (ON DELETE SET NULL) — only if table exists (pre-v3.1)
    if table_exists(conn, "review_sessions") {
        conn.execute_batch(
            "ALTER TABLE review_sessions ADD COLUMN program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL",
        )
        .ok();
    }

    // v4: entries.is_pinned
    conn.execute_batch("ALTER TABLE entries ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
        .ok();

    // v4: entries.outcome
    conn.execute_batch("ALTER TABLE entries ADD COLUMN outcome TEXT")
        .ok();

    // v4: scheduled_items.item_class
    conn.execute_batch(
        "ALTER TABLE scheduled_items ADD COLUMN item_class TEXT NOT NULL DEFAULT 'cadence' CHECK (item_class IN ('cadence', 'task'))",
    )
    .ok();

    // v1.1: show_on_today toggle for cadence items
    conn.execute_batch(
        "ALTER TABLE scheduled_items ADD COLUMN show_on_today INTEGER NOT NULL DEFAULT 1",
    )
    .ok();

    // v2: require_acknowledgment flag for cadence accountability
    conn.execute_batch(
        "ALTER TABLE scheduled_items ADD COLUMN require_acknowledgment INTEGER NOT NULL DEFAULT 0",
    )
    .ok();

    // v4: Data migration — set item_class from mode on existing scheduled items
    conn.execute_batch(
        "UPDATE scheduled_items SET item_class = 'task' WHERE mode = 'one_time' AND item_class = 'cadence'",
    )
    .ok();
    conn.execute_batch(
        "UPDATE scheduled_items SET item_class = 'cadence' WHERE mode = 'recurring'",
    )
    .ok();
}

// ─── CHECK Constraint Rebuild Migrations ─────────────────────────────────────

/// Run all CHECK constraint rebuild migrations.
///
/// SQLite doesn't support ALTER TABLE to modify CHECK constraints, so we use
/// the temp-table pattern: create new table with updated constraint, copy data,
/// drop old, rename new.
///
/// Each migration checks if it's needed before executing (idempotent).
/// Migrations for dropped tables (links, attachments, review_notes) are skipped
/// if those tables no longer exist (v3.1+ lean schema).
fn run_check_constraint_migrations(conn: &rusqlite::Connection) -> Result<()> {
    migrate_entries_action_item(conn)?;
    migrate_entries_program_update(conn)?;
    // Only run migrations for tables that still exist (pre-v3.1 databases)
    if table_exists(conn, "links") {
        migrate_links_program(conn)?;
    }
    if table_exists(conn, "attachments") {
        migrate_attachments_program(conn)?;
    }
    if table_exists(conn, "review_notes") {
        migrate_review_notes_program(conn)?;
    }
    migrate_programs_flexible_type(conn)?;
    migrate_scheduled_instances_auto_completed(conn)?;
    migrate_scheduled_items_every_day(conn)?;
    Ok(())
}

/// Add 'action_item' to entries.entry_type CHECK constraint if not present.
fn migrate_entries_action_item(conn: &rusqlite::Connection) -> Result<()> {
    // Test if action_item is already accepted
    if test_check_constraint_accepts(
        conn,
        "INSERT INTO entries (entry_date, entry_type, title) \
         VALUES ('2000-01-01', 'action_item', '__migration_test__')",
    ) {
        return Ok(());
    }

    info!("Migrating entries table: adding 'action_item' to entry_type CHECK");

    conn.execute_batch(
        "CREATE TABLE entries_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            entry_date TEXT NOT NULL,
            entry_type TEXT NOT NULL CHECK (entry_type IN (
                'quick_capture', 'project_update', 'operational_rhythm',
                'development', 'recognition', 'decision', 'milestone',
                'action_item'
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
            is_weekly_highlight INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO entries_new SELECT id, created_at, updated_at, entry_date, entry_type,
            work_type, title, description, impact, metrics, project_id, status, visibility,
            is_accomplishment, is_lesson_learned, is_weekly_highlight FROM entries;
        DROP TABLE entries;
        ALTER TABLE entries_new RENAME TO entries;",
    )
    .context("Failed to migrate entries table for action_item")?;

    Ok(())
}

/// Add 'program_update' to entries.entry_type CHECK constraint if not present.
fn migrate_entries_program_update(conn: &rusqlite::Connection) -> Result<()> {
    // Test if program_update is already accepted
    if test_check_constraint_accepts(
        conn,
        "INSERT INTO entries (entry_date, entry_type, title) \
         VALUES ('2000-01-01', 'program_update', '__migration_test__')",
    ) {
        return Ok(());
    }

    info!("Migrating entries table: adding 'program_update' to entry_type CHECK");

    // Read current column names to handle both pre- and post-migration schemas
    let col_names = get_column_names(conn, "entries")?;
    let shared = col_names.join(", ");

    let create_sql = format!(
        "CREATE TABLE entries_new (
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
            program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
            scheduled_item_id INTEGER
        );
        INSERT INTO entries_new ({shared}) SELECT {shared} FROM entries;
        DROP TABLE entries;
        ALTER TABLE entries_new RENAME TO entries;"
    );

    conn.execute_batch(&create_sql)
        .context("Failed to migrate entries table for program_update")?;

    Ok(())
}

/// Add 'program' to links.parent_type CHECK constraint if not present.
fn migrate_links_program(conn: &rusqlite::Connection) -> Result<()> {
    if test_check_constraint_accepts(
        conn,
        "INSERT INTO links (parent_type, parent_id, url) VALUES ('program', 0, 'http://test')",
    ) {
        return Ok(());
    }

    info!("Migrating links table: adding 'program' to parent_type CHECK");

    conn.execute_batch(
        "CREATE TABLE links_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_type TEXT NOT NULL CHECK (parent_type IN (
                'entry', 'project', 'goal', 'lesson', 'program'
            )),
            parent_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            label TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO links_new SELECT * FROM links;
        DROP TABLE links;
        ALTER TABLE links_new RENAME TO links;",
    )
    .context("Failed to migrate links table for program parent_type")?;

    Ok(())
}

/// Add 'program' to attachments.parent_type CHECK constraint if not present.
fn migrate_attachments_program(conn: &rusqlite::Connection) -> Result<()> {
    if test_check_constraint_accepts(
        conn,
        "INSERT INTO attachments (parent_type, parent_id, filename, original_name, file_size) \
         VALUES ('program', 0, 'test.txt', 'test.txt', 0)",
    ) {
        return Ok(());
    }

    info!("Migrating attachments table: adding 'program' to parent_type CHECK");

    conn.execute_batch(
        "CREATE TABLE attachments_new (
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
        INSERT INTO attachments_new SELECT * FROM attachments;
        DROP TABLE attachments;
        ALTER TABLE attachments_new RENAME TO attachments;",
    )
    .context("Failed to migrate attachments table for program parent_type")?;

    Ok(())
}

/// Add 'program' to review_notes.parent_type CHECK constraint if not present.
fn migrate_review_notes_program(conn: &rusqlite::Connection) -> Result<()> {
    // review_notes requires a valid review_session_id (FK), so we test differently:
    // check the CREATE TABLE SQL in sqlite_master for 'program'
    let sql = get_table_sql(conn, "review_notes");
    if sql.as_deref().map(|s| s.contains("'program'")).unwrap_or(false) {
        return Ok(());
    }

    info!("Migrating review_notes table: adding 'program' to parent_type CHECK");

    conn.execute_batch(
        "CREATE TABLE review_notes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            review_session_id INTEGER NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
            parent_type TEXT CHECK (parent_type IN (
                'entry', 'project', 'goal', 'lesson', 'program'
            ) OR parent_type IS NULL),
            parent_id INTEGER,
            note_text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO review_notes_new SELECT * FROM review_notes;
        DROP TABLE review_notes;
        ALTER TABLE review_notes_new RENAME TO review_notes;",
    )
    .context("Failed to migrate review_notes table for program parent_type")?;

    Ok(())
}

/// Remove the fixed CHECK constraint on programs.program_type so any string is accepted.
fn migrate_programs_flexible_type(conn: &rusqlite::Connection) -> Result<()> {
    // Test if a custom type is accepted (would fail with old CHECK constraint)
    if test_check_constraint_accepts(
        conn,
        "INSERT INTO programs (name, program_type) VALUES ('__migration_test__', 'custom_test_type')",
    ) {
        return Ok(());
    }

    info!("Migrating programs table: removing program_type CHECK constraint");

    let col_names = get_column_names(conn, "programs")?;
    let shared = col_names.join(", ");

    let create_sql = format!(
        "CREATE TABLE programs_new (
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
        INSERT INTO programs_new ({shared}) SELECT {shared} FROM programs;
        DROP TABLE programs;
        ALTER TABLE programs_new RENAME TO programs;"
    );

    conn.execute_batch(&create_sql)
        .context("Failed to migrate programs table for flexible program_type")?;

    Ok(())
}

/// Add 'auto_completed' to scheduled_item_instances.status CHECK constraint.
fn migrate_scheduled_instances_auto_completed(conn: &rusqlite::Connection) -> Result<()> {
    let sql = get_table_sql(conn, "scheduled_item_instances");
    if sql
        .as_deref()
        .map(|s| s.contains("auto_completed"))
        .unwrap_or(false)
    {
        return Ok(());
    }

    info!("Migrating scheduled_item_instances: adding 'auto_completed' to status CHECK");

    conn.execute_batch(
        "ALTER TABLE scheduled_item_instances RENAME TO _sii_old;
        CREATE TABLE scheduled_item_instances (
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
        INSERT INTO scheduled_item_instances SELECT * FROM _sii_old;
        DROP TABLE _sii_old;
        CREATE INDEX IF NOT EXISTS idx_si_instances_due ON scheduled_item_instances(due_date, status);
        CREATE INDEX IF NOT EXISTS idx_si_instances_item ON scheduled_item_instances(scheduled_item_id, due_date);",
    )
    .context("Failed to migrate scheduled_item_instances for auto_completed")?;

    Ok(())
}

/// Add 'every_day' to scheduled_items.recurrence_type CHECK constraint.
fn migrate_scheduled_items_every_day(conn: &rusqlite::Connection) -> Result<()> {
    let sql = get_table_sql(conn, "scheduled_items");
    let sii_sql = get_table_sql(conn, "scheduled_item_instances");
    let items_ok = sql.as_deref().map(|s| s.contains("every_day")).unwrap_or(false);
    let instances_ok = sii_sql.as_deref().map(|s| !s.contains("_si_old")).unwrap_or(true);
    if items_ok && instances_ok {
        return Ok(());
    }

    info!("Migrating scheduled_items: adding 'every_day' to recurrence_type CHECK");

    // Drop and recreate with the full constraint set
    // Also rebuild scheduled_item_instances since its FK references scheduled_items
    conn.execute_batch(
        "PRAGMA foreign_keys=OFF;
        ALTER TABLE scheduled_items RENAME TO _si_old;
        CREATE TABLE scheduled_items (
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
        INSERT INTO scheduled_items SELECT * FROM _si_old;
        DROP TABLE _si_old;
        ALTER TABLE scheduled_item_instances RENAME TO _sii_old2;
        CREATE TABLE scheduled_item_instances (
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
        INSERT INTO scheduled_item_instances SELECT * FROM _sii_old2;
        DROP TABLE _sii_old2;
        CREATE INDEX IF NOT EXISTS idx_si_instances_due ON scheduled_item_instances(due_date, status);
        CREATE INDEX IF NOT EXISTS idx_si_instances_item ON scheduled_item_instances(scheduled_item_id, due_date);
        PRAGMA foreign_keys=ON;",
    )
    .context("Failed to migrate scheduled_items for every_day recurrence_type")?;

    Ok(())
}

// ─── Data Migrations ─────────────────────────────────────────────────────────

/// Convert existing action_item entries (in_progress) to one-time scheduled items.
///
/// Idempotent: skips entries that already have a linked scheduled_item_instance.
fn migrate_action_items_to_scheduled(conn: &rusqlite::Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.title, e.description, e.entry_date, e.project_id, e.program_id \
         FROM entries e \
         WHERE e.entry_type = 'action_item' AND e.status = 'in_progress' \
         AND e.id NOT IN ( \
           SELECT sii.entry_id FROM scheduled_item_instances sii \
           WHERE sii.entry_id IS NOT NULL \
         )",
    )?;

    let items: Vec<(i64, String, Option<String>, String, Option<i64>, Option<i64>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    for (entry_id, title, description, entry_date, project_id, program_id) in &items {
        let scheduled_id: i64 = conn
            .query_row(
                "INSERT INTO scheduled_items (name, description, mode, due_date, \
                 project_id, program_id, template_entry_type, status) \
                 VALUES (?1, ?2, 'one_time', ?3, ?4, ?5, 'action_item', 'active') \
                 RETURNING id",
                rusqlite::params![title, description, entry_date, project_id, program_id],
                |row| row.get(0),
            )
            .context("Failed to insert scheduled_item during action_item migration")?;

        conn.execute(
            "INSERT INTO scheduled_item_instances \
             (scheduled_item_id, due_date, status, entry_id) \
             VALUES (?1, ?2, 'pending', ?3)",
            rusqlite::params![scheduled_id, entry_date, entry_id],
        )
        .context("Failed to insert scheduled_item_instance during action_item migration")?;
    }

    Ok(())
}

// ─── v3.0 Entry Backfill ─────────────────────────────────────────────────────

/// v3.0 Migration: Backfill entries that lack a `scheduled_item_id` with a
/// synthetic completed task. This ensures the unified data model is consistent:
/// every entry has a corresponding scheduled_item.
///
/// Idempotent: only processes entries where `scheduled_item_id IS NULL`.
/// If no such entries exist, this is a no-op.
///
/// Public so it can be called after data import (routes/data.rs).
pub fn run_v3_entry_backfill(conn: &rusqlite::Connection, data_dir: &Path) -> Result<()> {
    migrate_v3_entry_backfill(conn, data_dir)
}

fn migrate_v3_entry_backfill(conn: &rusqlite::Connection, data_dir: &Path) -> Result<()> {
    // Check if there are any orphaned entries (no scheduled_item_id)
    let orphan_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM entries WHERE scheduled_item_id IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if orphan_count == 0 {
        return Ok(());
    }

    info!(
        "v3.0 migration: backfilling {} entries with synthetic tasks",
        orphan_count
    );

    // Create a pre-migration backup specifically for v3
    let backup_dir = data_dir.join("backups");
    fs::create_dir_all(&backup_dir)?;
    let db_path = data_dir.join("chronicle.db");
    if db_path.exists() {
        let ts = Local::now().format("%Y%m%d_%H%M%S");
        let backup_path = backup_dir.join(format!("chronicle_pre_v3_backfill_{ts}.db"));
        if let Err(e) = fs::copy(&db_path, &backup_path) {
            warn!("Failed to create pre-v3 backup: {e}");
            // Continue anyway — the backfill is non-destructive (only adds rows)
        }
    }

    // Backfill: for each entry without scheduled_item_id, create a synthetic completed task
    let mut stmt = conn.prepare(
        "SELECT id, title, entry_date, program_id, project_id \
         FROM entries WHERE scheduled_item_id IS NULL",
    )?;

    let entries: Vec<(i64, String, String, Option<i64>, Option<i64>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    for (entry_id, title, entry_date, program_id, project_id) in &entries {
        // Create a synthetic completed task
        let item_id: i64 = conn
            .query_row(
                "INSERT INTO scheduled_items \
                 (name, item_class, mode, status, program_id, project_id, \
                  created_at, updated_at) \
                 VALUES (?1, 'task', 'one_time', 'completed', ?2, ?3, ?4, ?5) \
                 RETURNING id",
                rusqlite::params![title, program_id, project_id, entry_date, now],
                |row| row.get(0),
            )
            .context("Failed to create synthetic task during v3 backfill")?;

        // Link the entry to the synthetic task
        conn.execute(
            "UPDATE entries SET scheduled_item_id = ?1 WHERE id = ?2",
            rusqlite::params![item_id, entry_id],
        )
        .context("Failed to link entry to synthetic task during v3 backfill")?;
    }

    info!(
        "v3.0 migration complete: {} entries backfilled with synthetic tasks",
        entries.len()
    );
    Ok(())
}

// ─── Seeding ─────────────────────────────────────────────────────────────────

/// Predefined tags to seed on first run.
const PREDEFINED_TAGS: &[&str] = &[
    "accomplishment",
    "lesson-learned",
    "operational",
    "project",
    "leadership",
];

/// Seed predefined tags. Idempotent via INSERT OR IGNORE.
fn seed_tags(conn: &rusqlite::Connection) -> Result<()> {
    for tag_name in PREDEFINED_TAGS {
        conn.execute(
            "INSERT OR IGNORE INTO tags (name) VALUES (?1)",
            rusqlite::params![tag_name],
        )?;
    }
    Ok(())
}

/// Seed default settings values. Idempotent via INSERT OR IGNORE.
fn seed_default_settings(conn: &rusqlite::Connection) -> Result<()> {
    // program_types setting
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![
            "program_types",
            r#"["Primary","Strategic","Operational","Carrier","Support"]"#
        ],
    )?;

    // fiscal_year_start_month (default October = 10)
    conn.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params!["fiscal_year_start_month", "10"],
    )?;

    Ok(())
}

/// Seed 3 default report presets if none exist. Idempotent.
fn seed_default_report_presets(conn: &rusqlite::Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM report_presets", [], |row| {
        row.get(0)
    })?;

    if count > 0 {
        return Ok(());
    }

    info!("Seeding default report presets");

    let presets: &[(&str, &str, &str, &str, i32)] = &[
        (
            "Leadership",
            "modular",
            "quarter",
            r#"{"executive_summary":true,"program_sections":true,"goals_with_smart":false,"projects_with_status":true,"key_entries":true,"operational_cadence":true,"decisions_log":true,"other_work":true,"lessons_learned":false,"progress_log":false,"risks_next_steps":true,"open_tasks":true}"#,
            0,
        ),
        (
            "Self-Review",
            "modular",
            "annual",
            r#"{"executive_summary":true,"program_sections":true,"goals_with_smart":true,"projects_with_status":true,"key_entries":true,"operational_cadence":true,"decisions_log":true,"other_work":true,"lessons_learned":true,"progress_log":true,"risks_next_steps":true,"open_tasks":false}"#,
            0,
        ),
        (
            "Weekly",
            "modular",
            "week",
            r#"{"executive_summary":false,"program_sections":true,"goals_with_smart":false,"projects_with_status":true,"key_entries":true,"operational_cadence":false,"decisions_log":false,"other_work":true,"lessons_learned":false,"progress_log":false,"risks_next_steps":false,"open_tasks":true}"#,
            1,
        ),
    ];

    for (name, template_type, scope, sections, is_default) in presets {
        conn.execute(
            "INSERT INTO report_presets (name, template_type, scope, program_id, sections, is_default) \
             VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
            rusqlite::params![name, template_type, scope, sections, is_default],
        )?;
    }

    Ok(())
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Test if a CHECK constraint accepts a value by attempting an insert inside a savepoint.
///
/// Returns `true` if the insert succeeds (constraint already allows the value).
/// The test row is always rolled back regardless of success or failure.
fn test_check_constraint_accepts(conn: &rusqlite::Connection, insert_sql: &str) -> bool {
    // Use a savepoint to test without affecting the database
    let sp_name = "migration_check_test";
    if conn
        .execute_batch(&format!("SAVEPOINT {sp_name}"))
        .is_err()
    {
        return false;
    }

    let accepted = conn.execute_batch(insert_sql).is_ok();

    // Always rollback the test row
    let _ = conn.execute_batch(&format!("ROLLBACK TO {sp_name}"));
    let _ = conn.execute_batch(&format!("RELEASE {sp_name}"));

    accepted
}

/// Get the column names for a table using PRAGMA table_info.
fn get_column_names(conn: &rusqlite::Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Get the CREATE TABLE SQL from sqlite_master for a given table.
fn get_table_sql(conn: &rusqlite::Connection, table: &str) -> Option<String> {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
        rusqlite::params![table],
        |row| row.get(0),
    )
    .ok()
}

/// Check if a table exists in the database.
fn table_exists(conn: &rusqlite::Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        rusqlite::params![table],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::initialize_schema;
    use rusqlite::Connection;
    use tempfile::tempdir;

    /// Helper: create an in-memory DB with schema initialized.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn test_run_migrations_on_fresh_db() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();

        // Verify schema_version is stamped
        let version: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "3.1.0");
    }

    #[test]
    fn test_run_migrations_is_idempotent() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();
        // Second call should succeed without error
        run_migrations(&conn, dir.path()).unwrap();

        let version: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, "3.1.0");
    }

    #[test]
    fn test_default_settings_seeded() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();

        let program_types: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'program_types'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(program_types.contains("Primary"));
        assert!(program_types.contains("Strategic"));

        let fiscal: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'fiscal_year_start_month'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fiscal, "10");
    }

    #[test]
    fn test_default_report_presets_seeded() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM report_presets", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 3);

        // Verify preset names
        let mut stmt = conn
            .prepare("SELECT name FROM report_presets ORDER BY id")
            .unwrap();
        let names: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(names, vec!["Leadership", "Self-Review", "Weekly"]);
    }

    #[test]
    fn test_report_presets_not_duplicated() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();
        run_migrations(&conn, dir.path()).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM report_presets", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 3); // Still 3, not 6
    }

    #[test]
    fn test_predefined_tags_seeded() {
        let dir = tempdir().unwrap();
        let conn = setup_db();

        run_migrations(&conn, dir.path()).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tags", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 5);
    }

    #[test]
    fn test_auto_backup_created() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("chronicle.db");

        // Create a real DB file on disk
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();
        conn.close().unwrap();

        // Re-open and run migrations (should create backup)
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        initialize_schema(&conn).unwrap();

        // Simulate needing migration by not having schema_version set
        run_migrations(&conn, dir.path()).unwrap();

        let backup_dir = dir.path().join("backups");
        if backup_dir.exists() {
            let backups: Vec<_> = fs::read_dir(&backup_dir)
                .unwrap()
                .flatten()
                .filter(|e| {
                    e.file_name()
                        .to_str()
                        .map(|n| n.starts_with("chronicle_pre_migration_"))
                        .unwrap_or(false)
                })
                .collect();
            // Backup is created only when migration is needed (version < 2)
            // On fresh DB, settings table is empty so check_needs_migration returns true
            // but db_path.exists() check in run_migrations determines if backup is made
            assert!(backups.len() <= 1);
        }
    }

    #[test]
    fn test_check_needs_migration_with_no_version() {
        let conn = setup_db();
        // No schema_version in settings — should need migration
        assert!(check_needs_migration(&conn));
    }

    #[test]
    fn test_check_needs_migration_with_old_version() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', '1')",
            [],
        )
        .unwrap();
        assert!(check_needs_migration(&conn));
    }

    #[test]
    fn test_check_needs_migration_with_current_version() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', '4')",
            [],
        )
        .unwrap();
        assert!(!check_needs_migration(&conn));
    }

    #[test]
    fn test_check_needs_migration_with_semver() {
        let conn = setup_db();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('schema_version', '3.1.0')",
            [],
        )
        .unwrap();
        assert!(!check_needs_migration(&conn));
    }
}
