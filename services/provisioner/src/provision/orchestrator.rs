use super::{db, docker, fs, ini};
use crate::events::{Event, Phase, Status};
use crate::{
    env::WikifarmEnv,
    manage::{PermissionsBody, set_wiki_permissions},
    validate::{self, validate},
};
use redis::AsyncCommands;
use sqlx::{MySql, Pool};
use tracing::{debug, info, warn};

// Steps completed, used by rollback
#[derive(Clone, Copy, Debug)]
pub enum Step {
    FsDir,
    IniWritten,
    DbProvisioned,
    InsertWikiRecord(u64),
    WritePermissions(u64),
    DockerInstalled,
    DockerIndexCfg,
    BootstrapFlipped,
    Indexed1,
    Indexed2,
    RebuildSMWData,
}

// Context is constructed by the caller (worker) and passed by &mut
#[derive(Debug)]
pub struct ProvisionContext<'a> {
    pub env: &'a WikifarmEnv,
    pub name: &'a str,
    pub slug: &'a str,
    pub language: &'a str,
    pub visibility: &'a str,
    pub owner_user_id: u64,
    pub owner_username: &'a str,
    pub db: &'a Pool<MySql>,
    pub redis: &'a redis::Client,
    pub channel: &'a str,
    pub target_dir: &'a str,
    pub db_name: &'a str,
    pub db_user: &'a str,
    pub db_password: &'a str,
    pub socket: &'a str,
    pub steps: Vec<Step>,
}

async fn publish_event<C: AsyncCommands + Send>(
    conn: &mut C,
    channel: &str,
    event: &Event,
) -> anyhow::Result<()> {
    let payload = serde_json::to_string(event)?;
    // Publish to streaming channel
    conn.publish::<_, _, ()>(channel, &payload).await?;
    // Cache last event (best-effort) so late SSE subscribers can get current phase immediately.
    // Use a side key: <channel>:last (expire after 1h to avoid unbounded growth)
    let last_key = format!("{channel}:last");
    let _: Result<(), _> = conn.set_ex(&last_key, &payload, 3600).await; // ignore errors
    Ok(())
}

// Execute provisioning. Caller owns context and handles rollback on Err.
pub async fn run<'a>(ctx: &mut ProvisionContext<'a>) -> anyhow::Result<u64> {
    let mut rconn: redis::aio::MultiplexedConnection =
        ctx.redis.get_multiplexed_tokio_connection().await?;
    info!(slug=%ctx.slug, name=%ctx.name, "provision run started");

    // 1) FS copy
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("symlink template".into()),
            phase: Some(Phase::DirCopy),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, template=%ctx.env.wikifarm_template, target=%ctx.target_dir, "copy template start");
    fs::symlink_template(&ctx.env.wikifarm_template, ctx.target_dir).await?;
    debug!(slug=%ctx.slug, "symlink template done");
    ctx.steps.push(Step::FsDir);

    // 2) INI
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("render ini".into()),
            phase: Some(Phase::RenderIni),
        },
    )
    .await?;
    let cfg = ini::WikiIniConfig {
        name: ctx.name,
        slug: ctx.slug,
        language: ctx.language,
        wiki_host: &ctx.env.wiki_host,
        db_host: &ctx.env.wiki_db_host,
        db_name: ctx.db_name,
        db_user: ctx.db_user,
        db_password: ctx.db_password,
        shared_db_name: &ctx.env.wiki_shared_db_name,
        opensearch_user: &ctx.env.opensearch_user,
        opensearch_port: &ctx.env.opensearch_port,
        opensearch_transport: &ctx.env.opensearch_transport,
        opensearch_password: &ctx.env.opensearch_password,
        opensearch_endpoint: &ctx.env.opensearch_endpoint,
        redis_password: &ctx.env.redis_password,
        redis_server: &ctx.env.redis_server,
        wiki_aws_region: &ctx.env.wiki_aws_region,
    };
    debug!(slug=%ctx.slug, config_dir=%ctx.env.wikifarm_config_dir, "render ini start");
    ini::render_pubwiki_ini(&ctx.env.wikifarm_config_dir, &cfg, true).await?;
    ini::write_slug_marker(ctx.target_dir, ctx.slug)?;
    debug!(slug=%ctx.slug, "ini + slug marker written");
    ctx.steps.push(Step::IniWritten);

    // 3) DB
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("db provision".into()),
            phase: Some(Phase::DbProvision),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, db=%ctx.db_name, user=%ctx.db_user, "db provision start");
    db::provision_db(
        ctx.db,
        ctx.db_name,
        ctx.db_user,
        ctx.db_password,
        &ctx.env.wiki_shared_db_name,
    )
    .await?;
    ctx.steps.push(Step::DbProvisioned);
    debug!(slug=%ctx.slug, "db provision done");

    // 5) apply default group permissions via template/permissions.json
    // Supported formats:
    // 1) New: {"allow": {"group":["perm"]}, "deny": {"group":["perm"]}}
    // 2) Legacy: {"group":["perm"]}  (treated as allow only)
    // Record wiki row
    debug!(slug=%ctx.slug, "insert wiki row");
    let res = sqlx::query("INSERT INTO wikifarm_wikis (name, slug, domain, path, language, owner_user_id, owner_username, visibility, status, is_featured)
                           VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, 'ready', 0)")
        .bind(ctx.name)
        .bind(ctx.slug)
        .bind(ctx.language)
        .bind(ctx.owner_user_id)
        .bind(ctx.owner_username)
        .bind(ctx.visibility)
        .execute(ctx.db)
        .await?;
    let wiki_id = res.last_insert_id() as u64;
    ctx.steps.push(Step::InsertWikiRecord(wiki_id));

    let perms_path = format!("{}/permissions.json", ctx.env.wikifarm_template);
    let raw = std::fs::read_to_string(&perms_path)?;
    let pb = serde_json::from_str::<PermissionsBody>(&raw)?;
    let cfg_dir = &ctx.env.wikifarm_config_dir;
    set_wiki_permissions(ctx.db, wiki_id, ctx.slug, &pb, cfg_dir).await?;
    ctx.steps.push(Step::WritePermissions(wiki_id));
    info!(slug=%ctx.slug, path=%perms_path, "default permissions applied");

    // 6) Docker exec (install + update index config)
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("install site".into()),
            phase: Some(Phase::DockerInstall),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, container=%ctx.env.wikifarm_instance, "docker install step start");
    docker::exec_in_container(
        ctx.socket,
        &ctx.env.wikifarm_instance,
        vec!["php", "maintenance/run", "installPreConfigured"],
        Some(ctx.target_dir),
    )
    .await?;
    ctx.steps.push(Step::DockerInstalled);
    debug!(slug=%ctx.slug, "docker install step done");

    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("update search index config".into()),
            phase: Some(Phase::DockerIndexCfg),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, "docker index config update start");
    docker::exec_in_container(
        ctx.socket,
        &ctx.env.wikifarm_instance,
        vec![
            "php",
            "maintenance/run",
            "./extensions/CirrusSearch/maintenance/UpdateSearchIndexConfig.php",
        ],
        Some(ctx.target_dir),
    )
    .await?;
    ctx.steps.push(Step::DockerIndexCfg);
    debug!(slug=%ctx.slug, "docker index config update done");

    // 7) Flip bootstrap off
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("flip bootstrap".into()),
            phase: Some(Phase::FlipBootstrap),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, "flip bootstrap off");
    ini::render_pubwiki_ini(&ctx.env.wikifarm_config_dir, &cfg, false).await?;
    ctx.steps.push(Step::BootstrapFlipped);

    // 8) Initial indexing
    publish_event(
        &mut rconn,
        ctx.channel,
        &Event::Progress {
            status: Status::Running,
            message: Some("initial index".into()),
            phase: Some(Phase::Index),
        },
    )
    .await?;
    debug!(slug=%ctx.slug, "initial indexing phase 1 start");
    docker::exec_in_container(
        ctx.socket,
        &ctx.env.wikifarm_instance,
        vec![
            "php",
            "maintenance/run",
            "./extensions/CirrusSearch/maintenance/ForceSearchIndex.php",
            "--skipLinks",
            "--indexOnSkip",
        ],
        Some(ctx.target_dir),
    )
    .await?;
    ctx.steps.push(Step::Indexed1);
    debug!(slug=%ctx.slug, "initial indexing phase 1 done");

    debug!(slug=%ctx.slug, "initial indexing phase 2 start");
    docker::exec_in_container(
        ctx.socket,
        &ctx.env.wikifarm_instance,
        vec![
            "php",
            "maintenance/run",
            "./extensions/CirrusSearch/maintenance/ForceSearchIndex.php",
            "--skipParse",
        ],
        Some(ctx.target_dir),
    )
    .await?;
    ctx.steps.push(Step::Indexed2);
    debug!(slug=%ctx.slug, "initial indexing phase 2 done");

    debug!(slug=%ctx.slug, "rebuild SMW data");
    docker::exec_in_container(
        ctx.socket,
        &ctx.env.wikifarm_instance,
        vec![
            "php",
            "maintenance/run",
            "./extensions/SemanticMediaWiki/maintenance/rebuildData.php",
        ],
        Some(ctx.target_dir),
    )
    .await?;
    ctx.steps.push(Step::RebuildSMWData);
    debug!(slug=%ctx.slug, "rebuild SMW data done");

    // 9) Grant initial elevated rights (bureaucrat & sysop) to creator on the new wiki DB.
    // We trust prior validation of slug to be safe as schema identifier. Still, re-validate minimal.
    validate(ctx.db_name, &validate::WIKI_SLUG)?;
    let db_name = &ctx.db_name; // same as slug
    // Compose SQL with inlined database name (can't parametrize schema). Using INSERT IGNORE to avoid duplicates if rerun.
    let grant_sql = format!(
        r#"INSERT IGNORE INTO `{db_name}`.user_groups (ug_user, ug_group) 
           VALUES (?, 'bureaucrat'), (?, 'translator'), (?, 'sysop')"#
    );
    sqlx::query(&grant_sql)
        .bind(ctx.owner_user_id)
        .bind(ctx.owner_user_id)
        .bind(ctx.owner_user_id)
        .execute(ctx.db)
        .await?;
    info!(slug=%ctx.slug, user_id=%ctx.owner_user_id, "granted creator bureaucrat+sysop groups");
    info!(slug=%ctx.slug, wiki_id, "provision run finished successfully");

    Ok(wiki_id)
}

// Best-effort rollback by reversing completed steps
pub async fn rollback<'a>(ctx: &mut ProvisionContext<'a>) {
    warn!(slug=%ctx.slug, steps=?ctx.steps, "rollback start");
    while let Some(step) = ctx.steps.pop() {
        match step {
            Step::DbProvisioned => {
                debug!(slug=%ctx.slug, "rollback: deprovision db");
                let _ = db::deprovision_db(ctx.db, ctx.db_name, ctx.db_user).await;
            }
            Step::IniWritten => {
                debug!(slug=%ctx.slug, "rollback: remove ini directory");
                let _ = ini::remove_ini_dir(&ctx.env.wikifarm_config_dir, ctx.slug);
            }
            Step::FsDir => {
                debug!(slug=%ctx.slug, "rollback: remove target dir");
                let _ = fs::remove_dir_all_if_exists(ctx.target_dir);
            }
            Step::InsertWikiRecord(wiki_id) => {
                debug!(slug=%ctx.slug, wiki_id, "rollback: delete wiki row");
                // Best-effort delete; ignore errors (e.g., if already removed or never committed)
                if let Err(e) = sqlx::query("DELETE FROM wikifarm_wikis WHERE id=?")
                    .bind(wiki_id)
                    .execute(ctx.db)
                    .await
                {
                    warn!(slug=%ctx.slug, wiki_id, error=%e, "rollback: delete wiki row failed");
                }
            }
            Step::WritePermissions(wiki_id) => {
                sqlx::query("DELETE FROM wikifarm_wiki_group_permissions WHERE wiki_id=?")
                    .bind(wiki_id)
                    .execute(ctx.db)
                    .await
                    .ok();
            }
            _ => {}
        }
    }
    warn!(slug=%ctx.slug, "rollback complete");
}
