//! Chronicle library crate — re-exports modules for integration tests.
//!
//! The binary crate (main.rs) uses these modules directly via `mod` declarations.
//! This lib.rs makes them available to integration tests in `tests/`.

// Allow dead code for struct fields used in serialization and utility functions
// reserved for future use. These are intentional — not accidental dead code.
#![allow(dead_code)]

pub mod config;
pub mod db;
pub mod engines;
pub mod error;
pub mod logging;
pub mod models;
pub mod routes;
pub mod server;
