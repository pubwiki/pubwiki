use bollard::Docker;
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecResults};
use futures::StreamExt;
use tracing::{debug, error};

#[derive(thiserror::Error, Debug)]
pub enum DockerError {
    #[error("docker: {0}")]
    Docker(#[from] bollard::errors::Error),
    #[error("docker exec failed: code={code}, stderr={stderr}")]
    ExecFailed {
        code: i64,
        stdout: String,
        stderr: String,
    },
}

pub async fn exec_in_container(
    socket: &str,
    container: &str,
    cmd: Vec<&str>,
    workdir: Option<&str>,
) -> Result<(), DockerError> {
    debug!(socket = socket, container = container, cmd = ?cmd, "docker exec start");
    let docker = if socket.starts_with("unix://") {
        Docker::connect_with_unix(socket, 120, bollard::API_DEFAULT_VERSION)?
    } else {
        Docker::connect_with_local_defaults()?
    };
    let exec = docker
        .create_exec(
            container,
            CreateExecOptions {
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                cmd: Some(cmd.into_iter().map(|s| s.to_string()).collect()),
                working_dir: workdir.map(|s| s.to_string()),
                user: Some("www-data:www-data".to_owned()),
                ..Default::default()
            },
        )
        .await?;

    let mut stream = docker.start_exec(&exec.id, None).await?;
    let mut stdout_buf: Vec<u8> = Vec::new();
    let mut stderr_buf: Vec<u8> = Vec::new();

    match &mut stream {
        StartExecResults::Attached { output, .. } => {
            let s = output;
            while let Some(next) = s.next().await {
                match next {
                    Ok(LogOutput::StdOut { message }) | Ok(LogOutput::Console { message }) => {
                        stdout_buf.extend_from_slice(&message);
                    }
                    Ok(LogOutput::StdErr { message }) => {
                        stderr_buf.extend_from_slice(&message);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        error!(error = %e, "error while reading docker exec output");
                        break;
                    }
                }
            }
        }
        StartExecResults::Detached => {
            // If detached, we can't read output; we'll still inspect exit code below.
        }
    }

    // Inspect to get exit code
    let inspected = docker.inspect_exec(&exec.id).await?;
    if let Some(code) = inspected.exit_code 
        && code != 0 
    {
        let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
        let stderr = String::from_utf8_lossy(&stderr_buf).to_string();
        error!(code = code, %stderr, "docker exec non-zero exit code");
        return Err(DockerError::ExecFailed {
            code,
            stdout,
            stderr,
        });
    }

    Ok(())
}
