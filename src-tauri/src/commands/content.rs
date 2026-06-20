use std::{
    collections::{HashSet, VecDeque},
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
};

use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    commands::{app::content_index_path, instances},
    error::{message, AppResult},
    models::{
        ContentIndex, InstallContentRequest, InstalledContent, ModrinthProject,
        ModrinthVersion, SearchRequest, UiProgressEvent,
    },
    services::modrinth::{self, ResolvedModrinthVersion},
    state::AppState,
    store,
};

#[tauri::command]
pub async fn search_modrinth(
    state: State<'_, AppState>,
    request: SearchRequest,
) -> AppResult<Vec<ModrinthProject>> {
    modrinth::search(&state.http, &request).await
}

#[tauri::command]
pub async fn get_project_versions(
    state: State<'_, AppState>,
    project_id: String,
    minecraft_version: Option<String>,
    loader: Option<String>,
) -> AppResult<Vec<ModrinthVersion>> {
    modrinth::versions(
        &state.http,
        &project_id,
        minecraft_version.as_deref(),
        loader.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn install_content(
    app: AppHandle,
    state: State<'_, AppState>,
    request: InstallContentRequest,
) -> AppResult<bool> {
    let instance = instances::find(&state, &request.instance_id)?;
    let resolved = modrinth::resolve_version(
        &state.http,
        &request.project_id,
        request.version_id.as_deref(),
        &instance.minecraft_version,
        &instance.loader,
    )
    .await?;
    let task_id = Uuid::new_v4().to_string();
    emit_progress(
        &app,
        &task_id,
        "content",
        &format!("Installing {}", resolved.version.name),
        "Resolving compatible download and dependencies…",
        3.0,
        false,
    );

    if request.kind == "modpack" || resolved.file.filename.ends_with(".mrpack") {
        install_mrpack(
            &app,
            &state,
            &instance,
            &resolved.version,
            &resolved.file,
            &task_id,
        )
        .await?;
    } else if request.kind == "mod" {
        install_mod_graph(&app, &state, &instance, resolved, &task_id).await?;
    } else {
        install_single_content(
            &app,
            &state,
            &instance,
            &resolved,
            &request.kind,
            false,
            &task_id,
            8.0,
            92.0,
        )
        .await?;
    }

    emit_progress(
        &app,
        &task_id,
        "content",
        "Content installed",
        "The selected content and all required dependencies are ready.",
        100.0,
        true,
    );
    Ok(true)
}

async fn install_mod_graph(
    app: &AppHandle,
    state: &AppState,
    instance: &crate::models::InstanceProfile,
    root: ResolvedModrinthVersion,
    task_id: &str,
) -> AppResult<()> {
    let mut queue = VecDeque::new();
    let mut scheduled = HashSet::new();
    scheduled.insert(format!("version:{}", root.version.id));
    scheduled.insert(format!("project:{}", root.version.project_id));
    queue.push_back((root, false));
    let mut completed = 0usize;

    while let Some((resolved, is_dependency)) = queue.pop_front() {
        for dependency in resolved
            .dependencies
            .iter()
            .filter(|dependency| dependency.dependency_type.eq_ignore_ascii_case("required"))
        {
            let version_key = dependency
                .version_id
                .as_ref()
                .map(|value| format!("version:{value}"));
            let project_key = dependency
                .project_id
                .as_ref()
                .map(|value| format!("project:{value}"));
            if version_key.is_none() && project_key.is_none() {
                continue;
            }
            if version_key.as_ref().is_some_and(|key| scheduled.contains(key))
                || project_key.as_ref().is_some_and(|key| scheduled.contains(key))
            {
                continue;
            }
            if let Some(key) = version_key { scheduled.insert(key); }
            if let Some(key) = project_key { scheduled.insert(key); }
            let dependency_version = modrinth::resolve_version(
                &state.http,
                dependency.project_id.as_deref().unwrap_or("dependency"),
                dependency.version_id.as_deref(),
                &instance.minecraft_version,
                &instance.loader,
            )
            .await?;
            scheduled.insert(format!("version:{}", dependency_version.version.id));
            scheduled.insert(format!("project:{}", dependency_version.version.project_id));
            queue.push_back((dependency_version, true));
        }

        let base = (6.0 + completed as f64 * 12.0).min(82.0);
        let span = if is_dependency { 10.0 } else { 20.0 };
        install_single_content(
            app,
            state,
            instance,
            &resolved,
            "mod",
            is_dependency,
            task_id,
            base,
            span,
        )
        .await?;
        completed += 1;
    }

    Ok(())
}

async fn install_single_content(
    app: &AppHandle,
    state: &AppState,
    instance: &crate::models::InstanceProfile,
    resolved: &ResolvedModrinthVersion,
    kind: &str,
    dependency: bool,
    task_id: &str,
    progress_base: f64,
    progress_span: f64,
) -> AppResult<()> {
    let instance_path = Path::new(&instance.directory);
    let index_path = content_index_path(instance_path);
    let mut index: ContentIndex = store::read_or_default(&index_path)?;
    reconcile_content_index(instance_path, &mut index)?;

    let previous = index
        .items
        .iter()
        .find(|item| item.project_id.as_deref() == Some(&resolved.version.project_id))
        .cloned();

    if let Some(previous) = previous.as_ref() {
        let current = content_file(instance_path, previous);
        let disabled = disabled_path(&current);
        if previous.version_id.as_deref() == Some(&resolved.version.id)
            && (current.exists() || disabled.exists())
        {
            if let Some(item) = index.items.iter_mut().find(|item| item.id == previous.id) {
                item.dependency = item.dependency && dependency;
            }
            store::write_atomic(&index_path, &index)?;
            emit_progress(
                app,
                task_id,
                "content",
                if dependency { "Dependency already installed" } else { "Content already installed" },
                &resolved.version.name,
                (progress_base + progress_span).min(96.0),
                false,
            );
            return Ok(());
        }
        remove_path(&current)?;
        remove_path(&disabled)?;
    }

    let destination = modrinth::destination_for(instance_path, kind, &resolved.file.filename);
    let label = resolved.version.name.clone();
    let action = if dependency {
        "Installing required dependency"
    } else {
        "Installing content"
    };
    let app_for_progress = app.clone();
    let id_for_progress = task_id.to_string();
    modrinth::download_file(&state.http, &resolved.file, &destination, move |received, total| {
        let fraction = if total == 0 {
            0.5
        } else {
            received as f64 / total as f64
        };
        emit_progress(
            &app_for_progress,
            &id_for_progress,
            "content",
            action,
            &format!("{label} · {} / {}", human_bytes(received), human_bytes(total)),
            progress_base + fraction * progress_span,
            false,
        );
    })
    .await?;

    let enabled = previous.as_ref().map(|item| item.enabled).unwrap_or(true);
    if !enabled {
        fs::rename(&destination, disabled_path(&destination))?;
    }

    index
        .items
        .retain(|item| item.project_id.as_deref() != Some(&resolved.version.project_id));
    let mut installed = modrinth::installed_from(
        &resolved.version,
        &resolved.file,
        kind,
        dependency,
    );
    installed.enabled = enabled;
    index.items.push(installed);
    store::write_atomic(&index_path, &index)?;
    Ok(())
}

#[tauri::command]
pub async fn list_content(
    state: State<'_, AppState>,
    instance_id: String,
    kind: Option<String>,
) -> AppResult<Vec<InstalledContent>> {
    let instance = instances::find(&state, &instance_id)?;
    let instance_path = Path::new(&instance.directory);
    let index_path = content_index_path(instance_path);
    let mut index: ContentIndex = store::read_or_default(&index_path)?;
    let mut changed = reconcile_content_index(instance_path, &mut index)?;

    let targets = index
        .items
        .iter()
        .enumerate()
        .filter_map(|(item_index, item)| {
            Some((
                item_index,
                item.project_id.clone()?,
                item.version_id.clone()?,
            ))
        })
        .collect::<Vec<_>>();
    let http = state.http.clone();
    let game_version = instance.minecraft_version.clone();
    let loader = instance.loader.clone();
    let checks = stream::iter(targets)
        .map(|(item_index, project_id, current_version)| {
            let http = http.clone();
            let game_version = game_version.clone();
            let loader = loader.clone();
            async move {
                let update_available = modrinth::versions(
                    &http,
                    &project_id,
                    Some(&game_version),
                    Some(&loader),
                )
                .await
                .ok()
                .and_then(|versions| versions.into_iter().next())
                .is_some_and(|latest| latest.id != current_version);
                (item_index, update_available)
            }
        })
        .buffer_unordered(6)
        .collect::<Vec<_>>()
        .await;

    for (item_index, update_available) in checks {
        if let Some(item) = index.items.get_mut(item_index) {
            if item.update_available != update_available {
                item.update_available = update_available;
                changed = true;
            }
        }
    }

    if changed {
        store::write_atomic(&index_path, &index)?;
    }
    let mut items = index.items;
    if let Some(kind) = kind {
        items.retain(|item| item.kind == kind);
    }
    items.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(items)
}

fn reconcile_content_index(instance: &Path, index: &mut ContentIndex) -> AppResult<bool> {
    let before = index.items.len();
    index.items.retain(|item| {
        if item.kind == "modpack" {
            return true;
        }
        let file = content_file(instance, item);
        file.exists() || disabled_path(&file).exists()
    });
    let mut changed = index.items.len() != before;
    for item in &mut index.items {
        if item.kind == "modpack" {
            continue;
        }
        let file = content_file(instance, item);
        let actual_enabled = file.exists() || !disabled_path(&file).exists();
        if item.enabled != actual_enabled {
            item.enabled = actual_enabled;
            changed = true;
        }
    }

    for (kind, folder) in [
        ("mod", "mods"),
        ("resourcepack", "resourcepacks"),
        ("shader", "shaderpacks"),
    ] {
        let directory = instance.join(folder);
        if !directory.exists() {
            continue;
        }
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            if !file_type.is_file() && !file_type.is_dir() {
                continue;
            }
            let raw_name = entry.file_name().to_string_lossy().into_owned();
            if raw_name.ends_with(".download") || raw_name.starts_with('.') {
                continue;
            }
            let (file_name, enabled) = raw_name
                .strip_suffix(".disabled")
                .map(|name| (name.to_string(), false))
                .unwrap_or((raw_name, true));
            if index
                .items
                .iter()
                .any(|item| item.kind == kind && item.file_name == file_name)
            {
                continue;
            }
            let name = Path::new(&file_name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(&file_name)
                .replace('-', " ")
                .replace('_', " ");
            let size_bytes = if file_type.is_file() {
                entry.metadata().map(|metadata| metadata.len()).unwrap_or(0)
            } else {
                0
            };
            index.items.push(InstalledContent {
                id: Uuid::new_v4().to_string(),
                project_id: None,
                version_id: None,
                name,
                file_name,
                kind: kind.into(),
                enabled,
                size_bytes,
                version_number: None,
                icon_url: None,
                installed_at: chrono::Utc::now().to_rfc3339(),
                update_available: false,
                dependency: false,
            });
            changed = true;
        }
    }
    Ok(changed)
}

#[tauri::command]
pub fn toggle_content(
    state: State<'_, AppState>,
    instance_id: String,
    content_id: String,
    enabled: bool,
) -> AppResult<bool> {
    let instance = instances::find(&state, &instance_id)?;
    let index_path = content_index_path(Path::new(&instance.directory));
    let mut index: ContentIndex = store::read_or_default(&index_path)?;
    let item = index
        .items
        .iter_mut()
        .find(|item| item.id == content_id)
        .ok_or_else(|| message("Installed content was not found."))?;
    if item.enabled != enabled {
        let current = content_file(Path::new(&instance.directory), item);
        let disabled = disabled_path(&current);
        if enabled && disabled.exists() {
            fs::rename(disabled, &current)?;
        } else if !enabled && current.exists() {
            fs::rename(&current, disabled)?;
        }
        item.enabled = enabled;
        store::write_atomic(&index_path, &index)?;
    }
    Ok(true)
}

#[tauri::command]
pub fn delete_content(
    state: State<'_, AppState>,
    instance_id: String,
    content_id: String,
) -> AppResult<bool> {
    let instance = instances::find(&state, &instance_id)?;
    let index_path = content_index_path(Path::new(&instance.directory));
    let mut index: ContentIndex = store::read_or_default(&index_path)?;
    let Some(position) = index.items.iter().position(|item| item.id == content_id) else {
        return Ok(false);
    };
    let item = index.items.remove(position);
    let path = content_file(Path::new(&instance.directory), &item);
    remove_path(&path)?;
    remove_path(&disabled_path(&path))?;
    store::write_atomic(&index_path, &index)?;
    Ok(true)
}

#[tauri::command]
pub async fn update_content(
    app: AppHandle,
    state: State<'_, AppState>,
    instance_id: String,
    content_id: String,
) -> AppResult<bool> {
    let instance = instances::find(&state, &instance_id)?;
    let index: ContentIndex =
        store::read_or_default(&content_index_path(Path::new(&instance.directory)))?;
    let item = index
        .items
        .iter()
        .find(|item| item.id == content_id)
        .ok_or_else(|| message("Installed content was not found."))?;
    let project_id = item
        .project_id
        .clone()
        .ok_or_else(|| message("This file is not linked to a Modrinth project."))?;
    install_content(
        app,
        state,
        InstallContentRequest {
            instance_id,
            project_id,
            version_id: None,
            kind: item.kind.clone(),
        },
    )
    .await
}

fn content_file(instance: &Path, item: &InstalledContent) -> PathBuf {
    modrinth::destination_for(instance, &item.kind, &item.file_name)
}

fn disabled_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.disabled", path.to_string_lossy()))
}

fn remove_path(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct MrpackIndex {
    files: Vec<MrpackFile>,
}
#[derive(Debug, Deserialize)]
struct MrpackFile {
    path: String,
    hashes: std::collections::HashMap<String, String>,
    downloads: Vec<String>,
    #[serde(default)]
    file_size: u64,
    env: Option<MrpackEnvironment>,
}
#[derive(Debug, Deserialize)]
struct MrpackEnvironment {
    client: Option<String>,
}

async fn install_mrpack(
    app: &AppHandle,
    state: &AppState,
    instance: &crate::models::InstanceProfile,
    version: &ModrinthVersion,
    file: &crate::models::ModrinthVersionFile,
    task_id: &str,
) -> AppResult<()> {
    let temporary = state.paths.root.join("cache").join(&file.filename);
    let app_progress = app.clone();
    let id_progress = task_id.to_string();
    modrinth::download_file(&state.http, file, &temporary, move |received, total| {
        emit_progress(
            &app_progress,
            &id_progress,
            "content",
            "Downloading modpack",
            &format!("{} / {}", human_bytes(received), human_bytes(total)),
            4.0 + received as f64 / total.max(1) as f64 * 24.0,
            false,
        );
    })
    .await?;
    let bytes = fs::read(&temporary)?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|error| message(error.to_string()))?;
    let mut index_text = String::new();
    archive
        .by_name("modrinth.index.json")
        .map_err(|_| message("This archive does not contain a valid modrinth.index.json."))?
        .read_to_string(&mut index_text)?;
    let index: MrpackIndex = serde_json::from_str(&index_text)?;
    let instance_path = Path::new(&instance.directory);
    extract_overrides(&mut archive, instance_path, "overrides/")?;
    extract_overrides(&mut archive, instance_path, "client-overrides/")?;
    let total_files = index.files.len().max(1);
    for (position, mr_file) in index.files.into_iter().enumerate() {
        if mr_file
            .env
            .as_ref()
            .and_then(|env| env.client.as_deref())
            == Some("unsupported")
        {
            continue;
        }
        let relative = safe_relative(Path::new(&mr_file.path))?;
        let destination = instance_path.join(relative);
        let url = mr_file
            .downloads
            .first()
            .ok_or_else(|| message(format!("No download URL for {}", mr_file.path)))?
            .clone();
        let file_meta = crate::models::ModrinthVersionFile {
            url,
            filename: destination
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            size: mr_file.file_size,
            hashes: mr_file.hashes,
        };
        modrinth::download_file(&state.http, &file_meta, &destination, |_received, _total| {})
            .await?;
        let percent = 30.0 + ((position + 1) as f64 / total_files as f64 * 64.0);
        emit_progress(
            app,
            task_id,
            "content",
            "Installing modpack files",
            &format!("{} of {}", position + 1, total_files),
            percent,
            false,
        );
    }
    let mut content_index: ContentIndex =
        store::read_or_default(&content_index_path(instance_path))?;
    content_index
        .items
        .push(modrinth::installed_from(version, file, "modpack", false));
    store::write_atomic(&content_index_path(instance_path), &content_index)?;
    let _ = fs::remove_file(temporary);
    Ok(())
}

fn extract_overrides(
    archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>,
    destination: &Path,
    prefix: &str,
) -> AppResult<()> {
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| message(error.to_string()))?;
        let name = entry.name().to_string();
        let Some(relative_name) = name.strip_prefix(prefix) else {
            continue;
        };
        if relative_name.is_empty() {
            continue;
        }
        let relative = safe_relative(Path::new(relative_name))?;
        let output = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(output)?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut file = fs::File::create(output)?;
            std::io::copy(&mut entry, &mut file)?;
        }
    }
    Ok(())
}

fn safe_relative(path: &Path) -> AppResult<PathBuf> {
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(message("Archive contains an unsafe path."));
    }
    if path.components().next().is_some_and(|component| {
        component
            .as_os_str()
            .eq_ignore_ascii_case(".megaclient")
    }) {
        return Err(message(
            "Archive attempted to overwrite MegaClient metadata.",
        ));
    }
    Ok(path.to_path_buf())
}

fn emit_progress(
    app: &AppHandle,
    id: &str,
    kind: &str,
    label: &str,
    detail: &str,
    percent: f64,
    done: bool,
) {
    let _ = app.emit(
        "launcher://progress",
        UiProgressEvent {
            id: id.into(),
            kind: kind.into(),
            label: label.into(),
            detail: detail.into(),
            percent: percent.clamp(0.0, 100.0),
            bytes_per_second: 0,
            done,
        },
    );
}

fn human_bytes(value: u64) -> String {
    if value >= 1_073_741_824 {
        format!("{:.1} GB", value as f64 / 1_073_741_824.0)
    } else if value >= 1_048_576 {
        format!("{:.1} MB", value as f64 / 1_048_576.0)
    } else if value >= 1024 {
        format!("{:.1} KB", value as f64 / 1024.0)
    } else {
        format!("{value} B")
    }
}
