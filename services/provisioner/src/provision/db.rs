use sqlx::{Executor, MySql, Pool};

#[derive(thiserror::Error, Debug)]
pub enum DbProvError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("invalid identifier: {0}")]
    InvalidIdentifier(String),
    #[error("invalid literal: {0}")]
    InvalidLiteral(String),
}

pub async fn provision_db(
    pool: &Pool<MySql>,
    wiki_db_name: &str,
    wiki_db_user: &str,
    wiki_db_password: &str,
    shared_db_name: &str,
) -> Result<(), DbProvError> {
    let mut conn = pool.acquire().await?;
    // Validate identifiers strictly (whitelist). We do not attempt to escape identifiers;
    // instead, we only allow a safe subset of characters and then wrap with backticks.
    fn validate_ident(s: &str) -> Result<(), DbProvError> {
        // MySQL identifier rules are complex; we intentionally use a conservative subset:
        // - 1..=64 chars
        // - ASCII letters, digits, underscore and hyphen only
        // - no backticks or whitespace/control characters
        if s.is_empty() || s.len() > 64 {
            return Err(DbProvError::InvalidIdentifier(s.to_string()));
        }
        if s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            Ok(())
        } else {
            Err(DbProvError::InvalidIdentifier(s.to_string()))
        }
    }

    // Escape string literal for inclusion inside single quotes by doubling single quotes.
    // Reject NULs and control chars.
    fn escape_string_literal(s: &str) -> Result<String, DbProvError> {
        if s.chars().any(|c| c == '\0' || c.is_control()) {
            return Err(DbProvError::InvalidLiteral(
                "control/NUL characters in string".into(),
            ));
        }
        Ok(s.replace("'", "''"))
    }

    validate_ident(wiki_db_name)?;
    validate_ident(wiki_db_user)?;
    validate_ident(shared_db_name)?;
    let pw = escape_string_literal(wiki_db_password)?;

    // Split into single statements (no multi-statement execution)
    // 1) CREATE DATABASE
    let create_db = ["CREATE DATABASE IF NOT EXISTS `", wiki_db_name, "`"].concat();
    conn.execute(create_db.as_str()).await?;

    // 2) CREATE USER (IF NOT EXISTS)
    let create_user = [
        "CREATE USER IF NOT EXISTS '",
        wiki_db_user,
        "'@'%' IDENTIFIED BY '",
        pw.as_str(),
        "'",
    ]
    .concat();
    conn.execute(create_user.as_str()).await?;

    // 3) GRANT privileges on wiki db
    let grant_wiki = [
        "GRANT ALL PRIVILEGES ON `",
        wiki_db_name,
        "`.* TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_wiki.as_str()).await?;

    // 4) GRANT limited privileges on shared tables
    let grant_user_tbl = [
        "GRANT SELECT, UPDATE, INSERT ON `",
        shared_db_name,
        "`.`user` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_user_tbl.as_str()).await?;

    let grant_user_props_tbl = [
        "GRANT SELECT, UPDATE, INSERT, DELETE ON `",
        shared_db_name,
        "`.`user_properties` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_user_props_tbl.as_str()).await?;

    let grant_actor_tbl = [
        "GRANT SELECT, UPDATE, INSERT ON `",
        shared_db_name,
        "`.`actor` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_actor_tbl.as_str()).await?;

    let grant_oauth_registered_tbl = [
        "GRANT SELECT ON `",
        shared_db_name,
        "`.`oauth_registered_consumer` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_oauth_registered_tbl.as_str()).await?;
    let grant_accepted_consumer_tbl = [
        "GRANT SELECT ON `",
        shared_db_name,
        "`.`oauth_accepted_consumer` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_accepted_consumer_tbl.as_str()).await?;
    let grant_access_tokens_tbl = [
        "GRANT SELECT ON `",
        shared_db_name,
        "`.`oauth2_access_tokens` TO '",
        wiki_db_user,
        "'@'%'",
    ]
    .concat();
    conn.execute(grant_access_tokens_tbl.as_str()).await?;

    // 5) FLUSH PRIVILEGES
    conn.execute("FLUSH PRIVILEGES").await?;
    Ok(())
}

/// Best-effort rollback: drop created user and database
pub async fn deprovision_db(
    pool: &Pool<MySql>,
    wiki_db_name: &str,
    wiki_db_user: &str,
) -> Result<(), DbProvError> {
    let mut conn = pool.acquire().await?;

    fn validate_ident(s: &str) -> Result<(), DbProvError> {
        if s.is_empty() || s.len() > 64 {
            return Err(DbProvError::InvalidIdentifier(s.to_string()));
        }
        if s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            Ok(())
        } else {
            Err(DbProvError::InvalidIdentifier(s.to_string()))
        }
    }

    validate_ident(wiki_db_name)?;
    validate_ident(wiki_db_user)?;

    // Drop user first to remove grants
    let drop_user = ["DROP USER IF EXISTS '", wiki_db_user, "'@'%'"].concat();
    let _ = conn.execute(drop_user.as_str()).await;

    // Then drop database
    let drop_db = ["DROP DATABASE IF EXISTS `", wiki_db_name, "`"].concat();
    let _ = conn.execute(drop_db.as_str()).await;

    // Flush privileges (best-effort)
    let _ = conn.execute("FLUSH PRIVILEGES").await;
    Ok(())
}
