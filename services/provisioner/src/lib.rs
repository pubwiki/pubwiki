pub mod auth;
pub mod env;
pub mod error;
pub mod events;
pub mod manage;
pub mod provision;
pub mod validate;

use axum::{
    Router,
    routing::{get, post},
};
use redis::Client as RedisClient;
use sqlx::{MySql, Pool};
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::{Level, info};

use crate::env::WikifarmEnv;

#[derive(Clone)]
pub struct AppState {
    pub db: Pool<MySql>,
    pub redis: RedisClient,
    pub env: WikifarmEnv,
}

pub fn build_router(state: AppState) -> Router {
    let trace_layer = TraceLayer::new_for_http()
        .on_request(|request: &axum::http::Request<_>, _span: &tracing::Span| {
            let method = request.method();
            let uri = request.uri();
            // Collect headers into a vector of (name, value) strings, sanitizing sensitive ones
            let headers: Vec<(String, String)> = request
                .headers()
                .iter()
                .map(|(k, v)| {
                    let mut val = v.to_str().unwrap_or("<non-utf8>").to_string();
                    if k.as_str().eq_ignore_ascii_case("authorization") {
                        val = "<redacted>".into();
                    }
                    (k.to_string(), val)
                })
                .collect();
            info!(%method, uri=%uri, headers=?headers, "incoming request");
        })
        .on_response(DefaultOnResponse::new().level(Level::INFO));

    Router::new()
        .route(
            "/provisioner/v1/wikis",
            post(provision::create_wiki).get(provision::list_featured),
        )
        .route(
            "/provisioner/v1/wikis/public",
            get(provision::list_public_wikis),
        )
        .route(
            "/provisioner/v1/wikis/slug/{slug}/exists",
            get(provision::check_slug),
        )
        .route(
            "/provisioner/v1/users/{user_id}/wikis",
            get(provision::list_user_wikis),
        )
        .route(
            "/provisioner/v1/tasks/{task_id}/events",
            get(provision::task_events),
        )
        .route("/provisioner/v1/health", get(provision::health))
        // Manage module
        .route(
            "/manage/v1/wikis/permissions",
            get(manage::get_permissions).post(manage::set_permissions),
        )
        .route(
            "/manage/v1/wikis/extensions/sync",
            post(manage::sync_extensions),
        )
        .route("/manage/v1/wikis/skins/sync", post(manage::sync_skins))
        .route("/manage/v1/wikis/favicon", post(manage::set_favicon))
        .with_state(state)
        .layer(trace_layer)
}
