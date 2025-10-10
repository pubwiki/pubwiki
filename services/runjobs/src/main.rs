use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use anyhow::Context;
use futures::stream::{FuturesUnordered, StreamExt};
use sqlx::mysql::MySqlPoolOptions;
use tokio::process::Command;
use tokio::time::sleep;
use tracing::{error, info, level_filters::LevelFilter, warn};

#[derive(Debug, Clone)]
struct EnvCfg {
    database_url: String,
    wikifarm_dir: String, // base dir where each wiki resides as <wikifarm_dir>/<slug>
    php_bin: String,
    interval_secs: u64,
    concurrency: usize,
}

impl EnvCfg {
    fn gather() -> anyhow::Result<Self> {
        let req = |k: &str| std::env::var(k).map_err(|_| anyhow::format_err!("missing env {k}"));
        let opt = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        Ok(Self {
            database_url: req("DATABASE_URL")?,
            wikifarm_dir: opt("WIKIFARM_DIR", "/srv/wikis"),
            php_bin: opt("PHP_BIN", "php"),
            interval_secs: opt("RUNJOBS_INTERVAL_SECS", "10").parse().unwrap_or(10),
            concurrency: opt("RUNJOBS_CONCURRENCY", "4").parse().unwrap_or(4),
        })
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::builder().with_default_directive(LevelFilter::INFO.into()).from_env_lossy())
        .with_target(false)
        .with_file(true)
        .with_line_number(true)
        .init();

    let env = EnvCfg::gather()?;
    let pool = MySqlPoolOptions::new()
        .max_connections(5)
        .connect(&env.database_url)
        .await
        .context("connect DATABASE_URL")?;

    info!(interval=env.interval_secs, base_dir=%env.wikifarm_dir, "runjobs started");

    loop {
        if let Err(e) = run_once(&env, &pool).await {
            error!(error=%e, "run_once failed");
        }
        sleep(Duration::from_secs(env.interval_secs)).await;
    }
}

async fn run_once(env: &EnvCfg, pool: &sqlx::Pool<sqlx::MySql>) -> anyhow::Result<()> {
    // Query all ready wikis
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT slug FROM wikifarm_wikis WHERE status='ready' ORDER BY id"
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        info!("no wikis found (status=ready)");
        return Ok(());
    }

    info!(count=rows.len(), "running jobs for wikis");

    let mut futs = FuturesUnordered::new();
    for slug in rows {
        let concurrency = env.concurrency;
        let env = env.clone();
        futs.push(tokio::spawn(async move {
            if let Err(e) = run_for_wiki(&env, &slug).await {
                error!(%slug, error=%e, "runjobs failed for wiki");
            }
        }));
        // throttle to roughly env.concurrency at a time
        if futs.len() >= concurrency {
            let _ = futs.next().await; // wait one to complete
        }
    }
    while futs.next().await.is_some() {}
    Ok(())
}

async fn run_for_wiki(env: &EnvCfg, slug: &str) -> anyhow::Result<()> {
    // Build wiki directory and maintenance path
    let mw_dir = PathBuf::from(&env.wikifarm_dir).join(slug);
    let maint = mw_dir.join("maintenance");
    let run = maint.join("run.php");

    // Ensure dirs exist
    if !run.exists() {
        warn!(%slug, path=%run.display(), "maintenance/run not found; skip");
        return Ok(());
    }

    // 1) enotifNotify job type batch (no --wait)
    let mut cmd1 = Command::new(&env.php_bin);
    cmd1.arg(run.as_os_str())
        .arg("runJobs")
        .arg("--maxtime=3600")
        .arg("--type=enotifNotify")
        .current_dir(&mw_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    info!(%slug, "runJobs enotifNotify start");
    let status1 = cmd1.status().await.context("run enotifNotify")?;
    info!(%slug, code=?status1.code(), "runJobs enotifNotify done");

    // 2) general queue with wait and maxjobs
    let mut cmd2 = Command::new(&env.php_bin);
    cmd2.arg(run.as_os_str())
        .arg("runJobs")
        .arg("--maxtime=3600")
        .arg("--wait")
        .arg("--maxjobs=20")
        .current_dir(&mw_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    info!(%slug, "runJobs wait batch start");
    let status2 = cmd2.status().await.context("run wait batch")?;
    info!(%slug, code=?status2.code(), "runJobs wait batch done");

    Ok(())
}
