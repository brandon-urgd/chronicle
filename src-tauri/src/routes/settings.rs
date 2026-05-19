//! Settings routes: key-value settings, setup status, and data location.
//!
//! Implements 5 routes matching the Python FastAPI backend.

use axum::{
    extract::State,
    routing::{get, post, put},
    Json, Router,
};

use crate::config::{resolve_data_dir, set_data_dir};
use crate::db::SharedState;
use crate::error::AppError;
use crate::models::settings::{
    DataLocationRequest, DataLocationResponse, SetupStatusResponse, SettingsResponse,
    UpdateSettings,
};

/// Build the settings sub-router.
pub fn router(state: SharedState) -> Router {
    Router::new()
        .route("/api/settings", get(get_settings))
        .route("/api/settings", put(update_settings))
        .route("/api/settings/setup-status", get(get_setup_status))
        .route("/api/data-location", get(get_data_location))
        .route("/api/data-location", post(set_data_location))
        .with_state(state)
}

/// GET /api/settings — return all settings as a key-value map.
async fn get_settings(
    State(state): State<SharedState>,
) -> Result<Json<SettingsResponse>, AppError> {
    let conn = state.pool.get()?;

    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;

    let mut map = serde_json::Map::new();
    for row_result in rows {
        let (key, value) = row_result?;
        map.insert(
            key,
            value
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
    }

    Ok(Json(SettingsResponse {
        settings: serde_json::Value::Object(map),
    }))
}

/// PUT /api/settings — batch upsert settings from a JSON object.
async fn update_settings(
    State(state): State<SharedState>,
    Json(body): Json<UpdateSettings>,
) -> Result<Json<SettingsResponse>, AppError> {
    let conn = state.pool.get()?;

    if let Some(obj) = body.settings.as_object() {
        for (key, value) in obj {
            let val_str = match value {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Null => None,
                other => Some(other.to_string()),
            };
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) \
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![key, val_str],
            )?;
        }
    }

    // Return all settings after update
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    })?;

    let mut map = serde_json::Map::new();
    for row_result in rows {
        let (key, value) = row_result?;
        map.insert(
            key,
            value
                .map(serde_json::Value::String)
                .unwrap_or(serde_json::Value::Null),
        );
    }

    Ok(Json(SettingsResponse {
        settings: serde_json::Value::Object(map),
    }))
}

/// GET /api/settings/setup-status — check if key entities exist.
async fn get_setup_status(
    State(state): State<SharedState>,
) -> Result<Json<SetupStatusResponse>, AppError> {
    let conn = state.pool.get()?;

    let has_programs: bool = conn.query_row(
        "SELECT COUNT(*) FROM programs",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    let has_goals: bool = conn.query_row(
        "SELECT COUNT(*) FROM goals",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    let has_entries: bool = conn.query_row(
        "SELECT COUNT(*) FROM entries",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    let has_scheduled_items: bool = conn.query_row(
        "SELECT COUNT(*) FROM scheduled_items",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    // setup_completed is true if the user has ANY meaningful data.
    // This is what the frontend App.tsx checks to skip the Welcome/Setup screen.
    let setup_completed = has_programs || has_goals || has_entries || has_scheduled_items;

    Ok(Json(SetupStatusResponse {
        setup_completed,
        has_programs,
        has_goals,
        has_entries,
        has_scheduled_items,
    }))
}

/// GET /api/data-location — return the current data directory path.
async fn get_data_location(
    State(state): State<SharedState>,
) -> Result<Json<DataLocationResponse>, AppError> {
    let path = state.config.data_dir.to_string_lossy().into_owned();
    Ok(Json(DataLocationResponse { path }))
}

/// POST /api/data-location — update the data directory in chronicle_config.json.
async fn set_data_location(
    Json(body): Json<DataLocationRequest>,
) -> Result<Json<DataLocationResponse>, AppError> {
    let new_path = std::path::PathBuf::from(&body.path);

    // Ensure the directory exists or can be created
    std::fs::create_dir_all(&new_path).map_err(|e| {
        AppError::Validation(format!("Cannot create directory: {}", e))
    })?;

    // Persist the choice in chronicle_config.json
    set_data_dir(&new_path).map_err(|e| {
        AppError::Internal(format!("Failed to save config: {}", e))
    })?;

    let resolved = resolve_data_dir();
    Ok(Json(DataLocationResponse {
        path: resolved.to_string_lossy().into_owned(),
    }))
}
