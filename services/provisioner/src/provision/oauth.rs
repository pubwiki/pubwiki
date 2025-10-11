use std::fs::{self, Permissions};
use std::path::Path;
use std::os::unix::fs::PermissionsExt;

use rcgen::PKCS_RSA_SHA256;
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

    // For OAuth token signing, a self-signed certificate with default algorithm is sufficient.
    let cert = rcgen::KeyPair::generate_for(&PKCS_RSA_SHA256)?;

    let key_pem = cert.serialize_pem();
    let cert_pem = cert.public_key_pem();

    let key_path = Path::new(dir).join("oauth.key");
    let cert_path = Path::new(dir).join("oauth.cert");
    fs::write(&key_path, &key_pem)?;
    fs::write(&cert_path, &cert_pem)?;

    std::os::unix::fs::chown(&key_path, Some(33), Some(33))?;
    std::os::unix::fs::chown(&cert_path, Some(33), Some(33))?;
    fs::set_permissions(key_path, Permissions::from_mode(0o600))?;
    Ok(())
}

pub fn remove_keys_dir(dir: &str) -> Result<(), OauthError> {
    match std::fs::remove_dir_all(dir) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(OauthError::Io(e)),
    }
}
