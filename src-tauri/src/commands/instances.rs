use std::{fs, path::PathBuf};

use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::{commands::app::instance_root, error::{message, AppResult}, models::{CreateInstanceRequest, InstanceProfile}, state::AppState, store};

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> AppResult<Vec<InstanceProfile>> { store::read_vec(&state.paths.instances) }

#[tauri::command]
pub fn create_instance(state: State<'_, AppState>, request: CreateInstanceRequest) -> AppResult<InstanceProfile> {
    if request.name.trim().is_empty() { return Err(message("Instance name cannot be empty.")); }
    if !["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&request.loader.as_str()) { return Err(message("Unsupported mod loader.")); }
    let id = format!("{}-{}", slug(&request.name), &Uuid::new_v4().simple().to_string()[..8]);
    let directory = instance_root(&state)?.join(&id);
    for folder in ["mods", "resourcepacks", "shaderpacks", "saves", "logs", ".megaclient"] { fs::create_dir_all(directory.join(folder))?; }
    let instance = InstanceProfile {
        id,
        name: request.name.trim().into(),
        minecraft_version: request.minecraft_version,
        loader: request.loader,
        loader_version: request.loader_version,
        directory: directory.to_string_lossy().into_owned(),
        icon_url: None,
        last_played_at: None,
        play_time_seconds: 0,
        created_at: Utc::now().to_rfc3339(),
        favorite: false,
    };
    let mut instances = list_instances(state.clone())?;
    instances.push(instance.clone());
    store::write_atomic(&state.paths.instances, &instances)?;
    Ok(instance)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: InstanceProfile) -> AppResult<InstanceProfile> {
    let mut instances = list_instances(state.clone())?;
    let target = instances.iter_mut().find(|item| item.id == instance.id).ok_or_else(|| message("Instance not found."))?;
    let original_directory = target.directory.clone();
    *target = instance.clone();
    target.directory = original_directory;
    let saved = target.clone();
    store::write_atomic(&state.paths.instances, &instances)?;
    Ok(saved)
}

#[tauri::command]
pub fn duplicate_instance(state: State<'_, AppState>, instance_id: String) -> AppResult<InstanceProfile> {
    let mut instances = list_instances(state.clone())?;
    let original = instances.iter().find(|item| item.id == instance_id).cloned().ok_or_else(|| message("Instance not found."))?;
    let id = format!("{}-copy-{}", slug(&original.name), &Uuid::new_v4().simple().to_string()[..8]);
    let source = PathBuf::from(&original.directory);
    let destination = instance_root(&state)?.join(&id);
    copy_dir(&source, &destination)?;
    let mut copy = original;
    copy.id = id;
    copy.name = format!("{} Copy", copy.name);
    copy.directory = destination.to_string_lossy().into_owned();
    copy.last_played_at = None;
    copy.play_time_seconds = 0;
    copy.created_at = Utc::now().to_rfc3339();
    copy.favorite = false;
    instances.push(copy.clone());
    store::write_atomic(&state.paths.instances, &instances)?;
    Ok(copy)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, instance_id: String) -> AppResult<bool> {
    let mut instances = list_instances(state.clone())?;
    let Some(index) = instances.iter().position(|item| item.id == instance_id) else { return Ok(false); };
    let removed = instances.remove(index);
    let directory = PathBuf::from(&removed.directory);
    let has_marker = directory.join(".megaclient").is_dir();
    let matches_id = directory.file_name().and_then(|name| name.to_str()) == Some(removed.id.as_str());
    if has_marker && matches_id && directory.exists() { fs::remove_dir_all(directory)?; }
    store::write_atomic(&state.paths.instances, &instances)?;
    Ok(true)
}

pub fn find(state: &AppState, instance_id: &str) -> AppResult<InstanceProfile> {
    store::read_vec::<InstanceProfile>(&state.paths.instances)?.into_iter().find(|item| item.id == instance_id).ok_or_else(|| message("Instance not found."))
}

pub fn persist(state: &AppState, instance: &InstanceProfile) -> AppResult<()> {
    let mut items = store::read_vec::<InstanceProfile>(&state.paths.instances)?;
    if let Some(target) = items.iter_mut().find(|item| item.id == instance.id) { *target = instance.clone(); }
    store::write_atomic(&state.paths.instances, &items)
}

fn slug(value: &str) -> String {
    let slug: String = value.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let cleaned = slug.split('-').filter(|part| !part.is_empty()).collect::<Vec<_>>().join("-").chars().take(40).collect::<String>().trim_matches('-').to_string();
    if cleaned.is_empty() { "instance".into() } else { cleaned }
}

fn copy_dir(source: &std::path::Path, destination: &std::path::Path) -> AppResult<()> {
    fs::create_dir_all(destination)?;
    for entry in walkdir::WalkDir::new(source).follow_links(false).into_iter().filter_map(Result::ok) {
        let relative = entry.path().strip_prefix(source).map_err(|e| message(e.to_string()))?;
        let output = destination.join(relative);
        if entry.file_type().is_dir() { fs::create_dir_all(output)?; }
        else if entry.file_type().is_file() { if let Some(parent) = output.parent() { fs::create_dir_all(parent)?; } fs::copy(entry.path(), output)?; }
    }
    Ok(())
}
