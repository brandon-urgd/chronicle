//! Database pool creation, connection configuration, and shared application state.
//!
//! Provides `init_pool()` to create an r2d2 connection pool with WAL mode,
//! foreign key enforcement, and busy timeout configured on every connection.

pub mod migrations;
pub mod schema;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::watch;

/// Application configuration resolved at startup.
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// Path to the SQLite database file.
    pub db_path: PathBuf,
    /// Path to the data directory (parent of db file, attachments, backups).
    pub data_dir: PathBuf,
    /// Port the HTTP server binds to.
    pub port: u16,
}

/// Shared application state passed to all route handlers via axum's State extractor.
pub struct AppState {
    /// r2d2 connection pool for SQLite.
    pub pool: Pool<SqliteConnectionManager>,
    /// Resolved application configuration.
    pub config: AppConfig,
    /// Shutdown signal sender. Set to `true` to initiate graceful shutdown.
    pub shutdown_tx: watch::Sender<bool>,
}

/// Type alias for the shared state wrapped in an Arc for thread-safe access.
pub type SharedState = Arc<AppState>;

/// Configure pragmas on each new SQLite connection obtained from the pool.
///
/// Sets:
/// - WAL journal mode for concurrent read/write
/// - Foreign key enforcement
/// - 5-second busy timeout to handle lock contention
fn configure_connection(conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=5000;",
    )
}

/// Create and return an r2d2 connection pool for the SQLite database.
///
/// The pool is configured with:
/// - max_size=4 (sufficient for a single-user desktop app)
/// - Per-connection initialization that sets WAL mode, FK enforcement, and busy timeout
///
/// # Errors
///
/// Returns an error if the pool cannot be built (e.g., invalid db_path).
pub fn init_pool(config: &AppConfig) -> Result<Pool<SqliteConnectionManager>, r2d2::Error> {
    let manager =
        SqliteConnectionManager::file(&config.db_path).with_init(configure_connection);

    Pool::builder().max_size(4).build(manager)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Verify that init_pool creates a working pool with correct pragma settings.
    #[test]
    fn test_init_pool_creates_pool_with_correct_pragmas() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test_chronicle.db");

        let config = AppConfig {
            db_path: db_path.clone(),
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };

        let pool = init_pool(&config).expect("pool should be created successfully");

        // Get a connection and verify pragmas
        let conn = pool.get().expect("should get a connection from pool");

        // Check WAL mode
        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_lowercase(), "wal");

        // Check foreign keys enabled
        let fk_enabled: i32 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk_enabled, 1);

        // Check busy timeout
        let busy_timeout: i32 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 5000);
    }

    /// Verify pool max_size is respected (can get up to 4 connections).
    #[test]
    fn test_pool_max_size() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test_pool_size.db");

        let config = AppConfig {
            db_path,
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };

        let pool = init_pool(&config).unwrap();

        // Should be able to get 4 connections
        let _c1 = pool.get().unwrap();
        let _c2 = pool.get().unwrap();
        let _c3 = pool.get().unwrap();
        let _c4 = pool.get().unwrap();

        // Pool state should show max 4
        assert_eq!(pool.max_size(), 4);
    }

    /// Verify that the database file is created when the pool is initialized.
    #[test]
    fn test_pool_creates_database_file() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("new_db.db");

        assert!(!db_path.exists());

        let config = AppConfig {
            db_path: db_path.clone(),
            data_dir: dir.path().to_path_buf(),
            port: 8180,
        };

        let pool = init_pool(&config).unwrap();
        // Getting a connection triggers file creation
        let _conn = pool.get().unwrap();

        assert!(db_path.exists());
    }

    /// Verify AppState can be constructed and wrapped in Arc (SharedState).
    #[test]
    fn test_shared_state_construction() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("state_test.db");

        let config = AppConfig {
            db_path,
            data_dir: dir.path().to_path_buf(),
            port: 8185,
        };

        let pool = init_pool(&config).unwrap();
        let (shutdown_tx, _shutdown_rx) = watch::channel(false);

        let state: SharedState = Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        });

        // Verify we can access fields through the Arc
        assert_eq!(state.config.port, 8185);
        assert_eq!(state.pool.max_size(), 4);
    }
}
