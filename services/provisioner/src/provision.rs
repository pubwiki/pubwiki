pub mod db;
pub mod docker;
pub mod fs;
pub mod ini;
pub mod orchestrator;

use std::time::Duration;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{
        IntoResponse, Response,
        sse::{Event as SseEvent, KeepAlive, Sse},
    },
};
use chrono::NaiveDateTime;
use futures::StreamExt;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tracing::{debug, error, info, warn};
use sqlx::Row;

use super::validate::validate;
use super::{
    AppState,
    error::ApiError,
    events::{Event as TaskEvent, Status},
};
use crate::auth::AuthContext;

#[derive(Debug, Serialize)]
struct CreateAccepted {
    task_id: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateWikiReq {
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

pub async fn health() -> &'static str {
    "ok"
}

const BLACKLIST: &[&str] = &["portainer", "main", "pubwiki", "mcp", "chat"];

#[cfg(test)]
mod test {
    use super::BLACKLIST;

    #[test]
    fn test_blacklist() {
        assert!(BLACKLIST.contains(&"portainer"));
        assert!(BLACKLIST.contains(&&"mcpss"[..3]));
        assert!(!BLACKLIST.contains(&"portaner"));
    }
}

pub async fn create_wiki(
    State(state): State<AppState>,
    auth: crate::auth::AuthContext,
    Json(body): Json<CreateWikiReq>,
) -> Result<Response, ApiError> {
    info!(slug=%body.slug, name=%body.name, "create_wiki request received");
    validate(&body.slug, &crate::validate::WIKI_SLUG)?;

    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM wikifarm_wikis WHERE slug = ? LIMIT 1")
        .bind(&body.slug)
        .fetch_optional(&state.db)
        .await?
        .is_some()
        || BLACKLIST.contains(&body.slug.as_str())
    {
        info!(slug=%body.slug, "create_wiki slug already exists");
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            "slug exists",
        ));
    }

    let owner = Owner {
        id: auth.user_id,
        username: auth.username.clone(),
    };
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
    conn.rpush::<_, _, ()>("wikifarm:jobs", job.to_string())
        .await?;
    debug!(%task_id, slug=%job["slug"].as_str().unwrap(), "create_wiki job enqueued");
    let msg = serde_json::to_string(&TaskEvent::Progress {
        status: Status::Queued,
        message: Some("queued".into()),
        phase: None,
    })
    .unwrap();
    let _: i32 = conn.publish(&channel, msg).await?;
    info!(%task_id, slug=%job["slug"].as_str().unwrap(), "create_wiki queued successfully");

    Ok((
        StatusCode::ACCEPTED,
        Json(CreateAccepted {
            task_id: job["task_id"].as_str().unwrap().to_string(),
        }),
    )
        .into_response())
}

#[derive(Debug, Deserialize)]
pub struct ListWikisQuery {
    pub featured: Option<i32>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct PublicWikisQuery {
    pub limit: Option<i32>,
    pub offset: Option<i32>,
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

pub async fn list_featured(
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
    )
        .into_response())
}

pub async fn list_public_wikis(
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
    )
        .into_response())
}

pub async fn list_user_wikis(
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

pub async fn task_events(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
) -> Result<Response, ApiError> {
    let channel = format!("wikifarm:tasks:{task_id}");
    info!(%task_id, channel=%channel, "task_events start");

    // NOTE: the worker publishes events to Redis pubsub with channel wikifarm:tasks:{id}
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

    Ok(Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text(": keep-alive"),
        )
        .into_response())
}

pub async fn check_slug(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> Result<Response, ApiError> {
    validate(&slug, &crate::validate::WIKI_SLUG)?;
    if sqlx::query_scalar::<_, i64>("SELECT 1 FROM wikifarm_wikis WHERE slug = ? LIMIT 1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?
        .is_some()
        || BLACKLIST.contains(&slug.as_str())
    {
        Ok((StatusCode::OK, Json(json!({"slug": slug, "exists": true}))).into_response())
    } else {
        Ok((StatusCode::OK, Json(json!({"slug": slug, "exists": false}))).into_response())
    }
}

/// Delete a wiki by slug (idempotent).
/// Only the owner can delete. If already absent, returns OK.
pub async fn delete_wiki(
    State(state): State<AppState>,
    auth: AuthContext,
    Path(slug): Path<String>,
) -> Result<Response, ApiError> {
    validate(&slug, &crate::validate::WIKI_SLUG)?;

    // Lookup wiki
    let row = sqlx::query("SELECT id, owner_user_id FROM wikifarm_wikis WHERE slug=? LIMIT 1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?;

    if row.is_none() {
        // Idempotent OK when nothing to delete
        return Ok((StatusCode::OK, Json(json!({"msg":"ok"}))).into_response());
    }

    let row = row.unwrap();
    let wiki_id: u64 = row.get::<u64, _>("id");
    let owner_id: u64 = row.get::<u64, _>("owner_user_id");

    if auth.user_id == 0 {
        return Err(ApiError::new(StatusCode::UNAUTHORIZED, "unauthorized", "login required"));
    }
    if auth.user_id != owner_id {
        return Err(ApiError::new(StatusCode::FORBIDDEN, "not_owner", "not owner"));
    }

    // Best-effort removal of external resources
    let target_dir = format!("{}/{}", state.env.wikifarm_dir, slug);

    let _ = crate::provision::ini::remove_ini_dir(&state.env.wikifarm_config_dir, &slug);
    let _ = crate::provision::fs::remove_dir_all_if_exists(&target_dir);
    let _ = crate::provision::db::deprovision_db(&state.db, &slug, &slug).await;

    // Remove DB rows (ignore errors to keep idempotency)
    let _ = sqlx::query("DELETE FROM wikifarm_wiki_group_permissions WHERE wiki_id=?")
        .bind(wiki_id)
        .execute(&state.db)
        .await;
    let _ = sqlx::query("DELETE FROM wikifarm_wikis WHERE id=?")
        .bind(wiki_id)
        .execute(&state.db)
        .await;

    Ok((StatusCode::OK, Json(json!({"msg":"ok"}))).into_response())
}
