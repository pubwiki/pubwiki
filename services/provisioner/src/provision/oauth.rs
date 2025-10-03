use std::fs;
use std::path::Path;
// rcgen provides simple self-signed certificate generation

#[derive(thiserror::Error, Debug)]
pub enum OauthError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rcgen error: {0}")]
    Rcgen(#[from] rcgen::Error),
}

pub fn generate_keypair(dir: &str) -> Result<(), OauthError> {
    std::fs::create_dir_all(dir)?;
    std::os::unix::fs::chown(dir, Some(33), Some(33))?;

    // For OAuth token signing, a self-signed certificate with default algorithm is sufficient.
    let cert = rcgen::generate_simple_self_signed(vec![])?;

    let key_pem = cert.signing_key.serialize_pem();
    let cert_pem = cert.cert.pem();

    fs::write(Path::new(dir).join("oauth.key"), &key_pem)?;
    fs::write(Path::new(dir).join("oauth.cert"), &cert_pem)?;
    Ok(())
}

pub fn remove_keys_dir(dir: &str) -> Result<(), OauthError> {
    match std::fs::remove_dir_all(dir) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(OauthError::Io(e)),
    }
}
