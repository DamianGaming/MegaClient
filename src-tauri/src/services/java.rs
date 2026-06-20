use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
};

use flate2::read::GzDecoder;
use serde::Deserialize;
use walkdir::WalkDir;

use crate::{
    error::{message, AppResult},
    models::JavaRuntime,
};

const MOJANG_VERSION_MANIFEST: &str =
    "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Deserialize)]
struct MojangVersionManifest {
    versions: Vec<MojangVersionReference>,
}

#[derive(Debug, Deserialize)]
struct MojangVersionReference {
    id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct MojangVersionMetadata {
    #[serde(rename = "javaVersion")]
    java_version: Option<MojangJavaVersion>,
}

#[derive(Debug, Deserialize)]
struct MojangJavaVersion {
    #[serde(rename = "majorVersion")]
    major_version: u32,
}

pub fn recommended_java_major(version: Option<&str>) -> u32 {
    let Some(version) = version else {
        return 21;
    };
    let mut parts = version
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(1);
    let minor = parts.next().unwrap_or(21);
    let patch = parts.next().unwrap_or(0);
    if major != 1 {
        return 21;
    }
    if minor <= 16 {
        8
    } else if minor < 20 {
        17
    } else if minor == 20 && patch <= 4 {
        17
    } else {
        21
    }
}

/// Resolves the runtime declared by Mojang for the exact version. This is
/// especially important for snapshots: their names do not follow the 1.x
/// release format and newer snapshots can raise the Java requirement before a
/// normal release does.
pub async fn required_java_major(http: &reqwest::Client, version: &str) -> u32 {
    let resolved = async {
        let manifest = http
            .get(MOJANG_VERSION_MANIFEST)
            .send()
            .await?
            .error_for_status()?
            .json::<MojangVersionManifest>()
            .await?;
        let version_url = manifest
            .versions
            .into_iter()
            .find(|item| item.id == version)
            .map(|item| item.url)
            .ok_or_else(|| message(format!("Minecraft version metadata was not found for {version}.")))?;
        let metadata = http
            .get(version_url)
            .send()
            .await?
            .error_for_status()?
            .json::<MojangVersionMetadata>()
            .await?;
        Ok::<Option<u32>, crate::error::AppError>(
            metadata.java_version.map(|java| java.major_version),
        )
    }
    .await;

    resolved
        .ok()
        .flatten()
        .filter(|major| *major >= 8)
        .unwrap_or_else(|| recommended_java_major(Some(version)))
}

pub fn prepend_to_path(java_executable: &Path) {
    let Some(bin) = java_executable.parent() else {
        return;
    };
    let current = std::env::var_os("PATH").unwrap_or_default();
    let mut paths: Vec<PathBuf> = std::env::split_paths(&current).collect();
    if paths.iter().any(|path| path == bin) {
        return;
    }
    paths.insert(0, bin.to_path_buf());
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

pub fn detect(version: Option<&str>, managed_root: &Path) -> Vec<JavaRuntime> {
    let recommended = recommended_java_major(version);
    detect_for_major(managed_root, recommended)
}

pub fn detect_for_major(managed_root: &Path, recommended: u32) -> Vec<JavaRuntime> {
    let mut candidates = Vec::<(PathBuf, bool)>::new();
    if let Ok(path) = which::which("java") {
        candidates.push((path, false));
    }
    for env_name in ["JAVA_HOME", "JDK_HOME"] {
        if let Ok(home) = std::env::var(env_name) {
            candidates.push((PathBuf::from(home).join("bin").join(java_name()), false));
        }
    }

    add_standard_install_candidates(&mut candidates);
    add_java_candidates(managed_root, true, &mut candidates);

    candidates.sort();
    candidates.dedup_by(|a, b| a.0 == b.0);
    candidates
        .into_iter()
        .filter_map(|(path, managed)| inspect(&path, managed, recommended))
        .collect()
}

pub fn select_runtime(
    configured: &str,
    managed_root: &Path,
    required_major: u32,
) -> Option<JavaRuntime> {
    let configured = configured.trim();
    if !configured.is_empty() {
        if let Some(runtime) = inspect(Path::new(configured), false, required_major) {
            if runtime.major == required_major {
                return Some(runtime);
            }
        }
    }

    detect_for_major(managed_root, required_major)
        .into_iter()
        .find(|runtime| runtime.major == required_major)
}

pub async fn ensure(
    http: &reqwest::Client,
    configured: &str,
    managed_root: &Path,
    required_major: u32,
) -> AppResult<JavaRuntime> {
    if let Some(runtime) = select_runtime(configured, managed_root, required_major) {
        return Ok(runtime);
    }
    install(http, required_major, managed_root).await
}

fn add_java_candidates(root: &Path, managed: bool, candidates: &mut Vec<(PathBuf, bool)>) {
    if !root.exists() {
        return;
    }
    for entry in WalkDir::new(root)
        .max_depth(7)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(java_name())
        {
            candidates.push((entry.path().to_path_buf(), managed));
        }
    }
}

fn add_standard_install_candidates(candidates: &mut Vec<(PathBuf, bool)>) {
    #[cfg(target_os = "windows")]
    {
        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            let Ok(root) = std::env::var(variable) else {
                continue;
            };
            let root = PathBuf::from(root);
            for relative in [
                "Eclipse Adoptium",
                "Java",
                "Microsoft",
                "Programs/Eclipse Adoptium",
                "Programs/Java",
            ] {
                add_java_candidates(&root.join(relative), false, candidates);
            }
        }
    }

    #[cfg(target_os = "macos")]
    add_java_candidates(
        Path::new("/Library/Java/JavaVirtualMachines"),
        false,
        candidates,
    );

    #[cfg(target_os = "linux")]
    {
        add_java_candidates(Path::new("/usr/lib/jvm"), false, candidates);
        add_java_candidates(Path::new("/opt/java"), false, candidates);
    }
}

fn inspect(path: &Path, managed: bool, recommended: u32) -> Option<JavaRuntime> {
    if !path.exists() {
        return None;
    }
    let output = Command::new(path).arg("-version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stderr).to_string()
        + &String::from_utf8_lossy(&output.stdout);
    let version = text.split('"').nth(1)?;
    let major = if version.starts_with("1.") {
        version.split('.').nth(1)?.parse().ok()?
    } else {
        version.split('.').next()?.parse().ok()?
    };
    let lower = text.to_lowercase();
    let vendor = if lower.contains("temurin") {
        "Eclipse Temurin"
    } else if lower.contains("microsoft") {
        "Microsoft OpenJDK"
    } else if lower.contains("openjdk") {
        "OpenJDK"
    } else {
        "Java"
    };
    Some(JavaRuntime {
        path: path.to_string_lossy().into_owned(),
        major,
        vendor: vendor.into(),
        managed,
        recommended: major == recommended,
    })
}

pub async fn install(
    http: &reqwest::Client,
    major: u32,
    root: &Path,
) -> AppResult<JavaRuntime> {
    if let Some(runtime) = detect_for_major(root, major)
        .into_iter()
        .find(|item| item.major == major && item.managed)
    {
        return Ok(runtime);
    }

    let os = match std::env::consts::OS {
        "macos" => "mac",
        other => other,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        "x86" => "x32",
        other => other,
    };
    let archive = if cfg!(target_os = "windows") {
        "zip"
    } else {
        "tar.gz"
    };
    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{major}/ga/{os}/{arch}/jre/hotspot/normal/eclipse"
    );
    let bytes = http
        .get(url)
        .header("Accept", "application/octet-stream")
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    let destination = root.join(format!("java-{major}"));
    let temporary = root.join(format!("java-{major}.installing"));
    if temporary.exists() {
        fs::remove_dir_all(&temporary)?;
    }
    fs::create_dir_all(&temporary)?;
    if archive == "zip" {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
            .map_err(|error| message(error.to_string()))?;
        zip.extract(&temporary)
            .map_err(|error| message(error.to_string()))?;
    } else {
        let decoder = GzDecoder::new(Cursor::new(bytes));
        let mut archive = tar::Archive::new(decoder);
        archive.unpack(&temporary)?;
    }
    if destination.exists() {
        fs::remove_dir_all(&destination)?;
    }
    fs::rename(&temporary, &destination)?;

    let runtime = detect_for_major(root, major)
        .into_iter()
        .find(|item| item.major == major && item.managed)
        .ok_or_else(|| {
            message(format!(
                "Java {major} was downloaded, but the executable could not be located."
            ))
        })?;
    Ok(runtime)
}

fn java_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_runtime_fallbacks_are_stable() {
        assert_eq!(recommended_java_major(Some("1.16.5")), 8);
        assert_eq!(recommended_java_major(Some("1.18.2")), 17);
        assert_eq!(recommended_java_major(Some("1.20.4")), 17);
        assert_eq!(recommended_java_major(Some("1.21.1")), 21);
    }

    #[test]
    fn snapshot_names_use_safe_fallback_until_metadata_is_loaded() {
        assert_eq!(recommended_java_major(Some("26w10a")), 21);
    }
}
