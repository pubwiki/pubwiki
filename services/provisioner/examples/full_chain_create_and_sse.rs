use std::time::Duration;

use futures_util::StreamExt;
use reqwest_eventsource::{Event, EventSource};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .init();

    // Config via env
    let base =
        std::env::var("SERVICE_BASE").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string());
    let name = std::env::var("WIKI_NAME").unwrap_or_else(|_| "Demo".to_string());
    let slug = std::env::var("WIKI_SLUG").unwrap_or_else(|_| {
        format!(
            "demo-{}",
            uuid::Uuid::new_v4().to_string().split('-').next().unwrap()
        )
    });
    let language = std::env::var("WIKI_LANG").unwrap_or_else(|_| "en".to_string());

    println!(
        "Base: {}\nName: {}\nSlug: {}\nLang: {}",
        base, name, slug, language
    );

    // 1) Create wiki
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()?;

    let body = serde_json::json!({
        "name": name,
        "slug": slug,
        "language": language,
        "owner": {"id": 0, "username": "tester"}
    });
    let resp = client
        .post(format!("{}/provisioner/v1/wikis", base))
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        eprintln!("Create failed: {}\n{}", status, txt);
        return Ok(());
    }

    let v: serde_json::Value = resp.json().await?;
    let task_id = v["task_id"].as_str().unwrap().to_string();
    println!("Task ID: {}", task_id);

    // 2) Subscribe SSE
    let sse_url = format!("{}/provisioner/v1/tasks/{}/events", base, task_id);
    println!("Connecting SSE: {}", sse_url);
    let mut es = EventSource::get(&sse_url);

    while let Some(event) = es.next().await {
        match event {
            Ok(Event::Open) => {
                println!("[sse] open");
            }
            Ok(Event::Message(msg)) => {
                println!("[sse] event: {}", msg.event);
                println!("[sse] data: {}", msg.data);
                // Stop on final status
                if msg.event == "status" && msg.data.contains("\"status\":\"succeeded\"")
                    || msg.data.contains("\"status\":\"failed\"")
                {
                    break;
                }
            }
            Err(e) => {
                eprintln!("[sse] error: {}", e);
                break;
            }
        }
    }

    es.close();
    println!("Done.");
    Ok(())
}
