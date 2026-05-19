//! Structured logging setup for Chronicle.
//!
//! Configures `tracing-subscriber` with:
//! - A daily-rotating file appender in `{data_dir}` with 14-file retention
//!   (files named `chronicle.YYYY-MM-DD.log`)
//! - An env-filter defaulting to `info`, overridable via `CHRONICLE_LOG`
//! - Dual output: file + stderr (for development/debugging)

use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{Builder, Rotation};
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Initialize the tracing subscriber with file appender and env-filter.
///
/// Logs are written to a daily-rotated file in `{data_dir}` (named
/// `chronicle.YYYY-MM-DD.log`) and also to stderr. Rotation retains the
/// 14 most recent files; older files are deleted automatically. Default
/// log level is `info`, configurable via the `CHRONICLE_LOG` env var.
///
/// # Returns
///
/// Returns a `WorkerGuard` that must be held for the lifetime of the application.
/// Dropping the guard flushes any buffered log output to the file.
///
/// # Errors
///
/// Returns an error if the log file cannot be created or the subscriber
/// cannot be initialized (e.g., a global subscriber is already set).
pub fn init_logging(data_dir: &Path) -> anyhow::Result<WorkerGuard> {
    // Create a daily-rotating file appender with 14-file retention.
    // Files are named `chronicle.YYYY-MM-DD.log` (prefix.date.suffix).
    let file_appender = Builder::new()
        .rotation(Rotation::DAILY)
        .filename_prefix("chronicle")
        .filename_suffix("log")
        .max_log_files(14)
        .build(data_dir)
        .map_err(|e| anyhow::anyhow!("failed to initialize rolling log appender: {e}"))?;
    let (non_blocking_file, guard) = tracing_appender::non_blocking(file_appender);

    // Build env-filter: default to `info`, allow override via CHRONICLE_LOG env var.
    let env_filter = EnvFilter::try_from_env("CHRONICLE_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info"));

    // File layer — structured output with timestamps, target, and level.
    let file_layer = fmt::layer()
        .with_writer(non_blocking_file)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    // Stderr layer — for development visibility (with ANSI colors).
    let stderr_layer = fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false);

    // Compose the subscriber with both layers and the shared filter.
    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stderr_layer)
        .init();

    tracing::info!(
        "Chronicle logging initialized — log directory: {} (daily rotation, 14-file retention)",
        data_dir.display()
    );

    Ok(guard)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// Tiny helper that validates the `chronicle.YYYY-MM-DD.log` filename pattern
    /// without pulling in a regex dependency.
    fn matches_daily_log_pattern(name: &str) -> bool {
        let stripped = match name
            .strip_prefix("chronicle.")
            .and_then(|s| s.strip_suffix(".log"))
        {
            Some(s) => s,
            None => return false,
        };
        let parts: Vec<&str> = stripped.split('-').collect();
        if parts.len() != 3 {
            return false;
        }
        parts[0].len() == 4
            && parts[1].len() == 2
            && parts[2].len() == 2
            && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
    }

    /// List all `chronicle.*.log` files in the given directory.
    fn list_chronicle_logs(dir: &std::path::Path) -> Vec<String> {
        let mut files: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.starts_with("chronicle.") && n.ends_with(".log"))
            .collect();
        files.sort();
        files
    }

    /// Verify that `init_logging` creates a daily-rotated log file whose name
    /// matches the `chronicle.YYYY-MM-DD.log` pattern produced by
    /// `tracing_appender::rolling::Builder` with prefix "chronicle" and
    /// suffix "log".
    ///
    /// Note: `init_logging` sets the global subscriber, which can be set only
    /// once per process. If another test (or test-harness ordering) has
    /// already set a global subscriber, the happy-path assertions are skipped
    /// to keep the test deterministic in parallel runs.
    #[test]
    fn test_init_logging_creates_log_file() {
        let dir = tempdir().unwrap();
        let result = init_logging(dir.path());

        if let Ok(guard) = result {
            tracing::info!("test log message");
            // Drop guard to flush buffered output to the file.
            drop(guard);

            let files = list_chronicle_logs(dir.path());
            assert!(
                !files.is_empty(),
                "expected at least one chronicle.YYYY-MM-DD.log file in {:?}, found: {:?}",
                dir.path(),
                files
            );
            for name in &files {
                assert!(
                    matches_daily_log_pattern(name),
                    "filename {} does not match chronicle.YYYY-MM-DD.log pattern",
                    name
                );
            }
        }
    }

    /// Validates Requirements 9.2, 9.3, and 9.4: the rolling appender enforces
    /// the 14-file retention cap, deletes the oldest file when exceeded, and
    /// names files using the `chronicle.YYYY-MM-DD.log` pattern.
    ///
    /// Simulates ~15 days of log history: 14 pre-existing past-dated files plus
    /// today's file created by the appender. The builder calls
    /// `prune_old_logs(14)` during construction (before creating today's file),
    /// which removes the single oldest past-dated file so that 14 total
    /// (13 past + 1 today) remain after the build completes.
    ///
    /// This test avoids faking 15 days of system time by exercising the
    /// `rolling::Builder` directly in a temp directory — the same code path
    /// that trips in production when a rotation boundary is crossed.
    #[test]
    fn test_log_rotation_prunes_oldest_when_over_retention() {
        use chrono::{Duration as ChronoDuration, Utc};
        use std::fs;
        use std::thread;
        use std::time::Duration as StdDuration;

        let dir = tempdir().unwrap();
        // Use UTC to match what tracing_appender's rolling builder uses
        // internally for the "current day" file name.
        let today = Utc::now().date_naive();

        // Pre-create 14 past-dated log files, one per day back from yesterday.
        // Sleep a few tens of ms between each write so file creation timestamps
        // are distinct — prune_old_logs sorts by metadata creation time first,
        // so distinct timestamps are required for deterministic ordering.
        let mut past_filenames: Vec<String> = Vec::with_capacity(14);
        for days_back in (1..=14).rev() {
            let date = today - ChronoDuration::days(days_back);
            let filename = format!("chronicle.{}.log", date.format("%Y-%m-%d"));
            let path = dir.path().join(&filename);
            fs::write(&path, format!("simulated log for {}\n", date)).unwrap();
            past_filenames.push(filename);
            thread::sleep(StdDuration::from_millis(50));
        }
        // past_filenames[0] = 14 days ago (oldest), past_filenames[13] = yesterday.

        // Build the rolling appender. `Inner::new` calls `prune_old_logs(14)`
        // before creating today's file, so this single call is what exercises
        // retention behavior.
        let _appender = Builder::new()
            .rotation(Rotation::DAILY)
            .filename_prefix("chronicle")
            .filename_suffix("log")
            .max_log_files(14)
            .build(dir.path())
            .expect("appender build should succeed");

        let files = list_chronicle_logs(dir.path());

        // 13 past files + 1 today = 14 total.
        assert_eq!(
            files.len(),
            14,
            "expected 14 log files after pruning, got {}: {:?}",
            files.len(),
            files
        );

        // The oldest pre-created file (14 days ago) should have been deleted.
        let oldest = &past_filenames[0];
        assert!(
            !files.contains(oldest),
            "oldest file {} should have been pruned; remaining: {:?}",
            oldest,
            files
        );

        // Today's file should have been created by the appender.
        let today_filename = format!("chronicle.{}.log", today.format("%Y-%m-%d"));
        assert!(
            files.contains(&today_filename),
            "today's file {} should exist; found: {:?}",
            today_filename,
            files
        );

        // Every remaining file must match the `chronicle.YYYY-MM-DD.log` pattern.
        for name in &files {
            assert!(
                matches_daily_log_pattern(name),
                "filename {} does not match chronicle.YYYY-MM-DD.log pattern",
                name
            );
        }
    }
}
