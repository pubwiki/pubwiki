use ini::Ini;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(thiserror::Error, Debug)]
pub enum IniError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ini parse error: {0}")]
    Ini(String),
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
pub fn render_pubwiki_ini(
    config_dir: &str,
    cfg: &WikiIniConfig,
    bootstrapping: bool,
) -> Result<(), IniError> {
    let path = Path::new(config_dir).join(cfg.slug).join("pubwiki.ini");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        std::os::unix::fs::chown(parent, Some(33), Some(33))?;
    }

    let site_ns = cfg.name.replace(' ', "_");
    let host_url = format!("https://{}.{}", cfg.slug, cfg.wiki_host);

    // Create a new INI (no sections, use general section)
    let mut ini = Ini::new();
    {
        let mut sec = ini.with_general_section();
        let mut set = |k, v| {
            sec.set(k, format!("\"{v}\""));
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
    }

    ini.write_to_file(path)
        .map_err(|e| IniError::Ini(e.to_string()))
}

/// Update only the WIKI_BOOTSTRAPING flag in an existing pubwiki.ini
pub fn set_bootstrapping(config_dir: &str, slug: &str, value: bool) -> Result<(), IniError> {
    let path = Path::new(config_dir).join(slug).join("pubwiki.ini");
    let mut ini = Ini::load_from_file(&path).map_err(|e| IniError::Ini(e.to_string()))?;
    {
        let mut sec = ini.with_general_section();
        sec.set("WIKI_BOOTSTRAPING", if value { "true" } else { "false" });
    }
    ini.write_to_file(&path)
        .map_err(|e| IniError::Ini(e.to_string()))
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

    #[test]
    fn test_ini() {
        let mut cfg = WikiIniConfig::default();
        cfg.db_password = &"su&#@!";
        render_pubwiki_ini("/home/m4tsuri/Downloads/test", &cfg, true).unwrap();
    }
}
