// Chronicle Tauri Desktop Shell — v3.0 (Embedded Rust Backend)
//
// Manages the full application lifecycle with an in-process axum HTTP server:
//   1. Initializes the database pool and schema at startup (or enters Recovery Mode)
//   2. Spawns the axum server as a tokio task (no sidecar process)

#![allow(dead_code, unused_imports)]
//   3. Writes .port file for MCP server discovery
//   4. Auto-backup on close with graceful shutdown
//   5. Daily scheduled backup (24h interval)
//   6. Native file dialogs

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod config;
mod db;
mod engines;
mod error;
mod logging;
mod models;
mod routes;
mod server;

use std::sync::Arc;
use std::time::Duration;
use tauri::Manager;
use tracing_appender::non_blocking::WorkerGuard;

use db::{AppState, SharedState};

const CLOSE_BACKUP_TIMEOUT_SECS: u64 = 5;
const DAILY_BACKUP_INTERVAL_SECS: u64 = 24 * 60 * 60;

/// Trigger an auto-backup by POSTing to the in-process server.
async fn trigger_auto_backup(port: u16, timeout: Duration) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/backup/auto");
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let resp = client
        .post(&url)
        .send()
        .await
        .map_err(|e| format!("Backup request failed: {e}"))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(format!("Backup returned HTTP {}", resp.status()))
    }
}

/// Spawn a daily backup timer that fires every 24 hours.
fn spawn_daily_backup_timer(port: u16) {
    tauri::async_runtime::spawn(async move {
        // Wait one full interval before the first daily backup
        tokio::time::sleep(Duration::from_secs(DAILY_BACKUP_INTERVAL_SECS)).await;
        loop {
            match trigger_auto_backup(port, Duration::from_secs(30)).await {
                Ok(()) => tracing::info!("Daily auto-backup succeeded"),
                Err(e) => tracing::warn!("Daily auto-backup failed: {e}"),
            }
            tokio::time::sleep(Duration::from_secs(DAILY_BACKUP_INTERVAL_SECS)).await;
        }
    });
}

#[tauri::command]
async fn show_main_window(window: tauri::Window) {
    // Called by the frontend once content is ready — closes the splash screen.
    if let Some(splash_win) = window.get_window("splash") {
        let _ = splash_win.close();
    }
}

#[tauri::command]
async fn open_file_dialog() -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    let path = FileDialogBuilder::new()
        .add_filter("JSON Files", &["json"])
        .set_title("Select Chronicle Backup")
        .pick_file();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn save_file_dialog(
    default_path: String,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri::api::dialog::blocking::FileDialogBuilder;
    let mut builder = FileDialogBuilder::new()
        .add_filter("JSON Files", &["json"])
        .set_title("Export Chronicle Backup")
        .set_file_name(&suggested_name);
    let dir = std::path::Path::new(&default_path);
    if dir.is_dir() {
        builder = builder.set_directory(dir);
    }
    let path = builder.save_file();
    Ok(path.map(|p| p.to_string_lossy().into_owned()))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            show_main_window,
            open_file_dialog,
            save_file_dialog,
        ])
        .setup(|app| {
            // ── 1. Resolve configuration ──────────────────────────────────
            let app_config = config::resolve_config()
                .expect("Failed to resolve Chronicle configuration");

            // ── 2. Initialize logging ─────────────────────────────────────
            // Hold the guard for the lifetime of the app to ensure logs flush.
            let _log_guard: WorkerGuard = logging::init_logging(&app_config.data_dir)
                .expect("Failed to initialize logging");

            // Leak the guard so it lives for the entire process lifetime.
            // This is intentional — the guard must not be dropped until exit.
            let log_guard = Box::new(_log_guard);
            std::mem::forget(log_guard);

            tracing::info!(
                "Chronicle v{} starting — data_dir={}, port={}",
                env!("CARGO_PKG_VERSION"),
                app_config.data_dir.display(),
                app_config.port
            );

            // ── 3. Initialize database pool + schema ──────────────────────
            // v3.0: Graceful recovery — if DB init fails, spawn a recovery
            // server instead of panicking.
            let db_init_result: Result<db::SharedState, String> = (|| {
                let pool = db::init_pool(&app_config)
                    .map_err(|e| format!("Pool creation failed: {e}"))?;
                let conn = pool.get()
                    .map_err(|e| format!("Connection failed: {e}"))?;
                db::schema::initialize_schema(&conn)
                    .map_err(|e| format!("Schema init failed: {e}"))?;
                db::migrations::run_migrations(&conn, &app_config.data_dir)
                    .map_err(|e| format!("Migration failed: {e}"))?;
                drop(conn);

                tracing::info!("Database initialized successfully");

                let (shutdown_tx, _shutdown_rx) = tokio::sync::watch::channel(false);
                let state: db::SharedState = Arc::new(db::AppState {
                    pool,
                    config: app_config.clone(),
                    shutdown_tx,
                });
                Ok(state)
            })();

            let port = app_config.port;

            match db_init_result {
                Ok(state) => {
                    // ── Normal startup path ───────────────────────────────
                    // Write .port file for MCP server discovery
                    config::write_port_file(&app_config.data_dir, port)
                        .expect("Failed to write .port file");
                    tracing::info!("Port file written: {}", app_config.data_dir.join(".port").display());

                    // Spawn the axum HTTP server as a tokio task
                    let server_state = state.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = server::start_server(server_state).await {
                            tracing::error!("Chronicle server error: {e}");
                        }
                    });

                    tracing::info!("Axum server spawned on 127.0.0.1:{port}");

                    // Spawn daily backup timer
                    spawn_daily_backup_timer(port);

                    // Store shared state in Tauri managed state
                    app.manage(state);
                }
                Err(error_msg) => {
                    // ── Recovery mode path ────────────────────────────────
                    tracing::error!("Database initialization failed: {error_msg}");

                    // Write .port file so the recovery server is discoverable
                    config::write_port_file(&app_config.data_dir, port)
                        .expect("Failed to write .port file");

                    // Spawn a minimal recovery server that serves health + recovery endpoints
                    let data_dir = app_config.data_dir.clone();
                    let error_for_server = error_msg.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = server::start_recovery_server(port, data_dir, error_for_server).await {
                            tracing::error!("Recovery server error: {e}");
                        }
                    });

                    tracing::info!("Recovery server spawned on 127.0.0.1:{port}");
                }
            }

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
                api.prevent_close();
                let window = event.window().clone();
                let app = window.app_handle();
                let state = app.state::<SharedState>();
                let port = state.config.port;
                let shutdown_tx = state.shutdown_tx.clone();

                tauri::async_runtime::spawn(async move {
                    // ── Auto-backup (best-effort) ─────────────────────────
                    match trigger_auto_backup(
                        port,
                        Duration::from_secs(CLOSE_BACKUP_TIMEOUT_SECS),
                    )
                    .await
                    {
                        Ok(()) => tracing::info!("Close-event backup succeeded"),
                        Err(e) => tracing::warn!("Close-event backup failed: {e}"),
                    }

                    // ── Signal graceful shutdown ──────────────────────────
                    let _ = shutdown_tx.send(true);
                    tracing::info!("Shutdown signal sent");

                    // ── Wait briefly for server to stop ───────────────────
                    tokio::time::sleep(Duration::from_millis(500)).await;

                    // ── Close the window ──────────────────────────────────
                    let _ = window.close();
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Chronicle");
}
