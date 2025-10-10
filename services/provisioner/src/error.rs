use std::fmt;

use axum::Json;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use tracing::error;

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for ApiError {}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(value: sqlx::Error) -> Self {
        error!(error = %value, "db error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "db_error",
            message: value.to_string(),
        }
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(value: redis::RedisError) -> Self {
        error!(error = %value, "redis error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "redis_error",
            message: value.to_string(),
        }
    }
}

impl From<std::io::Error> for ApiError {
    fn from(value: std::io::Error) -> Self {
        error!(error = %value, "fs error");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "fs_error",
            message: value.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(serde_json::json!({
            "error": self.code,
            "message": self.message,
        }));
        (self.status, body).into_response()
    }
}
