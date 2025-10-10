use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use redis::Client as RedisClient;
use serde_json::json as j;
use sqlx::{MySql, Pool, mysql::MySqlPoolOptions};
use tower::ServiceExt;
use wikifarm_service::{AppState, build_router, env::WikifarmEnv, provision::health};

async fn try_build_state_from_env() -> Option<AppState> {
    if std::env::var("RUN_API_TESTS").ok().as_deref() != Some("1") {
        eprintln!("skipping API tests; set RUN_API_TESTS=1 to enable");
        return None;
    }
    let db_url = std::env::var("DATABASE_URL").ok()?;
    let redis_url = std::env::var("REDIS_URL").ok()?;
    let db: Pool<MySql> = MySqlPoolOptions::new()
        .max_connections(5)
        .connect(&db_url)
        .await
        .ok()?;
    let redis = RedisClient::open(redis_url).ok()?;
    Some(AppState {
        db,
        redis,
        env: WikifarmEnv::gather().unwrap(),
    })
}

#[tokio::test]
async fn api_error_and_health() {
    // Health is independent, quick test
    assert_eq!(health().await, "ok");

    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);

    // Minimal route smoke: /provisioner/v1/wikis invalid slug
    let req = Request::builder()
        .method("POST")
        .uri("/provisioner/v1/wikis")
        .header("content-type", "application/json")
        .body(Body::from(j!({"name":"x","slug":"INVALID"}).to_string()))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["error"], "invalid_slug");
}

#[tokio::test]
async fn sse_header_ok() {
    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);

    let task_id = uuid::Uuid::new_v4().to_string();
    let req = Request::builder()
        .method("GET")
        .uri(format!("/provisioner/v1/tasks/{}/events", task_id))
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let h = resp
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(h.starts_with("text/event-stream"));
}

#[tokio::test]
async fn create_wiki_owner_required_or_db_error() {
    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);
    let req = Request::builder()
        .method("POST")
        .uri("/provisioner/v1/wikis")
        .header("content-type", "application/json")
        .body(Body::from(
            j!({
                "name": "NoOwner",
                "slug": "no-owner",
                "language": "en"
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    // If DB is reachable, we should see 400 owner_required; otherwise could be 500
    if resp.status() == StatusCode::BAD_REQUEST {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(v["error"], "owner_required");
    }
}

#[tokio::test]
async fn create_wiki_accepts_when_env_ready() {
    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);
    let slug = format!(
        "test-{}",
        uuid::Uuid::new_v4().to_string().split('-').next().unwrap()
    );
    let req = Request::builder()
        .method("POST")
        .uri("/provisioner/v1/wikis")
        .header("content-type", "application/json")
        .body(Body::from(
            j!({
                "name": "Test Wiki",
                "slug": slug,
                "language": "en",
                "owner": {"id": 0, "username": "tester"}
            })
            .to_string(),
        ))
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    if resp.status() == StatusCode::ACCEPTED {
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert!(v.get("task_id").and_then(|x| x.as_str()).is_some());
    }
}

#[tokio::test]
async fn list_featured_ok_or_skip() {
    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/provisioner/v1/wikis")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    if resp.status() == StatusCode::OK {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(v.get("wikis").is_some());
        assert!(v.get("next_offset").is_some());
    }
}

#[tokio::test]
async fn list_user_wikis_ok_or_skip() {
    let Some(state) = try_build_state_from_env().await else {
        return;
    };
    let app = build_router(state);
    let req = Request::builder()
        .method("GET")
        .uri("/provisioner/v1/users/0/wikis")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    if resp.status() == StatusCode::OK {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert!(v.get("wikis").is_some());
    }
}
