use std::{fs, path::Path};

use serde::{de::DeserializeOwned, Serialize};

use crate::error::AppResult;

pub fn read_or_default<T>(path: &Path) -> AppResult<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let bytes = fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}

pub fn read_vec<T>(path: &Path) -> AppResult<Vec<T>>
where
    T: DeserializeOwned,
{
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

pub fn write_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(temporary, path)?;
    Ok(())
}
