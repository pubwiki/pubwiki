use std::net::SocketAddr;

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client as RedisClient};
use serde::{Deserialize, Serialize};
use sqlx::mysql::MySqlPoolOptions;
use tracing::{debug, error, info, warn};
mod provision;

use wikifarm_service::env::WikifarmEnv;
// Use the library for router, app state, and event types
pub use wikifarm_service::events; // re-export so crate::events works in provision modules
use wikifarm_service::events::{Event as TaskEvent, Status};
use wikifarm_service::{AppState, build_router};

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Owner {
    id: u64,
    username: String,
}

// tests moved to integration tests in `tests/`

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .init();

    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL is required");
    let redis_url = std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1/".into());

    let db = MySqlPoolOptions::new()
        .max_connections(10)
        .connect(&db_url)
        .await
        .expect("failed to connect to MySQL");

    let redis = RedisClient::open(redis_url).expect("invalid REDIS_URL");

    let env = WikifarmEnv::gather()?;
    let state = AppState {
        db,
        redis,
        env
    };
    let worker_state = state.clone();

    let app = build_router(state);

    // start background worker for job queue
    tokio::spawn(worker_loop(worker_state));

    let addr: SocketAddr = "0.0.0.0:8080".parse().unwrap();
    info!(%addr, "HTTP server listening");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
struct JobPayload {
    task_id: String,
    name: String,
    slug: String,
    language: String,
    visibility: Option<String>,
    owner: Owner,
}

async fn worker_loop(state: AppState) {
    // One Redis connection per worker loop
    let mut conn = match state.redis.get_multiplexed_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            panic!("redis conn error in worker: {e}");
        }
    };

    loop {
        if let Err(e) = worker_process(&state, &mut conn).await {
            error!(error=%e, "error when processing worker");
        }
    }
}

async fn worker_process(state: &AppState, conn: &mut MultiplexedConnection) -> anyhow::Result<()> {
    // BRPOP blocks with timeout; if timeout, loop to allow shutdown checks (future)
    let Ok(Some((_, job))): redis::RedisResult<Option<(String, String)>> = redis::cmd("BRPOP")
        .arg("wikifarm:jobs")
        .arg(5)
        .query_async(conn)
        .await
    else {
        return Ok(())
    };

    let job = serde_json::from_str::<JobPayload>(&job)?;

    let channel = format!("wikifarm:tasks:{}", job.task_id);
    info!(task_id=%job.task_id, slug=%job.slug, name=%job.name, "dequeued provisioning job");

    match do_job(state, &job, &channel).await {
        Ok(wiki_id) => {
            info!(task_id=%job.task_id, wiki_id, slug=%job.slug, "provisioning succeeded");
            // final DB status
            sqlx::query("UPDATE wikifarm_tasks SET status='succeeded', progress=100, finished_at=NOW(), wiki_id=? WHERE id = ?")
                .bind(wiki_id)
                .bind(&job.task_id)
                .execute(&state.db)
                .await?;
            // publish final status (orchestrator already published, but ensure)
            let msg = serde_json::to_string(&TaskEvent::Status {
                status: Status::Succeeded,
                wiki_id: Some(wiki_id),
                message: None,
            })?;
            let _: i32 = conn.publish(&channel, msg).await?;
        }
        Err(msg) => {
            warn!(task_id=%job.task_id, slug=%job.slug, error=%msg, "provisioning failed");
            sqlx::query("UPDATE wikifarm_tasks SET status='failed', finished_at=NOW(), message=? WHERE id = ?")
                .bind(&msg)
                .bind(&job.task_id)
                .execute(&state.db)
                .await?;
            let msg = serde_json::to_string(&TaskEvent::Status {
                status: Status::Failed,
                wiki_id: None,
                message: Some(msg),
            })?;
            let _: i32 = conn.publish(&channel, msg).await?;
        }
    }

    Ok(())
}

async fn do_job(state: &AppState, job: &JobPayload, channel: &str) -> Result<u64, String> {
    // mark task running
    let _ =
        sqlx::query("UPDATE wikifarm_tasks SET status='running', started_at=NOW() WHERE id = ?")
            .bind(&job.task_id)
            .execute(&state.db)
            .await;
    debug!(task_id=%job.task_id, slug=%job.slug, "starting provisioning steps");

    // Use a UUID v4 (hex) as DB password
    let db_password = uuid::Uuid::new_v4().to_string().replace('-', "");

    let mut ctx = provision::orchestrator::ProvisionContext {
        name: &job.name,
        slug: &job.slug,
        language: &job.language,
        visibility: job.visibility.as_deref()
            .unwrap_or("public"),
        owner_user_id: job.owner.id,
        owner_username: &job.owner.username,
        db: &state.db,
        redis: &state.redis,
        channel,
        target_dir: &format!("{}/{}", state.env.wikifarm_dir, job.slug),
        oauth_dir: &format!("{}/{}", state.env.wikifarm_oauth_dir, job.slug),
        db_name: &job.slug,
        db_user: &job.slug,
        db_password: &db_password,
        socket: "unix:///var/run/docker.sock",
        steps: Vec::new(),
        env: &state.env,
    };

    match provision::orchestrator::run(&mut ctx).await {
        Ok(wiki_id) => Ok(wiki_id),
        Err(e) => {
            warn!(task_id=%job.task_id, error=%e, "orchestrator run failed; invoking rollback");
            // rollback based on context
            if let Ok(_) = std::env::var("DISABLE_ROLLBACK") {
                return Err(format!("provision error: {e}"))
            }
            provision::orchestrator::rollback(&mut ctx).await;
            debug!(task_id=%job.task_id, slug=%job.slug, "rollback complete");
            Err(format!("provision error: {e}"))
        }
    }
}
