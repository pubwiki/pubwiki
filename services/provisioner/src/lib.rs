pub mod events;
pub mod manage;
pub mod auth;
pub mod env;
pub mod error;
pub mod validate;

use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        IntoResponse, Response, sse::{Event as SseEvent, KeepAlive, Sse}
    },
    routing::{get, post},
};
use futures::StreamExt;
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{MySql, Pool};
use tower_http::trace::{DefaultOnResponse, TraceLayer};
use tracing::{Level, debug, error, info, warn};

use crate::{env::WikifarmEnv, error::ApiError, events::{Event as TaskEvent, Status}};
use validate::validate;
use chrono::NaiveDateTime;

#[derive(Clone)]
pub struct AppState {
    pub db: Pool<MySql>,
    pub redis: RedisClient,
    pub env: WikifarmEnv
}

#[derive(Debug, Serialize)]
struct CreateAccepted {
    task_id: String,
}

#[derive(Debug, Deserialize)]
struct CreateWikiReq {
    name: String,
    slug: String,
    language: Option<String>,
    visibility: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Owner {
    id: u64,
    username: String,
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
            post(create_wiki).get(list_featured),
        )
        .route("/provisioner/v1/wikis/public", get(list_public_wikis))
        .route("/provisioner/v1/wikis/slug/{slug}/exists", get(check_slug))
        .route(
            "/provisioner/v1/users/{user_id}/wikis",
            get(list_user_wikis),
        )
        .route("/provisioner/v1/tasks/{task_id}/events", get(task_events))
        .route("/provisioner/v1/health", get(health))
        // Manage module
        .route(
            "/manage/v1/wikis/{slug}/permissions",
            get(manage::get_permissions).post(manage::set_permissions),
        )
        .route(
            "/manage/v1/wikis/{slug}/extensions/sync",
            post(manage::sync_extensions),
        )
        .route(
            "/manage/v1/wikis/{slug}/skins/sync",
            post(manage::sync_skins),
        )
        .with_state(state)
        .layer(trace_layer)
}

pub async fn health() -> &'static str {
    "ok"
}

use crate::auth::AuthContext;

async fn create_wiki(
    State(state): State<AppState>,
    auth: AuthContext,
    Json(body): Json<CreateWikiReq>,
) -> Result<Response, ApiError> {
    info!(slug=%body.slug, name=%body.name, "create_wiki request received");
    validate(&body.name, &validate::WIKI_NAME)?;
    validate(&body.slug, &validate::WIKI_SLUG)?;

    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM wikifarm_wikis WHERE slug = ? LIMIT 1")
        .bind(&body.slug)
        .fetch_optional(&state.db)
        .await?
        .is_some()
    {
        info!(slug=%body.slug, "create_wiki slug already exists");
        return Err(ApiError::new(StatusCode::CONFLICT, "conflict", "slug exists"));
    }

    let owner = Owner { id: auth.user_id, username: auth.username.clone() };
    let language = body.language.clone().unwrap_or_else(|| "en".to_string());
    let visibility = body
        .visibility
        .clone()
        .unwrap_or_else(|| "public".to_string())
        .to_lowercase();
    let visibility = match visibility.as_str() {
        "public" | "private" | "unlisted" => visibility,
        _ => "public".to_string(),
    };
    let task_id = uuid::Uuid::new_v4().to_string();
    debug!(%task_id, slug=%body.slug, name=%body.name, language=%language, owner_id=owner.id, owner_name=%owner.username, "create_wiki assigning task id");

    let owner_username_bytes = owner.username.clone().into_bytes();
    sqlx::query(
		"INSERT INTO wikifarm_tasks (id, type, status, progress, created_by_user_id, created_by_username) VALUES (?, 'create_wiki', 'queued', 0, ?, ?)"
	)
	.bind(&task_id)
	.bind(owner.id)
	.bind(owner_username_bytes)
	.execute(&state.db)
	.await?;

    let job = json!({
        "task_id": task_id,
        "name": body.name,
        "slug": body.slug,
        "language": language,
        "visibility": visibility,
        "owner": { "id": owner.id, "username": owner.username }
    });
    let channel = format!("wikifarm:tasks:{}", job["task_id"].as_str().unwrap());
    let mut conn = state.redis.get_multiplexed_async_connection().await?;
    conn
        .rpush::<_, _, ()>("wikifarm:jobs", job.to_string())
        .await?;
    debug!(%task_id, slug=%body.slug, "create_wiki job enqueued");
    let msg = serde_json::to_string(&TaskEvent::Progress {
        status: Status::Queued,
        message: Some("queued".into()),
        phase: None,
    }).unwrap();
    let _: i32 = conn.publish(&channel, msg).await?;
    info!(%task_id, slug=%body.slug, "create_wiki queued successfully");

    Ok((
        StatusCode::ACCEPTED,
        Json(CreateAccepted {
            task_id: job["task_id"].as_str().unwrap().to_string(),
        }),
    ).into_response())
}

#[derive(Debug, Deserialize)]
struct ListWikisQuery {
    featured: Option<i32>,
    limit: Option<i32>,
    offset: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct PublicWikisQuery {
    limit: Option<i32>,
    offset: Option<i32>,
}

#[derive(sqlx::FromRow, Debug)]
struct DbWikiRow {
    id: u64,
    name: String,
    slug: String,
    domain: Option<String>,
    path: Option<String>,
    language: String,
    owner_user_id: u64,
    owner_username: Vec<u8>,
    visibility: String,
    status: String,
    is_featured: i8,
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
}

fn map_wiki_row(row: DbWikiRow) -> serde_json::Value {
    let owner_username = String::from_utf8_lossy(&row.owner_username).to_string();
    json!({
        "id": row.id,
        "name": row.name,
        "slug": row.slug,
        "domain": row.domain,
        "path": row.path,
        "language": row.language,
        "owner_user_id": row.owner_user_id,
        "owner_username": owner_username,
        "visibility": row.visibility,
        "status": row.status,
        "is_featured": row.is_featured != 0,
        "created_at": row.created_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
        "updated_at": row.updated_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
    })
}

async fn list_featured(
    State(state): State<AppState>,
    Query(q): Query<ListWikisQuery>,
) -> Result<Response, ApiError> {
    let featured = q.featured.unwrap_or(1);
    let limit = q.limit.unwrap_or(20).clamp(1, 100) as u64;
    let offset = q.offset.unwrap_or(0).max(0) as u64;

    // Adjusted: when featured=0 return only public & ready wikis; when featured=1 keep existing semantics (featured & ready).
    let rows: Vec<DbWikiRow> = if featured == 1 {
        sqlx::query_as::<_, DbWikiRow>(
            "SELECT id,name,slug,domain,path,language,owner_user_id,owner_username,visibility,status,is_featured,created_at,updated_at
             FROM wikifarm_wikis
             WHERE status='ready' AND is_featured=1 AND visibility='public'
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query_as::<_, DbWikiRow>(
            "SELECT id,name,slug,domain,path,language,owner_user_id,owner_username,visibility,status,is_featured,created_at,updated_at
             FROM wikifarm_wikis
             WHERE status='ready' AND visibility='public'
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?"
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await?
    };

    let wikis: Vec<_> = rows.into_iter().map(map_wiki_row).collect();
    let next_offset = (offset as usize + wikis.len()) as u64;
    Ok((
        StatusCode::OK,
        Json(json!({ "wikis": wikis, "next_offset": next_offset })),
    ).into_response())
}

async fn list_public_wikis(
    State(state): State<AppState>,
    Query(q): Query<PublicWikisQuery>,
) -> Result<Response, ApiError> {
    let limit = q.limit.unwrap_or(20).clamp(1, 100) as u64;
    let offset = q.offset.unwrap_or(0).max(0) as u64;

    let rows = sqlx::query_as::<_, DbWikiRow>(
		"SELECT id,name,slug,domain,path,language,owner_user_id,owner_username,visibility,status,is_featured,created_at,updated_at
		 FROM wikifarm_wikis
		 WHERE status='ready' AND visibility='public'
		 ORDER BY created_at DESC
		 LIMIT ? OFFSET ?"
	)
	.bind(limit)
	.bind(offset)
	.fetch_all(&state.db)
	.await?;

    let wikis: Vec<_> = rows.into_iter().map(map_wiki_row).collect();
    let next_offset = (offset as usize + wikis.len()) as u64;
    Ok((
        StatusCode::OK,
        Json(json!({ "wikis": wikis, "next_offset": next_offset })),
    ).into_response())
}

async fn list_user_wikis(
    State(state): State<AppState>,
    Path(user_id): Path<u64>,
) -> Result<Response, ApiError> {
    let rows = sqlx::query_as::<_, DbWikiRow>(
		"SELECT id,name,slug,domain,path,language,owner_user_id,owner_username,visibility,status,is_featured,created_at,updated_at
		 FROM wikifarm_wikis
		 WHERE owner_user_id = ?
		 ORDER BY created_at DESC"
	)
	.bind(user_id)
	.fetch_all(&state.db)
	.await?;

    let wikis: Vec<_> = rows.into_iter().map(map_wiki_row).collect();
    Ok((StatusCode::OK, Json(json!({ "wikis": wikis }))).into_response())
}

async fn task_events(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Response, ApiError> {
    let channel = format!("wikifarm:tasks:{task_id}");
    info!(%task_id, channel=%channel, "task_events start");

    let mut pubsub = state.redis.get_async_pubsub().await?;
    pubsub.subscribe(&channel).await?;

    // NOTE (race discussion): We intentionally do NOT check DB terminal status BEFORE subscribing to Redis,
    // because a task could finish (write final status + publish event) in the gap between that check and the subscribe call,
    // causing the terminal pubsub message to be missed (pubsub does not replay). Instead we subscribe first, then do
    // a DB snapshot check. If the task is already terminal we synthesize a final status event and return immediately.
    // This may produce a synthetic event before the real pubsub message is published (if DB update happens before publish),
    // but that is acceptable: clients should treat terminal status idempotently.

    let stream = async_stream::stream! {
        let pubsub_res = state.redis.get_async_pubsub().await;
        if let Err(e) = pubsub_res.as_ref().map(|_| ()) {
            error!(error = %e, "redis pubsub conn error");
            let payload = serde_json::json!({"type":"error","message":"redis connection error"}).to_string();
            yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("error").data(payload));
            return;
        }
        let mut pubsub = pubsub_res.unwrap();
        if let Err(e) = pubsub.subscribe(&channel).await {
            error!(error = %e, channel = %channel, "redis subscribe error");
            let payload = serde_json::json!({"type":"error","message":"redis subscribe error"}).to_string();
            yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("error").data(payload));
            return;
        }

        // After successful subscription, perform terminal snapshot check to cover late subscribers without race window.
        use sqlx::Row;
        use redis::AsyncCommands;
        if let Ok(row_opt) = sqlx::query("SELECT status, wiki_id, message FROM wikifarm_tasks WHERE id = ?")
            .bind(&task_id)
            .fetch_optional(&state.db)
            .await
            && let Some(row) = row_opt
            && let Ok(Some(status_str)) = row.try_get::<Option<String>, _>("status")
            && (status_str == "succeeded" || status_str == "failed")
        {
            let wiki_id: Option<u64> = row.try_get::<u64, _>("wiki_id").ok();
            let message: Option<String> = row.try_get("message").ok();
            let final_status = if status_str == "succeeded" { Status::Succeeded } else { Status::Failed };
            let evt = TaskEvent::Status { status: final_status, wiki_id, message };
            info!(%task_id, channel=%channel, final_status=%status_str, "task_events snapshot terminal status (synthetic)");
            let payload = serde_json::to_string(&evt).unwrap();
            yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("status").data(payload));
            // Terminal -> stop streaming (no need to wait for possible duplicate pubsub message)
            return;
        }
        let mut on_msg = pubsub.on_message();
        debug!(channel=%channel, "task_events subscribed");

        // Emit an immediate snapshot using cached last event (for real current phase) if present and non-terminal.
        if let Ok(mut rconn) = state.redis.get_multiplexed_async_connection().await {
            let last_key = format!("{channel}:last");
            if let Ok(Some(cached)) = rconn.get::<_, Option<String>>(&last_key).await
                && let Ok(evt) = serde_json::from_str::<TaskEvent>(&cached)
                && let TaskEvent::Progress { status, .. } = evt
                && !matches!(status, Status::Succeeded | Status::Failed)
            {
                info!(%task_id, channel=%channel, "task_events cached progress snapshot (synthetic)");
                yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("progress").data(cached));
            }
        }
        loop {
            let Some(msg) = on_msg.next().await else {
                debug!(channel=%channel, "task_events pubsub stream ended");
                break
            };

            debug!(channel=%channel, "task_events message received");
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(e) => {
                    error!(error = %e, "redis payload decode error");
                    let payload = serde_json::json!({"type":"error","message":"payload decode error"}).to_string();
                    yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event("error").data(payload));
                    continue;
                }
            };
            if let Ok(evt) = serde_json::from_str::<TaskEvent>(&payload) {
                let event_name = match evt { TaskEvent::Progress { .. } => "progress", TaskEvent::Status { .. } => "status" };
                match &evt {
                    TaskEvent::Progress { status, phase, message } => {
                        debug!(channel=%channel, ?status, ?phase, ?message, "task_events progress");
                    }
                    TaskEvent::Status { status, wiki_id, message } => {
                        info!(channel=%channel, ?status, ?wiki_id, ?message, "task_events status");
                    }
                }
                debug!(channel=%channel, "yield progress");
                yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().event(event_name).data(payload));
                if let TaskEvent::Status { status, .. } = evt 
                    && matches!(status, Status::Succeeded | Status::Failed)
                {
                    info!(channel=%channel, terminal_status=?status, "task_events terminal status - closing");
                    break;
                }
            } else {
                warn!(channel=%channel, payload=%payload, "task_events unparsed payload");
                yield Ok::<SseEvent, std::convert::Infallible>(SseEvent::default().data(payload));
            }
        }
        info!(channel=%channel, "task_events stream finished");
    };

    debug!("SSE responsed");
    Ok(Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                // Axum forbids newlines in provided keep-alive text; newline is added automatically per event framing.
                .text(": keep-alive"),
        )
        .into_response())
}

// note: worker_loop remains in the binary (main.rs) to avoid duplicating job types here.

async fn check_slug(State(state): State<AppState>, Path(slug): Path<String>) -> Result<Response, ApiError> {
    validate(&slug, &validate::WIKI_SLUG)?;
    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM wikifarm_wikis WHERE slug = ? LIMIT 1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .is_some()
    {
        
        Ok((StatusCode::OK, Json(json!({"slug": slug, "exists": true}))).into_response())
    } else {
        Ok((StatusCode::OK, Json(json!({"slug": slug, "exists": false}))).into_response())
    }
}
