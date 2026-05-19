//! HTTP server setup for Chronicle.
//!
//! Builds the axum Router with all sub-routers, CORS middleware, and shared state.
//! Provides `start_server()` to bind and run the server with graceful shutdown.

use axum::Router;
use axum::http::{HeaderName, Method};
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

use crate::db::SharedState;
use crate::routes;

/// Allowed CORS origins for the frontend and Tauri webview.
const ALLOWED_ORIGINS: &[&str] = &[
    "http://localhost:5180",
    "http://127.0.0.1:5180",
    "tauri://localhost",
    "https://tauri.localhost",
];

/// Build the complete axum Router with all routes and middleware.
///
/// Merges all sub-routers from the routes module and applies the CORS layer
/// configured for the frontend origins.
pub fn build_router(state: SharedState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(
            ALLOWED_ORIGINS
                .iter()
                .map(|origin| origin.parse().expect("valid origin"))
                .collect::<Vec<_>>(),
        )
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers([
            HeaderName::from_static("content-type"),
            HeaderName::from_static("authorization"),
            HeaderName::from_static("accept"),
            HeaderName::from_static("origin"),
            HeaderName::from_static("x-requested-with"),
        ])
        .allow_credentials(true);

    routes::router(state.clone()).layer(cors)
}

/// Start the HTTP server, binding to 127.0.0.1:{port}.
///
/// Uses the `shutdown_rx` watch channel from AppState to perform graceful shutdown.
/// When the watch value becomes `true`, the server stops accepting new connections
/// and finishes in-flight requests.
///
/// # Errors
///
/// Returns an error if the server cannot bind to the specified address.
pub async fn start_server(state: SharedState) -> anyhow::Result<()> {
    let port = state.config.port;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));

    let app = build_router(state.clone());

    tracing::info!("Chronicle server starting on {}", addr);

    let mut shutdown_rx = state.shutdown_tx.subscribe();

    let listener = tokio::net::TcpListener::bind(addr).await?;

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            // Wait until shutdown_tx sends `true`
            loop {
                if *shutdown_rx.borrow() {
                    break;
                }
                if shutdown_rx.changed().await.is_err() {
                    // Sender dropped — treat as shutdown signal
                    break;
                }
                if *shutdown_rx.borrow() {
                    break;
                }
            }
            tracing::info!("Graceful shutdown signal received");
        })
        .await?;

    tracing::info!("Chronicle server stopped");
    Ok(())
}

/// Start a minimal recovery server when the database cannot be initialized.
///
/// Serves only health (with recovery status) and recovery action endpoints.
/// The frontend detects `"status": "recovery"` from `/api/health` and renders
/// the RecoveryScreen component.
pub async fn start_recovery_server(
    port: u16,
    data_dir: std::path::PathBuf,
    error_msg: String,
) -> anyhow::Result<()> {
    use axum::{routing::post, Json};
    use std::sync::Mutex;

    let error_state = Arc::new(Mutex::new(error_msg.clone()));
    let data_dir_state = Arc::new(data_dir.clone());

    let error_for_health = error_state.clone();
    let health_handler = move || {
        let err = error_for_health.lock().unwrap().clone();
        async move {
            Json(serde_json::json!({
                "status": "recovery",
                "error": err,
            }))
        }
    };

    let data_dir_for_backup = data_dir_state.clone();
    let backup_info_handler = move || {
        let dir = data_dir_for_backup.clone();
        async move {
            let backup_dir = dir.join("backups");
            let mut backups: Vec<serde_json::Value> = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&backup_dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.ends_with(".json") || name.ends_with(".db") {
                            let age_days = entry.metadata().ok()
                                .and_then(|m| m.modified().ok())
                                .map(|t| t.elapsed().unwrap_or_default().as_secs() / 86400)
                                .unwrap_or(999);
                            backups.push(serde_json::json!({
                                "filename": name,
                                "age_days": age_days,
                            }));
                        }
                    }
                }
            }
            backups.sort_by_key(|b| b["age_days"].as_u64().unwrap_or(999));
            Json(serde_json::json!({ "backups": backups }))
        }
    };

    let data_dir_for_fresh = data_dir_state.clone();
    let start_fresh_handler = move || {
        let dir = data_dir_for_fresh.clone();
        async move {
            let db_path = dir.join("chronicle.db");
            if db_path.exists() {
                // Find a unique .corrupt.bak name
                let mut suffix = 1;
                let mut bak_path = dir.join("chronicle.db.corrupt.bak");
                while bak_path.exists() {
                    suffix += 1;
                    bak_path = dir.join(format!("chronicle.db.corrupt.{suffix}.bak"));
                }
                if let Err(e) = std::fs::rename(&db_path, &bak_path) {
                    return Json(serde_json::json!({ "success": false, "error": format!("Failed to rename: {e}") }));
                }
            }
            Json(serde_json::json!({ "success": true, "message": "Database reset. Restart the app." }))
        }
    };

    let retry_handler = move || async move {
        // The retry just tells the frontend to restart — we can't re-init the pool
        // from within the recovery server. The user needs to restart the app.
        Json(serde_json::json!({ "success": false, "message": "Please restart Chronicle to retry." }))
    };

    let app = Router::new()
        .route("/api/health", axum::routing::get(health_handler))
        .route("/api/recovery/backup-info", axum::routing::get(backup_info_handler))
        .route("/api/recovery/start-fresh", post(start_fresh_handler))
        .route("/api/recovery/retry", post(retry_handler));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Recovery server starting on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_pool, AppConfig, AppState};
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use std::sync::Arc;
    use tokio::sync::watch;

    fn test_state() -> SharedState {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let config = AppConfig {
            db_path: db_path.clone(),
            data_dir: dir.path().to_path_buf(),
            port: 0, // Use port 0 for tests (OS assigns)
        };
        let pool = init_pool(&config).unwrap();
        let (shutdown_tx, _) = watch::channel(false);
        Arc::new(AppState {
            pool,
            config,
            shutdown_tx,
        })
    }

    /// Helper to send a request through the router and get a response.
    async fn send_request(
        app: Router,
        req: Request<Body>,
    ) -> axum::response::Response<Body> {
        use tower::util::ServiceExt;
        app.oneshot(req).await.unwrap()
    }

    #[test]
    fn build_router_creates_valid_router() {
        let state = test_state();
        let _router = build_router(state);
        // If we get here without panic, the router was built successfully
    }

    #[tokio::test]
    async fn server_responds_to_health_check() {
        let state = test_state();
        let app = build_router(state);

        let req = Request::builder()
            .uri("/api/health")
            .method("GET")
            .body(Body::empty())
            .unwrap();

        let response = send_request(app, req).await;
        assert_eq!(response.status(), StatusCode::OK);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["status"], "ok");
    }

    #[tokio::test]
    async fn server_graceful_shutdown() {
        let (shutdown_tx, _) = watch::channel(false);
        let shutdown_tx_clone = shutdown_tx.clone();

        // Verify the shutdown signal mechanism works
        let mut rx = shutdown_tx_clone.subscribe();
        assert!(!*rx.borrow());

        // Signal shutdown
        shutdown_tx_clone.send(true).unwrap();
        rx.changed().await.unwrap();
        assert!(*rx.borrow());
    }

    #[tokio::test]
    async fn cors_headers_present_for_allowed_origin() {
        let state = test_state();
        let app = build_router(state);

        let req = Request::builder()
            .uri("/api/health")
            .method("GET")
            .header("Origin", "http://localhost:5180")
            .body(Body::empty())
            .unwrap();

        let response = send_request(app, req).await;
        assert_eq!(response.status(), StatusCode::OK);

        // CORS should include access-control-allow-origin
        let acl = response
            .headers()
            .get("access-control-allow-origin")
            .expect("should have CORS header");
        assert_eq!(acl, "http://localhost:5180");
    }

    #[tokio::test]
    async fn cors_allows_credentials() {
        let state = test_state();
        let app = build_router(state);

        let req = Request::builder()
            .uri("/api/health")
            .method("GET")
            .header("Origin", "http://127.0.0.1:5180")
            .body(Body::empty())
            .unwrap();

        let response = send_request(app, req).await;

        let creds = response
            .headers()
            .get("access-control-allow-credentials")
            .expect("should have credentials header");
        assert_eq!(creds, "true");
    }
}
