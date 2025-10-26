use std::env;

#[derive(Clone, Debug)]
pub struct WikifarmEnv {
    pub wikifarm_dir: String,
    pub wikifarm_template: String,
    pub wikifarm_config_dir: String,
    pub wikifarm_instance: String,
    pub wiki_host: String,
    pub wiki_db_host: String,
    pub wiki_shared_db_name: String,
    pub opensearch_user: String,
    pub opensearch_port: String,
    pub opensearch_transport: String,
    pub opensearch_password: String,
    pub opensearch_endpoint: String,
    pub redis_password: String,
    pub redis_server: String,
    pub wiki_aws_region: String,
}

impl WikifarmEnv {
    pub fn gather() -> anyhow::Result<Self> {
        let req = |k: &str| env::var(k).map_err(|_| anyhow::format_err!("missing env {k}"));
        let opt = |k: &str, d: &str| env::var(k).unwrap_or_else(|_| d.to_string());
        Ok(Self {
            wikifarm_dir: opt("WIKIFARM_DIR", "/srv/wikis"),
            wikifarm_template: opt("WIKIFARM_TEMPLATE", "/template"),
            wikifarm_config_dir: opt("WIKIFARM_CONFIG_DIR", "/config"),
            wikifarm_instance: req("WIKIFARM_INSTANCE")?,
            wiki_host: req("WIKI_HOST")?,
            wiki_db_host: req("WIKI_DB_HOST")?,
            wiki_shared_db_name: req("WIKI_SHARED_DB_NAME")?,
            opensearch_user: req("OPENSEARCH_USER")?,
            opensearch_port: req("OPENSEARCH_PORT")?,
            opensearch_transport: req("OPENSEARCH_TRANSPORT")?,
            opensearch_password: req("OPENSEARCH_PASSWORD")?,
            opensearch_endpoint: req("OPENSEARCH_ENDPOINT")?,
            redis_password: req("REDIS_PASSWORD")?,
            redis_server: req("REDIS_SERVER")?,
            wiki_aws_region: req("WIKI_AWS_REGION")?,
        })
    }
}
