use wikifarm_service::events::{Event, Phase, Status};

#[test]
fn progress_event_serde_roundtrip() {
    let evt = Event::Progress {
        status: Status::Running,
        message: Some("install".to_string()),
        phase: Some(Phase::DockerInstall),
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"type\":\"progress\""));
    assert!(json.contains("\"status\":\"running\""));
    assert!(json.contains("\"message\":\"install\""));
    assert!(json.contains("\"phase\":\"docker_install\""));

    let de: Event = serde_json::from_str(&json).unwrap();
    match de {
        Event::Progress {
            status,
            message,
            phase,
        } => {
            matches!(status, Status::Running);
            assert_eq!(message.as_deref(), Some("install"));
            matches!(phase, Some(Phase::DockerInstall));
        }
        _ => panic!("expected progress"),
    }
}

#[test]
fn status_event_serde_roundtrip() {
    let evt = Event::Status {
        status: Status::Succeeded,
        wiki_id: Some(123),
        message: None,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert!(json.contains("\"type\":\"status\""));
    assert!(json.contains("\"status\":\"succeeded\""));
    assert!(json.contains("\"wiki_id\":123"));

    let de: Event = serde_json::from_str(&json).unwrap();
    match de {
        Event::Status {
            status,
            wiki_id,
            message,
        } => {
            matches!(status, Status::Succeeded);
            assert_eq!(wiki_id, Some(123));
            assert!(message.is_none());
        }
        _ => panic!("expected status"),
    }
}
