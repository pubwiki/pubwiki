use std::path::Path;
use tokio::fs;
use tracing::debug;

#[derive(thiserror::Error, Debug)]
pub enum FsError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub async fn symlink_template(template: &str, dest: &str) -> Result<(), FsError> {
    debug!(%template, %dest, "cow_copy_dir (symlink) start");

    let src_path = Path::new(template);
    let dest_path = Path::new(dest);

    if let Err(e) = fs::create_dir(dest_path).await
        && e.kind() != std::io::ErrorKind::AlreadyExists 
    {
        return Err(FsError::Io(e));
    }

    // Pre-create special dirs where we shallow-link their contents
    for special in ["extensions", "skins"] {
        let special_dest = dest_path.join(special);
        if let Err(e) = fs::create_dir(&special_dest).await 
            && e.kind() != std::io::ErrorKind::AlreadyExists
        {
            return Err(FsError::Io(e));
        }
    }

    let mut dir = fs::read_dir(src_path).await?;
    while let Some(entry) = dir.next_entry().await? {
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy();
        let entry_path = entry.path();
        let md = entry.metadata().await?;

        if name == "extensions" || name == "skins" {
            // shallow: each child becomes a symlink inside dest/<special>
            let sub_dest_root = dest_path.join(&*name);
            let mut inner = fs::read_dir(&entry_path).await?;
            while let Some(child) = inner.next_entry().await? {
                let child_path = child.path();
                let link_target = sub_dest_root.join(child.file_name());
                symlink_path(&child_path, &link_target).await?;
            }
            continue;
        }

        if md.is_file() || md.is_dir() {
            let target = dest_path.join(&*name);
            symlink_path(&entry_path, &target).await?;
        } else {
            debug!(path=%entry_path.display(), "skip non-file non-dir entry");
        }
    }

    debug!(%template, %dest, "cow_copy_dir (symlink) done");
    Ok(())
}

async fn symlink_path(src: &Path, dest: &Path) -> Result<(), FsError> {
    #[cfg(not(unix))]
    compile_error!("symlink_path is only intended for unix platforms in this project");

    if let Some(parent) = dest.parent()
        && let Err(e) = fs::create_dir_all(parent).await 
        && e.kind() != std::io::ErrorKind::AlreadyExists 
    {
        return Err(FsError::Io(e));
    }
    match fs::symlink(src, dest).await {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(e) => Err(FsError::Io(e)),
    }
}

pub fn remove_dir_all_if_exists(path: &str) -> Result<(), FsError> {
    debug!(%path, "remove_dir_all_if_exists");
    match std::fs::remove_dir_all(path) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(FsError::Io(e)),
    }
}
