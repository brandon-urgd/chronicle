use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};

/// Unified application error type.
///
/// Maps domain errors to HTTP status codes and returns JSON responses
/// matching the FastAPI `HTTPException` format: `{"detail": "..."}`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Validation(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Database error".into()),
            AppError::Pool(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Service unavailable".into()),
            AppError::Io(_) => (StatusCode::INTERNAL_SERVER_ERROR, "IO error".into()),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Internal error".into()),
        };

        tracing::error!(error = %self, status = %status.as_u16(), "Request failed");

        (status, Json(serde_json::json!({ "detail": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;
    use axum::http::StatusCode as HttpStatus;

    async fn response_status_and_body(err: AppError) -> (HttpStatus, serde_json::Value) {
        let response = err.into_response();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        (status, json)
    }

    #[tokio::test]
    async fn not_found_returns_404_with_detail() {
        let (status, body) = response_status_and_body(AppError::NotFound("Entry not found".into())).await;
        assert_eq!(status, HttpStatus::NOT_FOUND);
        assert_eq!(body["detail"], "Entry not found");
    }

    #[tokio::test]
    async fn validation_returns_400_with_detail() {
        let (status, body) = response_status_and_body(AppError::Validation("Invalid date".into())).await;
        assert_eq!(status, HttpStatus::BAD_REQUEST);
        assert_eq!(body["detail"], "Invalid date");
    }

    #[tokio::test]
    async fn conflict_returns_409_with_detail() {
        let (status, body) = response_status_and_body(AppError::Conflict("Duplicate entry".into())).await;
        assert_eq!(status, HttpStatus::CONFLICT);
        assert_eq!(body["detail"], "Duplicate entry");
    }

    #[tokio::test]
    async fn database_error_returns_500_generic_message() {
        let rusqlite_err = rusqlite::Error::QueryReturnedNoRows;
        let (status, body) = response_status_and_body(AppError::Database(rusqlite_err)).await;
        assert_eq!(status, HttpStatus::INTERNAL_SERVER_ERROR);
        assert_eq!(body["detail"], "Database error");
    }

    #[tokio::test]
    async fn io_error_returns_500_generic_message() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let (status, body) = response_status_and_body(AppError::Io(io_err)).await;
        assert_eq!(status, HttpStatus::INTERNAL_SERVER_ERROR);
        assert_eq!(body["detail"], "IO error");
    }

    #[tokio::test]
    async fn internal_error_returns_500_generic_message() {
        let (status, body) = response_status_and_body(AppError::Internal("unexpected".into())).await;
        assert_eq!(status, HttpStatus::INTERNAL_SERVER_ERROR);
        assert_eq!(body["detail"], "Internal error");
    }
}
