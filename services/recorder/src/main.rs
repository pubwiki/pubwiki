use axum::{extract::State, http::StatusCode, routing::{get, post}, Json, Router};
use serde::Deserialize;
use std::net::SocketAddr;
use tracing::{error, info};
use tracing_subscriber::{fmt, EnvFilter};

#[derive(Clone, Default)]
struct AppState {}

// Generic MediaWiki EventBus envelope shape (simplified). We'll accept arbitrary JSON.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum EventPayload {
    Object(serde_json::Value),
    Array(Vec<serde_json::Value>),
}

#[tokio::main]
async fn main() {
    // init logging
    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    fmt().with_env_filter(env_filter).with_ansi(true).init();

    // bind address from env or default
    let addr: SocketAddr = std::env::var("RECORDER_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .expect("invalid RECORDER_ADDR");

    let app_state = AppState::default();

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/events", post(intake))
        .with_state(app_state);

    info!(%addr, "recorder listening");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("bind addr");
    axum::serve(listener, app).await.expect("server error");
}

async fn healthz() -> &'static str { "ok" }

async fn intake(State(_state): State<AppState>, Json(body): Json<EventPayload>) -> StatusCode {
    match body {
        EventPayload::Object(v) => {
            info!(event = %v, "eventbus intake: object");
        }
        EventPayload::Array(arr) => {
            // Some EventGate endpoints batch events as an array
            info!(count = arr.len(), "eventbus intake: array");
            for (i, v) in arr.into_iter().enumerate() {
                info!(index = i, event = %v, "eventbus intake: item");
            }
        }
    }
    StatusCode::ACCEPTED
}
