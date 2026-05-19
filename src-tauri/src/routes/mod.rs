//! Route composition module.
//!
//! Merges all domain sub-routers into a single axum Router.
//! Each sub-module defines its own routes under the `/api/` prefix.

pub mod attachments;
pub mod backup;
pub mod dashboard;
pub mod data;
pub mod entries;
pub mod export;
pub mod goals;
pub mod lessons;
pub mod links;
pub mod notes;
pub mod programs;
pub mod projects;
pub mod reports;
pub mod reviews;
pub mod scheduled;
pub mod settings;
pub mod stakeholders;
pub mod system;
pub mod tags;
pub mod time_distribution;

use axum::Router;

use crate::db::SharedState;

/// Build the combined application router with all domain sub-routers merged.
///
/// Each sub-module contributes its routes. All route modules are merged here.
pub fn router(state: SharedState) -> Router {
    system::router(state.clone())
        .merge(entries::router(state.clone()))
        .merge(programs::router(state.clone()))
        .merge(goals::router(state.clone()))
        .merge(projects::router(state.clone()))
        .merge(scheduled::router(state.clone()))
        .merge(tags::router(state.clone()))
        .merge(links::router(state.clone()))
        .merge(attachments::router(state.clone()))
        .merge(lessons::router(state.clone()))
        .merge(stakeholders::router(state.clone()))
        .merge(settings::router(state.clone()))
        .merge(notes::router(state.clone()))
        .merge(reports::router(state.clone()))
        .merge(reviews::router(state.clone()))
        .merge(dashboard::router(state.clone()))
        .merge(backup::router(state.clone()))
        .merge(data::router(state.clone()))
        .merge(export::router(state.clone()))
        .merge(time_distribution::router(state.clone()))
}
