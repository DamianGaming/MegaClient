use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use futures_util::StreamExt;
use serde::Deserialize;
use sha1::{Digest, Sha1};

use crate::{
    error::{message, AppResult},
    models::{
        InstalledContent, ModrinthProject, ModrinthVersion, ModrinthVersionFile, SearchRequest,
    },
};

const API: &str = "https://api.modrinth.com/v2";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(120);
const PROGRESS_BYTE_STEP: u64 = 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ModrinthDependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Clone)]
pub struct ResolvedModrinthVersion {
    pub version: ModrinthVersion,
    pub file: ModrinthVersionFile,
    pub dependencies: Vec<ModrinthDependency>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize)]
struct SearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    icon_url: Option<String>,
    project_type: String,
    downloads: u64,
    follows: u64,
    categories: Vec<String>,
    versions: Vec<String>,
    display_categories: Option<Vec<String>>,
    date_modified: String,
}

#[derive(Debug, Deserialize)]
struct VersionResponse {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    game_versions: Vec<String>,
    loaders: Vec<String>,
    date_published: String,
    featured: bool,
    files: Vec<VersionFileResponse>,
    #[serde(default)]
    dependencies: Vec<VersionDependencyResponse>,
}

#[derive(Debug, Deserialize)]
struct VersionDependencyResponse {
    project_id: Option<String>,
    version_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Deserialize)]
struct VersionFileResponse {
    hashes: HashMap<String, String>,
    url: String,
    filename: String,
    primary: bool,
    size: u64,
}

pub async fn search(
    http: &reqwest::Client,
    request: &SearchRequest,
) -> AppResult<Vec<ModrinthProject>> {
    let mut facets: Vec<Vec<String>> = vec![vec![format!(
        "project_type:{}",
        request.project_type
    )]];
    if let Some(version) = &request.game_version {
        facets.push(vec![format!("versions:{version}")]);
    }
    if let Some(loader) = &request.loader {
        if loader != "vanilla" {
            facets.push(vec![format!("categories:{loader}")]);
        }
    }
    if let Some(category) = &request.category {
        facets.push(vec![format!("categories:{category}")]);
    }
    let response = http
        .get(format!("{API}/search"))
        .query(&[
            ("query", request.query.clone()),
            ("facets", serde_json::to_string(&facets)?),
            ("offset", request.offset.unwrap_or(0).to_string()),
            ("limit", request.limit.unwrap_or(24).min(100).to_string()),
            ("index", "relevance".into()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json::<SearchResponse>()
        .await?;
    Ok(response
        .hits
        .into_iter()
        .map(|hit| ModrinthProject {
            id: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description,
            author: hit.author,
            icon_url: hit.icon_url,
            project_type: normalize_kind(&hit.project_type),
            downloads: hit.downloads,
            follows: hit.follows,
            loaders: hit
                .display_categories
                .clone()
                .unwrap_or_else(|| hit.categories.clone())
                .into_iter()
                .filter(|category| {
                    ["fabric", "quilt", "forge", "neoforge"].contains(&category.as_str())
                })
                .collect(),
            categories: hit.categories,
            game_versions: hit.versions,
            updated_at: hit.date_modified,
        })
        .collect())
}

pub async fn versions(
    http: &reqwest::Client,
    project_id: &str,
    game_version: Option<&str>,
    loader: Option<&str>,
) -> AppResult<Vec<ModrinthVersion>> {
    let mut request = http.get(format!("{API}/project/{project_id}/version"));
    if let Some(game_version) = game_version {
        request = request.query(&[(
            "game_versions",
            serde_json::to_string(&[game_version])?,
        )]);
    }
    if let Some(loader) = loader.filter(|value| *value != "vanilla") {
        request = request.query(&[("loaders", serde_json::to_string(&[loader])?)]);
    }
    let versions = request
        .send()
        .await?
        .error_for_status()?
        .json::<Vec<VersionResponse>>()
        .await?;
    Ok(versions.into_iter().map(map_version).collect())
}

pub async fn resolve_version(
    http: &reqwest::Client,
    project_id: &str,
    requested: Option<&str>,
    game_version: &str,
    loader: &str,
) -> AppResult<ResolvedModrinthVersion> {
    let value = if let Some(version_id) = requested {
        http.get(format!("{API}/version/{version_id}"))
            .send()
            .await?
            .error_for_status()?
            .json::<VersionResponse>()
            .await?
    } else {
        let mut request = http
            .get(format!("{API}/project/{project_id}/version"))
            .query(&[(
                "game_versions",
                serde_json::to_string(&[game_version])?,
            )]);
        if loader != "vanilla" {
            request = request.query(&[("loaders", serde_json::to_string(&[loader])?)]);
        }
        request
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<VersionResponse>>()
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| {
                message(format!(
                    "No compatible version of {project_id} was found for Minecraft {game_version} / {loader}."
                ))
            })?
    };
    let file = value
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| value.files.first())
        .ok_or_else(|| message("The selected Modrinth version has no downloadable files."))?;
    validate_exact_filename(&file.filename)?;
    let selected = ModrinthVersionFile {
        url: file.url.clone(),
        filename: file.filename.clone(),
        size: file.size,
        hashes: file.hashes.clone(),
    };
    let dependencies = value
        .dependencies
        .iter()
        .map(|dependency| ModrinthDependency {
            project_id: dependency.project_id.clone(),
            version_id: dependency.version_id.clone(),
            dependency_type: dependency.dependency_type.clone(),
        })
        .collect();
    Ok(ResolvedModrinthVersion {
        version: map_version(value),
        file: selected,
        dependencies,
    })
}

/// Downloads a Modrinth file without changing the publisher-provided filename.
///
/// The transfer uses a unique adjacent temporary file, computes SHA-1 while
/// streaming, and throttles progress callbacks so large downloads do not flood
/// the Tauri event loop or React renderer.
pub async fn download_file(
    http: &reqwest::Client,
    file: &ModrinthVersionFile,
    destination: &Path,
    mut progress: impl FnMut(u64, u64),
) -> AppResult<()> {
    validate_exact_filename(&file.filename)?;
    if destination.file_name() != Some(OsStr::new(&file.filename)) {
        return Err(message(format!(
            "Refusing to rename Modrinth file {} while installing it.",
            file.filename
        )));
    }

    let parsed =
        reqwest::Url::parse(&file.url).map_err(|_| message("Download URL is invalid."))?;
    if parsed.scheme() != "https" {
        return Err(message("Content downloads must use HTTPS."));
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    let temporary = destination.with_file_name(format!(
        ".{}.{}.megaclient-part",
        file.filename,
        uuid::Uuid::new_v4()
    ));
    let transfer = async {
        let response = http.get(&file.url).send().await?.error_for_status()?;
        let total = response.content_length().unwrap_or(file.size);
        let mut stream = response.bytes_stream();
        let mut output = tokio::fs::File::create(&temporary).await?;
        let mut received = 0u64;
        let mut digest = Sha1::new();
        let mut last_report = Instant::now();
        let mut last_reported_bytes = 0u64;
        use tokio::io::AsyncWriteExt;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            output.write_all(&chunk).await?;
            digest.update(&chunk);
            received += chunk.len() as u64;

            if last_report.elapsed() >= PROGRESS_INTERVAL
                || received.saturating_sub(last_reported_bytes) >= PROGRESS_BYTE_STEP
                || (total > 0 && received >= total)
            {
                progress(received, total);
                last_report = Instant::now();
                last_reported_bytes = received;
            }
        }
        output.flush().await?;
        drop(output);
        if last_reported_bytes != received {
            progress(received, total);
        }
        Ok::<_, crate::error::AppError>((received, hex::encode(digest.finalize())))
    }
    .await;

    let (_received, actual_sha1) = match transfer {
        Ok(result) => result,
        Err(error) => {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(error);
        }
    };

    if let Some(expected) = file.hashes.get("sha1") {
        if !actual_sha1.eq_ignore_ascii_case(expected) {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(message(format!(
                "Checksum verification failed for {}.",
                file.filename
            )));
        }
    }
    if destination.exists() {
        tokio::fs::remove_file(destination).await?;
    }
    if let Err(error) = tokio::fs::rename(&temporary, destination).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error.into());
    }
    Ok(())
}

/// Returns a destination that preserves the exact Modrinth filename.
pub fn exact_destination_for(instance: &Path, kind: &str, filename: &str) -> AppResult<PathBuf> {
    validate_exact_filename(filename)?;
    Ok(destination_for(instance, kind, filename))
}

pub fn destination_for(instance: &Path, kind: &str, filename: &str) -> PathBuf {
    let folder = match kind {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        _ => "mods",
    };
    instance.join(folder).join(filename)
}

pub fn installed_from(
    version: &ModrinthVersion,
    file: &ModrinthVersionFile,
    kind: &str,
    dependency: bool,
) -> InstalledContent {
    InstalledContent {
        id: uuid::Uuid::new_v4().to_string(),
        project_id: Some(version.project_id.clone()),
        version_id: Some(version.id.clone()),
        name: version.name.clone(),
        file_name: file.filename.clone(),
        kind: kind.into(),
        enabled: true,
        size_bytes: file.size,
        version_number: Some(version.version_number.clone()),
        icon_url: None,
        installed_at: chrono::Utc::now().to_rfc3339(),
        update_available: false,
        dependency,
    }
}

fn validate_exact_filename(filename: &str) -> AppResult<()> {
    if filename.is_empty()
        || filename != filename.trim()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains('\0')
    {
        return Err(message("Modrinth returned an unsafe content filename."));
    }
    let mut components = Path::new(filename).components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err(message("Modrinth returned an unsafe content filename."));
    }
    Ok(())
}

fn map_version(value: VersionResponse) -> ModrinthVersion {
    ModrinthVersion {
        id: value.id,
        project_id: value.project_id,
        name: value.name,
        version_number: value.version_number,
        game_versions: value.game_versions,
        loaders: value.loaders,
        published_at: value.date_published,
        featured: value.featured,
    }
}

fn normalize_kind(value: &str) -> String {
    match value {
        "resourcepack" => "resourcepack",
        "shader" => "shader",
        "modpack" => "modpack",
        _ => "mod",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::validate_exact_filename;

    #[test]
    fn exact_modrinth_filenames_are_preserved() {
        for filename in [
            "fabric-api-0.102.0+1.21.1.jar",
            "YetAnotherConfigLib-3.6.2+1.21-fabric.jar",
            "Mod Name (Fabric) 1.2.3.jar",
        ] {
            assert!(validate_exact_filename(filename).is_ok(), "{filename}");
        }
    }

    #[test]
    fn filename_paths_are_rejected_instead_of_renamed() {
        for filename in ["../mod.jar", "folder/mod.jar", "folder\\mod.jar", " mod.jar"] {
            assert!(validate_exact_filename(filename).is_err(), "{filename}");
        }
    }
}
