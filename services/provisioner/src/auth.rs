use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
};
use serde::Serialize;
use tracing::warn;

#[derive(Debug, Clone, Serialize)]
pub struct AuthContext {
    pub user_id: u64,
    pub username: String,
    pub granted_right: Option<String>,
}

impl<S> FromRequestParts<S> for AuthContext
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, String);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let headers = &parts.headers;
        let username = headers
            .get("x-auth-user")
            .or_else(|| headers.get("X-Auth-User"))
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let user_id = headers
            .get("x-auth-user-id")
            .or_else(|| headers.get("X-Auth-User-Id"))
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());
        match (user_id, username) {
            (Some(uid), Some(un)) => Ok(AuthContext {
                user_id: uid,
                username: un,
                granted_right: headers
                    .get("x-auth-granted-right")
                    .or_else(|| headers.get("X-Auth-Granted-Right"))
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.to_string()),
            }),
            _ => {
                warn!("AuthContext extraction failed: missing headers");
                Err((StatusCode::UNAUTHORIZED, "auth_headers_missing".into()))
            }
        }
    }
}
