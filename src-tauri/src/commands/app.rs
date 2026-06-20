use std::{fs, path::{Path, PathBuf}};

use serde::Deserialize;
use tauri::State;

use crate::{
    error::AppResult,
    models::{AccountRecord, BootstrapPayload, LauncherSettings, VersionEntry, VersionManifest},
    services::{auth, java},
    state::AppState,
    store,
};

#[derive(Debug, Deserialize)]
struct MojangManifest {
    latest: MojangLatest,
    versions: Vec<MojangVersion>,
}
#[derive(Debug, Deserialize)]
struct MojangLatest { release: String, snapshot: String }
#[derive(Debug, Deserialize)]
struct MojangVersion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> AppResult<BootstrapPayload> {
    ensure_layout(&state)?;
    let settings = load_settings(&state)?;
    let auth_configured = auth::resolve_client_id().is_some();
    let mut account_records = load_account_records(&state)?;
    crate::commands::auth::repair_active_account(&state, &mut account_records)?;
    let accounts = account_records.into_iter().map(|item| item.summary).collect();
    let instances = store::read_vec(&state.paths.instances)?;
    // Keep bootstrap local and fast. The renderer refreshes the Mojang manifest after authentication.
    let versions = fallback_manifest();
    let java_runtimes = java::detect(None, &state.paths.managed_java);
    let game_status = state.status.lock().clone();
    Ok(BootstrapPayload {
        settings,
        accounts,
        instances,
        versions,
        java_runtimes,
        game_status,
        platform: std::env::consts::OS.into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        auth_configured,
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<LauncherSettings> { load_settings(&state) }

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, mut settings: LauncherSettings) -> AppResult<LauncherSettings> {
    if settings.game_directory.trim().is_empty() { settings.game_directory = state.paths.root.to_string_lossy().into_owned(); }
    settings.min_ram_mb = settings.min_ram_mb.clamp(512, 65_536);
    settings.max_ram_mb = settings.max_ram_mb.clamp(settings.min_ram_mb, 65_536);
    let data_root = data_root_from_settings(&state, &settings);
    fs::create_dir_all(data_root.join("minecraft"))?;
    fs::create_dir_all(data_root.join("instances"))?;
    store::write_atomic(&state.paths.settings, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub async fn get_version_manifest(state: State<'_, AppState>) -> AppResult<VersionManifest> {
    let manifest = state.http.get("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").send().await?.error_for_status()?.json::<MojangManifest>().await?;
    let installed_root = shared_directory(&state)?.join("versions");
    Ok(VersionManifest {
        latest_release: manifest.latest.release,
        latest_snapshot: manifest.latest.snapshot,
        versions: manifest.versions.into_iter().map(|item| VersionEntry {
            installed: installed_root.join(&item.id).join(format!("{}.json", item.id)).exists(),
            id: item.id,
            kind: item.kind,
            release_time: item.release_time,
        }).collect(),
    })
}

#[tauri::command]
pub fn delete_version(state: State<'_, AppState>, version_id: String) -> AppResult<bool> {
    let safe = version_id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !safe { return Ok(false); }
    let path = shared_directory(&state)?.join("versions").join(version_id);
    if path.exists() { fs::remove_dir_all(path)?; }
    Ok(true)
}


pub fn load_settings(state: &AppState) -> AppResult<LauncherSettings> {
    let mut settings: LauncherSettings = store::read_or_default(&state.paths.settings)?;
    if settings.game_directory.is_empty() { settings.game_directory = state.paths.root.to_string_lossy().into_owned(); }
    Ok(settings)
}

pub fn game_data_root(state: &AppState) -> AppResult<PathBuf> {
    Ok(data_root_from_settings(state, &load_settings(state)?))
}

pub fn shared_directory(state: &AppState) -> AppResult<PathBuf> {
    let path = game_data_root(state)?.join("minecraft");
    fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn instance_root(state: &AppState) -> AppResult<PathBuf> {
    let path = game_data_root(state)?.join("instances");
    fs::create_dir_all(&path)?;
    Ok(path)
}

fn data_root_from_settings(state: &AppState, settings: &LauncherSettings) -> PathBuf {
    let configured = settings.game_directory.trim();
    if configured.is_empty() { state.paths.root.clone() } else { PathBuf::from(configured) }
}

pub fn load_account_records(state: &AppState) -> AppResult<Vec<AccountRecord>> { store::read_vec(&state.paths.accounts) }
pub fn save_account_records(state: &AppState, records: &[AccountRecord]) -> AppResult<()> { store::write_atomic(&state.paths.accounts, records) }

fn ensure_layout(state: &AppState) -> AppResult<()> {
    fs::create_dir_all(&state.paths.root)?;
    fs::create_dir_all(&state.paths.managed_java)?;
    let settings = load_settings(state)?;
    let data_root = data_root_from_settings(state, &settings);
    fs::create_dir_all(data_root.join("minecraft"))?;
    fs::create_dir_all(data_root.join("instances"))?;
    if !state.paths.settings.exists() { store::write_atomic(&state.paths.settings, &load_settings(state)?)?; }
    if !state.paths.accounts.exists() { store::write_atomic::<Vec<AccountRecord>>(&state.paths.accounts, &Vec::new())?; }
    if !state.paths.instances.exists() { store::write_atomic::<Vec<crate::models::InstanceProfile>>(&state.paths.instances, &Vec::new())?; }
    Ok(())
}

fn fallback_manifest() -> VersionManifest {
    VersionManifest { latest_release: "1.21.1".into(), latest_snapshot: String::new(), versions: Vec::new() }
}

pub fn content_index_path(instance: &Path) -> std::path::PathBuf { instance.join(".megaclient").join("content.json") }
