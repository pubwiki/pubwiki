use axum::{
    Json,
    extract::{FromRequestParts, Multipart, State},
    http::{StatusCode, request::Parts, HeaderMap, HeaderValue},
    response::{IntoResponse, Response},
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::json;
use sqlx::Row;
use std::collections::BTreeMap;
use tracing::{error, warn};

use crate::{
    AppState,
    auth::AuthContext,
    error::ApiError,
    validate::{self, validate},
};
use anyhow::Context;

#[derive(Deserialize, Debug)]
pub struct PermissionsBody {
    pub allow: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub deny: BTreeMap<String, Vec<String>>,
}

// Core reusable logic: replace all permissions for a wiki and regenerate permissions.php
// Returns (total_permissions, group_count)
pub async fn set_wiki_permissions(
    db: &sqlx::Pool<sqlx::MySql>,
    wiki_id: u64,
    slug: &str,
    perms: &PermissionsBody,
    config_dir: &str,
) -> Result<(), ApiError> {
    // combined map group -> perm -> allowed(bool)
    use std::collections::HashMap;
    let mut combined: HashMap<(String, String), bool> = HashMap::new();

    let mut validate_lists =
        |map: &BTreeMap<String, Vec<String>>, allowed_flag: bool| -> Result<(), ApiError> {
            for (grp, list) in map {
                validate(grp, &validate::WIKI_GROUP)?;
                if list.is_empty() {
                    continue;
                }
                for p in list {
                    validate(p, &validate::WIKI_PERM)?;
                    combined.insert((grp.clone(), p.clone()), allowed_flag);
                }
            }
            Ok(())
        };
    validate_lists(&perms.allow, true)?;
    validate_lists(&perms.deny, false)?; // deny overrides allow if duplicate key

    let mut tx = db.begin().await?;
    sqlx::query("DELETE FROM wikifarm_wiki_group_permissions WHERE wiki_id=?")
        .bind(wiki_id)
        .execute(&mut *tx)
        .await?;
    for ((grp, perm), allowed) in combined.iter() {
        sqlx::query("INSERT INTO wikifarm_wiki_group_permissions (wiki_id, group_name, permission, allowed) VALUES (?,?,?,?)")
            .bind(wiki_id)
            .bind(grp)
            .bind(perm)
            .bind(if *allowed {1} else {0})
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    // Write permissions.php with deterministic ordering (group asc, then perm asc)
    let slug_dir = format!("{config_dir}/{slug}");
    if let Err(e) = tokio::fs::create_dir_all(&slug_dir).await {
        warn!(error=%e, dir=%slug_dir, "create dir failed (continuing)");
    }
    let mut php = String::new();
    php.push_str("<?php\n// Auto-generated permissions file. Do NOT edit manually.\n");
    php.push_str(&format!(
        "// Generated at {}Z\n",
        Utc::now().format("%Y-%m-%dT%H:%M:%S")
    ));
    let mut entries: Vec<(&String, &String, &bool)> =
        combined.iter().map(|((g, p), a)| (g, p, a)).collect();
    entries.sort_by(|a, b| a.0.cmp(b.0).then(a.1.cmp(b.1)));
    for (g, p, a) in entries {
        php.push_str(&format!(
            "$wgGroupPermissions['{}']['{}'] = {};\n",
            g,
            p,
            if *a { "true" } else { "false" }
        ));
    }
    let file_path = format!("{slug_dir}/permissions.php");
    tokio::fs::write(&file_path, php)
        .await
        .with_context(|| format!("write permissions file: {file_path}"))
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "write_fs", e.to_string()))?;
    Ok(())
}

// returns (wiki_id, owner_id)
async fn wiki_info(slug: &str, db: &sqlx::Pool<sqlx::MySql>) -> sqlx::Result<Option<(u64, u64)>> {
    let wiki_row = sqlx::query("SELECT id, owner_user_id FROM wikifarm_wikis WHERE slug=? LIMIT 1")
        .bind(slug)
        .fetch_optional(db)
        .await?;

    Ok(wiki_row.map(|row| (row.get::<u64, _>("id"), row.get::<u64, _>("owner_user_id"))))
}

pub async fn set_permissions(
    State(state): State<AppState>,
    Slug(slug): Slug,
    auth: AuthContext,
    Json(body): Json<PermissionsBody>,
) -> Result<Response, ApiError> {
    validate(&slug, &validate::WIKI_SLUG)?;
    let (wiki_id, owner_id) = wiki_info(&slug, &state.db).await?.ok_or(ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "wiki is not found",
    ))?;

    if auth.user_id != owner_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_owner",
            "not owner",
        ));
    }

    let config_dir = std::env::var("WIKIFARM_CONFIG_DIR").unwrap_or_else(|_| "/config".to_string());
    set_wiki_permissions(&state.db, wiki_id, &slug, &body, &config_dir).await?;
    Ok((StatusCode::OK, Json(json!({"msg": "done"}))).into_response())
}

pub async fn get_permissions(
    State(state): State<AppState>,
    Slug(slug): Slug,
) -> Result<Response, ApiError> {
    let wiki_id =
        sqlx::query_scalar::<_, u64>("SELECT id FROM wikifarm_wikis WHERE slug=? LIMIT 1")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await?
            .ok_or(ApiError::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "wiki is not found",
            ))?;

    let list = sqlx::query("SELECT group_name, permission, allowed FROM wikifarm_wiki_group_permissions WHERE wiki_id=? ORDER BY group_name, permission")
        .bind(wiki_id)
        .fetch_all(&state.db)
        .await?;

    let mut allow: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut deny: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for row in list {
        let group_name: String = row.get::<String, _>("group_name");
        let permission: String = row.get::<String, _>("permission");
        let allowed: i8 = row.get::<i8, _>("allowed");
        if allowed == 1 {
            allow.entry(group_name).or_default().push(permission);
        } else {
            deny.entry(group_name).or_default().push(permission);
        }
    }
    Ok((StatusCode::OK, Json(json!({"allow": allow, "deny": deny}))).into_response())
}

// Internal generic sync implementation for extensions/skins.
// On any hard failure (creating destination base dir or creating a symlink), already-created items are rolled back.
async fn sync_subdirs(
    state: &AppState,
    slug: &str,
    items: Vec<String>,
    subdir: &str,
    created: &mut Vec<String>,
) -> Result<Response, ApiError> {
    validate(slug, &validate::WIKI_SLUG)?;
    let template_base = format!("{}/{subdir}", state.env.wikifarm_template);
    let dest_base = format!("{}/{slug}/{subdir}", state.env.wikifarm_dir);

    tokio::fs::create_dir_all(&dest_base).await?;

    let mut skipped: Vec<String> = Vec::new();

    for item in items {
        validate(&item, &validate::WIKI_DIR)?;
        let src = format!("{template_base}/{item}");
        let dst = format!("{dest_base}/{item}");
        if !tokio::fs::metadata(&src).await?.is_dir() {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid_param",
                "extension dir not exist",
            ));
        }
        if tokio::fs::symlink_metadata(&dst).await.is_ok() {
            skipped.push(item);
            continue;
        }

        std::os::unix::fs::symlink(&src, &dst)?;
        created.push(dst.clone());
    }

    Ok((
        StatusCode::OK,
        Json(json!({
            "skipped": skipped
        })),
    )
        .into_response())
}

async fn safe_sync_subdirs(
    state: &AppState,
    slug: &str,
    items: Vec<String>,
    subdir: &str,
) -> Result<Response, ApiError> {
    let mut created = Vec::new();
    match sync_subdirs(state, slug, items, subdir, &mut created).await {
        Err(e) => {
            // rollback
            for dir in created {
                if let Err(e) = tokio::fs::remove_file(dir).await {
                    error!(error=%e, "error when rollback sync_subdirs")
                }
            }
            Err(e)
        }
        Ok(resp) => Ok(resp),
    }
}

// POST body is a JSON array of directory names to sync
pub async fn sync_extensions(
    State(state): State<AppState>,
    Slug(slug): Slug,
    auth: AuthContext,
    Json(items): Json<Vec<String>>,
) -> Result<Response, ApiError> {
    let (_, owner_id) = wiki_info(&slug, &state.db).await?.ok_or(ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "wiki is not found",
    ))?;

    if auth.user_id != owner_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_owner",
            "not owner",
        ));
    }

    safe_sync_subdirs(&state, &slug, items, "extensions").await
}

pub async fn sync_skins(
    State(state): State<AppState>,
    Slug(slug): Slug,
    auth: AuthContext,
    Json(items): Json<Vec<String>>,
) -> Result<Response, ApiError> {
    let (_, owner_id) = wiki_info(&slug, &state.db).await?.ok_or(ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "wiki is not found",
    ))?;

    if auth.user_id != owner_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_owner",
            "not owner",
        ));
    }

    safe_sync_subdirs(&state, &slug, items, "skins").await
}

#[derive(Deserialize, Debug)]
pub struct VisibilityBody {
    pub visibility: String,
}

// Set wiki visibility: { "visibility": "public" | "unlisted" | "private" }
pub async fn set_visibility(
    State(state): State<AppState>,
    Slug(slug): Slug,
    auth: AuthContext,
    Json(body): Json<VisibilityBody>,
) -> Result<Response, ApiError> {
    // Check wiki exists and ownership
    let (wiki_id, owner_id) = wiki_info(&slug, &state.db)
        .await?
        .ok_or(ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "wiki is not found",
        ))?;

    if auth.user_id != owner_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_owner",
            "not owner",
        ));
    }

    // Normalize and validate visibility
    let vis = body.visibility.trim().to_lowercase();
    let allowed = ["public", "unlisted", "private"];
    if !allowed.contains(&vis.as_str()) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_param",
            "visibility must be one of: public, unlisted, private",
        ));
    }

    sqlx::query("UPDATE wikifarm_wikis SET visibility=? WHERE id=?")
        .bind(&vis)
        .bind(wiki_id)
        .execute(&state.db)
        .await?;

    Ok((StatusCode::OK, Json(json!({"msg": "ok", "visibility": vis}))).into_response())
}

// ForwardAuth hook: check wiki visibility and decide pass/block
// 200 for public/unlisted; 403 for private; 404 if wiki not found or not ready
pub async fn visibility_check(
    State(state): State<AppState>,
    auth: AuthContext,
    Slug(slug): Slug,
) -> Result<Response, ApiError> {
    let row = sqlx::query("SELECT visibility, status FROM wikifarm_wikis WHERE slug=? LIMIT 1")
        .bind(&slug)
        .fetch_optional(&state.db)
        .await?;

    if row.is_none() {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not_found", "wiki is not found"));
    }
    let row = row.unwrap();
    let visibility: String = row.get::<String, _>("visibility");
    let status: String = row.get::<String, _>("status");
    if status != "ready" {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not_ready", "wiki not ready"));
    }

    // Fetch user groups from the sub-wiki database, if logged in (uid > 0)
    let mut groups: Vec<String> = Vec::new();
    if auth.user_id > 0 {
        // slug is validated; safe to inline as schema identifier with backticks
        let query = format!(
            "SELECT ug_group FROM `{slug}`.user_groups WHERE ug_user=?",
        );
        let rows = sqlx::query(&query)
            .bind(auth.user_id)
            .fetch_all(&state.db)
            .await?;
        groups = rows
            .into_iter()
            .map(|row| {
                let bytes: Vec<u8> = row.get("ug_group");
                String::from_utf8_lossy(&bytes).into_owned()
            })
            .collect();
        groups.sort();
        groups.dedup();
    }

    let mut headers = HeaderMap::new();
    if !groups.is_empty()
        && let Ok(val) = HeaderValue::from_str(&groups.join(",")) 
    {
        headers.insert("X-Auth-User-Groups", val);
    }

    match visibility.as_str() {
        "public" => {
            headers.insert("X-Wiki-Visibility", HeaderValue::from_static("public"));
            Ok((StatusCode::OK, headers).into_response())
        }
        "unlisted" => {
            headers.insert("X-Wiki-Visibility", HeaderValue::from_static("unlisted"));
            headers.insert("X-Robots-Tag", HeaderValue::from_static("noindex"));
            Ok((StatusCode::OK, headers).into_response())
        }
        "private" => {
            if groups.iter().any(|g| g == "sysop") {
                return Ok((StatusCode::OK, headers).into_response());
            }
            Err(ApiError::new(StatusCode::FORBIDDEN, "private", "private wiki"))
        }
        _ => Err(ApiError::new(StatusCode::FORBIDDEN, "unknown_visibility", visibility)),
    }
}

// Upload favicon and save as /srv/wikis/<slug>/w/favicon.ico
pub async fn set_favicon(
    State(state): State<AppState>,
    Slug(slug): Slug,
    auth: AuthContext,
    mut multipart: Multipart,
) -> Result<Response, ApiError> {
    // Only owner can set favicon
    let (_, owner_id) = wiki_info(&slug, &state.db).await?.ok_or(ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        "wiki is not found",
    ))?;
    if auth.user_id != owner_id {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "not_owner",
            "not owner",
        ));
    }

    validate(&slug, &validate::WIKI_SLUG)?;

    // Parse first file part
    let mut file_bytes: Option<Vec<u8>> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "multipart", e.to_string()))?
    {
        if field.file_name().is_some() {
            // Limit size to 2MB to avoid abuse
            let data = field.bytes().await.map_err(|e| {
                ApiError::new(StatusCode::BAD_REQUEST, "upload_read", e.to_string())
            })?;
            if data.len() > 2 * 1024 * 1024 {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "file_too_large",
                    "max 2MB",
                ));
            }
            file_bytes = Some(data.to_vec());
            break;
        }
    }

    let bytes = file_bytes
        .ok_or_else(|| ApiError::new(StatusCode::BAD_REQUEST, "no_file", "no file uploaded"))?;

    // Basic content sniff: ICO or PNG/JPEG acceptable; but we always store as favicon.ico (browsers accept png named .ico too)
    let is_png = bytes.starts_with(&[0x89, b'P', b'N', b'G']);
    let is_ico = bytes.get(0..4) == Some(&[0x00, 0x00, 0x01, 0x00]);
    let is_jpg = bytes.get(0..3) == Some(&[0xFF, 0xD8, 0xFF]);
    if !(is_png || is_ico || is_jpg) {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_type",
            "expect PNG/ICO/JPEG",
        ));
    }

    // Compute path: <wikifarm_dir>/<slug>/w/favicon.ico
    let wiki_root = format!("{}/{}", state.env.wikifarm_dir, slug);
    let path = format!("{wiki_root}/favicon.ico");
    tokio::fs::write(&path, &bytes)
        .await
        .with_context(|| format!("write favicon: {path}"))
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "write_fs", e.to_string()))?;
    std::os::unix::fs::chown(path, Some(33), Some(33))?;

    Ok((StatusCode::OK, Json(json!({"msg":"ok"}))).into_response())
}

// Extract slug from X-Forwarded-Host (or Host) by removing env.WIKI_HOST suffix
// and taking the right-most label of the remaining part.
pub struct Slug(pub String);

impl FromRequestParts<AppState> for Slug {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Prefer X-Forwarded-Host; fallback to Host
        let raw = parts
            .headers
            .get("X-Forwarded-Host")
            .or_else(|| parts.headers.get("x-forwarded-host"))
            .or_else(|| parts.headers.get("Host"))
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "missing_header",
                    "X-Forwarded-Host/Host is required",
                )
            })?;

        let mut host = raw.to_str().unwrap_or("").trim().to_string();
        if let Some((first, _)) = host.split_once(',') {
            host = first.trim().to_string();
        }
        if let Some((h, port)) = host.rsplit_once(':') 
            && port.chars().all(|c| c.is_ascii_digit())
        {
            host = h.to_string();
        }

        let suffix = std::env::var("WIKI_HOST").unwrap_or_default();
        let suffix = suffix.trim();
        if suffix.is_empty() {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "env",
                "WIKI_HOST not set",
            ));
        }
        if host == suffix {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "no_slug",
                "root host has no slug",
            ));
        }
        let rest = if let Some(stripped) = host.strip_suffix(suffix) {
            if let Some(rest) = stripped.strip_suffix('.') {
                rest.to_string()
            } else {
                stripped.to_string()
            }
        } else {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "host_mismatch",
                "host not under WIKI_HOST",
            ));
        };

        let slug = rest
            .split('.')
            .filter(|s| !s.is_empty())
            .next_back()
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "no_slug",
                    "no subdomain before WIKI_HOST",
                )
            })?
            .to_string();

        validate(&slug, &validate::WIKI_SLUG)?;
        Ok(Slug(slug))
    }
}
