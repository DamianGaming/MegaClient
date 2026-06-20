use std::io;

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Keyring(#[from] keyring::Error),
    #[error("Minecraft launcher error: {0}")]
    Launcher(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<mc_launcher_core::LauncherError> for AppError {
    fn from(value: mc_launcher_core::LauncherError) -> Self {
        Self::Launcher(value.to_string())
    }
}

pub fn message(value: impl Into<String>) -> AppError {
    AppError::Message(value.into())
}
