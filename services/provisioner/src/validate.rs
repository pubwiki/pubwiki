use std::sync::LazyLock;

use axum::http::StatusCode;
use regex::Regex;

use crate::error::ApiError;

pub static WIKI_SLUG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[0-9a-z-]{3,64}$").unwrap());
pub static WIKI_GROUP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9a-zA-Z-\*\. ]{1,64}$").unwrap());
pub static WIKI_PERM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9a-zA-Z-\*\. ]{1,64}$").unwrap());
pub static WIKI_DIR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[0-9a-zA-Z-_]{1,64}$").unwrap());

pub fn validate(s: &str, ty: &LazyLock<Regex>) -> Result<(), ApiError> {
    if ty.is_match(s) {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "param_invalid",
            format!("parameter {s} is invalid"),
        ))
    }
}
