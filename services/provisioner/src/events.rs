use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Running,
    Succeeded,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    DirCopy,
    RenderIni,
    DbProvision,
    DockerInstall,
    DockerIndexCfg,
    FlipBootstrap,
    Index,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Event {
    Progress {
        status: Status,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        phase: Option<Phase>,
    },
    Status {
        status: Status,
        #[serde(skip_serializing_if = "Option::is_none")]
        wiki_id: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
}
