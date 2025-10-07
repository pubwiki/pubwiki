use tokio::fs::File;
use std::fmt::Write;
use tokio::io::AsyncWriteExt;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(thiserror::Error, Debug)]
pub enum IniError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Default)]
pub struct WikiIniConfig<'a> {
    pub name: &'a str,
    pub slug: &'a str,
    pub language: &'a str,
    pub wiki_host: &'a str,
    pub db_host: &'a str,
    pub db_name: &'a str,
    pub db_user: &'a str,
    pub db_password: &'a str,
    pub shared_db_name: &'a str,
    pub opensearch_user: &'a str,
    pub opensearch_transport: &'a str,
    pub opensearch_port: &'a str,
    pub opensearch_password: &'a str,
    pub opensearch_endpoint: &'a str,
    pub redis_password: &'a str,
    pub redis_server: &'a str,
    pub wiki_aws_region: &'a str,
}

/// Render the pubwiki.ini file by writing simple key=value pairs.
/// Set bootstrapping to true for the initial install, and false after flip.
pub async fn render_pubwiki_ini<'a>(
    config_dir: &str,
    cfg: &WikiIniConfig<'a>,
    bootstrapping: bool,
) -> Result<(), IniError> {
    let path = Path::new(config_dir).join(cfg.slug).join("pubwiki.ini");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(not(test))]
        std::os::unix::fs::chown(parent, Some(33), Some(33))?;
    }

    let site_ns = cfg.name.replace(' ', "_");
    let host_url = format!("https://{}.{}", cfg.slug, cfg.wiki_host);

    let mut file = File::create(path).await?;

    let mut content = String::new();
    let mut set = |k, v: &str| {
        if v.chars().all(char::is_alphanumeric) {
            // add quotes to values that contains non-alphanumeric char
            // see notes in https://www.php.net/manual/en/function.parse-ini-file.php
            writeln!(content, "{k}={v}").unwrap();
        } else {
            writeln!(content, "{k}=\"{v}\"").unwrap();
        }
    };

    set("WIKI_SITE_NAME", cfg.name);
    set("WIKI_HOST_URL", &host_url);
    set("WIKI_HOST", cfg.wiki_host);
    set("WIKI_META_NAMESPACE", &site_ns);
    set("WIKI_DB_HOST", cfg.db_host);
    set("WIKI_DB_NAME", cfg.db_name);
    set("WIKI_DB_USER", cfg.db_user);
    set("WIKI_DB_PASSWORD", cfg.db_password);
    set("WIKI_SHARED_DB_NAME", cfg.shared_db_name);
    set("WIKI_LANG", cfg.language);
    set("WIKI_AWS_REGION", cfg.wiki_aws_region);
    set("OPENSEARCH_USER", cfg.opensearch_user);
    set("OPENSEARCH_PORT", cfg.opensearch_port);
    set("OPENSEARCH_TRANSPORT", cfg.opensearch_transport);
    set("OPENSEARCH_PASSWORD", cfg.opensearch_password);
    set("OPENSEARCH_ENDPOINT", cfg.opensearch_endpoint);
    set("REDIS_PASSWORD", cfg.redis_password);
    set("REDIS_SERVER", cfg.redis_server);
    set(
        "WIKI_BOOTSTRAPING",
        if bootstrapping { "true" } else { "false" },
    );
    set("WIKI_DEBUGGING", "true");
    file.write_all(content.as_bytes()).await?;
    Ok(())
}

/// Remove the whole slug-specific ini directory (config_dir/<slug>) during rollback.
pub fn remove_ini_dir(config_dir: &str, slug: &str) -> Result<(), IniError> {
    let dir = Path::new(config_dir).join(slug);
    match fs::remove_dir_all(&dir) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(IniError::Io(e)),
    }
}

/// Write slug marker file to target_dir: <target_dir>/slug.wiki with line: WIKI_SLUG=<slug>
pub fn write_slug_marker(target_dir: &str, slug: &str) -> Result<(), IniError> {
    let path: PathBuf = Path::new(target_dir).join("slug.ini");
    fs::write(path, format!("WIKI_SLUG={slug}\n"))?;
    Ok(())
}

#[cfg(test)]
mod test {
    use crate::provision::ini::{WikiIniConfig, render_pubwiki_ini};

    #[tokio::test]
    async fn test_ini() {
        let mut cfg = WikiIniConfig::default();
        cfg.db_password = &"su&#@!";
        render_pubwiki_ini("/home/m4tsuri/Downloads/test", &cfg, true).await.unwrap();
        render_pubwiki_ini("/home/m4tsuri/Downloads/test", &cfg, false).await.unwrap();
    }
}
