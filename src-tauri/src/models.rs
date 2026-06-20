use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub name: String,
    pub avatar_url: String,
    pub active: bool,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    #[serde(flatten)]
    pub summary: AccountSummary,
    pub uuid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LauncherSettings {
    pub game_directory: String,
    pub java_path: String,
    pub min_ram_mb: u32,
    pub max_ram_mb: u32,
    pub width: u32,
    pub height: u32,
    pub minimize_while_playing: bool,
    pub reduced_motion: bool,
    pub compact_navigation: bool,
    pub show_snapshots: bool,
    pub show_console_on_launch: bool,
    pub selected_instance_id: String,
    pub auto_check_updates: bool,
    pub auto_download_updates: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            game_directory: String::new(),
            java_path: String::new(),
            min_ram_mb: 1024,
            max_ram_mb: 4096,
            width: 1280,
            height: 720,
            minimize_while_playing: true,
            reduced_motion: false,
            compact_navigation: false,
            show_snapshots: false,
            show_console_on_launch: true,
            selected_instance_id: String::new(),
            auto_check_updates: true,
            auto_download_updates: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceProfile {
    pub id: String,
    pub name: String,
    pub minecraft_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
    pub directory: String,
    pub icon_url: Option<String>,
    pub last_played_at: Option<String>,
    pub play_time_seconds: u64,
    pub created_at: String,
    pub favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInstanceRequest {
    pub name: String,
    pub minecraft_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    pub id: String,
    pub kind: String,
    pub release_time: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionManifest {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaRuntime {
    pub path: String,
    pub major: u32,
    pub vendor: String,
    pub managed: bool,
    pub recommended: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    pub state: String,
    pub instance_id: Option<String>,
    pub pid: Option<u32>,
    pub started_at: Option<String>,
    pub message: Option<String>,
}

impl Default for GameStatus {
    fn default() -> Self {
        Self { state: "idle".into(), instance_id: None, pid: None, started_at: None, message: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiProgressEvent {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub percent: f64,
    pub bytes_per_second: u64,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleLine {
    pub level: String,
    pub text: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthProject {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon_url: Option<String>,
    pub project_type: String,
    pub downloads: u64,
    pub follows: u64,
    pub categories: Vec<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModrinthVersion {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub published_at: String,
    pub featured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub project_type: String,
    pub game_version: Option<String>,
    pub loader: Option<String>,
    pub category: Option<String>,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledContent {
    pub id: String,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub name: String,
    pub file_name: String,
    pub kind: String,
    pub enabled: bool,
    pub size_bytes: u64,
    pub version_number: Option<String>,
    pub icon_url: Option<String>,
    pub installed_at: String,
    pub update_available: bool,
    #[serde(default)]
    pub dependency: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallContentRequest {
    pub instance_id: String,
    pub project_id: String,
    pub version_id: Option<String>,
    pub kind: String,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinProfile {
    pub id: String,
    pub name: String,
    pub skin_url: Option<String>,
    pub skin_variant: String,
    pub capes: Vec<Cape>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cape {
    pub id: String,
    pub alias: String,
    pub url: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
    pub settings: LauncherSettings,
    pub accounts: Vec<AccountSummary>,
    pub instances: Vec<InstanceProfile>,
    pub versions: VersionManifest,
    pub java_runtimes: Vec<JavaRuntime>,
    pub game_status: GameStatus,
    pub platform: String,
    pub app_version: String,
    pub auth_configured: bool,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartneredServer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub online: bool,
    pub motd: Vec<String>,
    pub icon_url: Option<String>,
    pub players_online: u32,
    pub players_max: u32,
    pub version: Option<String>,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchRequest {
    pub instance_id: String,
    pub server: Option<String>,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentIndex {
    pub items: Vec<InstalledContent>,
}

impl Default for ContentIndex {
    fn default() -> Self { Self { items: Vec::new() } }
}

#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub settings: PathBuf,
    pub accounts: PathBuf,
    pub instances: PathBuf,
    pub managed_java: PathBuf,
    pub auth_vault: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub struct ModrinthVersionFile {
    pub url: String,
    pub filename: String,
    pub size: u64,
    pub hashes: HashMap<String, String>,
}
