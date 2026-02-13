#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use anyhow::Context;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::{
  collections::HashMap,
  fs,
  io::{self, Write},
  path::{Path, PathBuf},
  sync::Mutex,
};

use discord_rich_presence::DiscordIpc;
use tauri::Manager;
use tauri::{WindowUrl};
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, BufReader};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

// Note: MegaClient launches Minecraft directly (no external wrappers).


fn now_epoch() -> i64 {
  chrono::Utc::now().timestamp()
}

fn sha1_file(path: &Path) -> anyhow::Result<String> {
  use sha1::{Digest, Sha1};
  let bytes = fs::read(path)?;
  let mut hasher = Sha1::new();
  hasher.update(&bytes);
  Ok(hex::encode(hasher.finalize()))
}


static LAUNCH_LOG_PATH: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));

// Keep Discord RPC alive for the whole launcher lifetime (and shut it down on exit).
static RPC_CLIENT: Lazy<Mutex<Option<discord_rich_presence::DiscordIpcClient>>> =
  Lazy::new(|| Mutex::new(None));

fn set_log_path(path: PathBuf) {
  *LAUNCH_LOG_PATH.lock().unwrap() = Some(path);
}

fn append_log(line: &str) {
  let path_opt = LAUNCH_LOG_PATH.lock().unwrap().clone();
  let Some(path) = path_opt else { return; };

  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }

  let ts = chrono::Utc::now().to_rfc3339();
  let msg = format!("[{}] {}
", ts, line);

  if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
    let _ = f.write_all(msg.as_bytes());
  }
}



/// Completes the Microsoft → Xbox Live → XSTS → Minecraft auth chain and returns the Minecraft profile.
/// Returns the profile, a Minecraft access token, and the token lifetime in seconds.
async fn microsoft_token_to_minecraft_profile(ms_access_token: String) -> Result<(McProfile, String, i64), String> {
  let client = reqwest::Client::new();

  // 1) Xbox Live user token
  let xbl_resp: XblResponse = client
    .post("https://user.auth.xboxlive.com/user/authenticate")
    .json(&serde_json::json!({
      "Properties": {
        "AuthMethod": "RPS",
        "SiteName": "user.auth.xboxlive.com",
        "RpsTicket": format!("d={}", ms_access_token)
      },
      "RelyingParty": "http://auth.xboxlive.com",
      "TokenType": "JWT"
    }))
    .send()
    .await
    .map_err(|e| format!("Xbox Live auth request failed: {e}"))?
    .error_for_status()
    .map_err(|e| format!("Xbox Live auth returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse Xbox Live auth response: {e}"))?;

  // 2) XSTS token (Minecraft relying party)
  let xsts_resp: XblResponse = client
    .post("https://xsts.auth.xboxlive.com/xsts/authorize")
    .json(&serde_json::json!({
      "Properties": {
        "SandboxId": "RETAIL",
        "UserTokens": [xbl_resp.token]
      },
      "RelyingParty": "rp://api.minecraftservices.com/",
      "TokenType": "JWT"
    }))
    .send()
    .await
    .map_err(|e| format!("XSTS auth request failed: {e}"))?
    .error_for_status()
    .map_err(|e| format!("XSTS auth returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse XSTS auth response: {e}"))?;

  let uhs = xsts_resp
    .display_claims
    .xui
    .get(0)
    .map(|x| x.uhs.clone())
    .ok_or_else(|| "XSTS response missing user hash (uhs)".to_string())?;

  // 3) Minecraft access token
  let resp = client
    .post("https://api.minecraftservices.com/authentication/login_with_xbox")
    .json(&serde_json::json!({
      "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_resp.token)
    }))
    .send()
    .await
    .map_err(|e| format!("Minecraft login request failed: {e}"))?;

  let status = resp.status();
  let body = resp.text().await.unwrap_or_default();

  if !status.is_success() {
    let lower = body.to_lowercase();
    if status.as_u16() == 403 && lower.contains("invalid app registration") {
      return Err(
        "Minecraft login returned error (403 Forbidden): Invalid app registration.

MegaClient is configured to use the official Minecraft Launcher OAuth client id by default (src-tauri/ms_client_id.txt = AUTO). If you forced a custom client id, remove it (or only use FORCE_CUSTOM:<id> once your app is approved by Mojang), then try again."
          .to_string(),
      );
    }
    return Err(format!("Minecraft login returned error ({}): {}", status, body));
  }

  let mc_login: McLoginResponse =
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse Minecraft login response: {e}"))?;

  let mc_access_token = mc_login.access_token.clone();

  // 4) Entitlements (ensure the account owns Minecraft)
  let entitlements: McEntitlements = client
    .get("https://api.minecraftservices.com/entitlements/mcstore")
    .bearer_auth(&mc_access_token)
    .send()
    .await
    .map_err(|e| format!("Minecraft entitlements request failed: {e}"))?
    .error_for_status()
    .map_err(|e| format!("Minecraft entitlements returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse Minecraft entitlements response: {e}"))?;

  if entitlements.items.is_empty() {
    return Err("This Microsoft account does not appear to own Minecraft (no entitlements found).".to_string());
  }

  // 5) Profile (username + uuid)
  let profile: McProfile = client
    .get("https://api.minecraftservices.com/minecraft/profile")
    .bearer_auth(&mc_access_token)
    .send()
    .await
    .map_err(|e| format!("Minecraft profile request failed: {e}"))?
    .error_for_status()
    .map_err(|e| format!("Minecraft profile returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse Minecraft profile response: {e}"))?;

  Ok((profile, mc_access_token, mc_login.expires_in))
}


static STATE: Lazy<Mutex<AppState>> = Lazy::new(|| {
  let st = AppState::load().unwrap_or_else(|_| {
    AppState::default()
  });
  Mutex::new(st)
});
// Ephemeral OAuth state for the current login attempt (not persisted to disk).
static PENDING_MS_OAUTH_STATE: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

const DISCORD_APP_ID: &str = "1462409498483359764";

static CHEAT_PATTERNS: &[&str] = &[
  // Keep this list tight; avoid generic words that appear in legitimate mods.
  "liquidbounce","meteorclient","wurst","aristois","sigma","inertia",
  "salhack","kami","bleachhack","earthhack","phobos","rusherhack","novoline","astolfo","vape","riseclient",
];

fn selected_instance(st: &AppState) -> Option<Instance> {
  let sel_id = st.selected_instance_id.as_deref();
  if let Some(id) = sel_id {
    if let Some(i) = st.instances.iter().find(|x| x.id == id) {
      return Some(i.clone());
    }
  }
  st.instances.first().cloned()
}

fn current_instance_and_dir() -> anyhow::Result<(Instance, PathBuf)> {
  let (inst, base_game) = {
    let mut st = STATE.lock().unwrap();

    // If selected_instance_id points to a missing instance, clear it.
    if let Some(sel) = st.selected_instance_id.clone() {
      if !st.instances.iter().any(|i| i.id == sel) {
        st.selected_instance_id = None;
      }
    }

    // Do NOT auto-create instances. If none selected but instances exist, select first.
    if st.selected_instance_id.is_none() && !st.instances.is_empty() {
      st.selected_instance_id = st.instances.first().map(|i| i.id.clone());
    }

    let inst = selected_instance(&st).ok_or_else(|| anyhow::anyhow!("No instance selected. Create an instance first."))?;
    let _ = st.save(); // best-effort
    (inst, AppState::base_game_dir()?)
  };

  let dir = AppState::instance_dir(&base_game, &inst.id);

  // Ensure per-instance folders exist.
  fs::create_dir_all(&dir).ok();
  fs::create_dir_all(dir.join("launcher_logs")).ok();

  // Only create a mods folder for modded loaders. Vanilla shouldn't have one by default.
  let loader = normalize_loader(inst.loader.as_str());
  if loader != "vanilla" {
    fs::create_dir_all(dir.join("mods")).ok();
  }

  Ok((inst, dir))
}

fn current_game_dir() -> anyhow::Result<PathBuf> {
  Ok(current_instance_and_dir()?.1)
}

#[allow(dead_code)]
fn current_loader() -> String {
  let st = STATE.lock().unwrap();
  selected_instance(&st)
    .as_ref()
    .map(|i| normalize_loader(i.loader.as_str()).to_string())
    .unwrap_or_else(|| "vanilla".to_string())
}

#[allow(dead_code)]
fn current_mc_version() -> String {
  let st = STATE.lock().unwrap();
  selected_instance(&st)
    .as_ref()
    .and_then(|i| i.mc_version.clone())
    .unwrap_or_else(|| "latest".to_string())
}


#[derive(Serialize, Deserialize, Clone)]
#[allow(dead_code)] // some fields are persisted / forwarded to the frontend only
struct MsTokenResponse {
  token_type: String,
  expires_in: i64,
  scope: Option<String>,
  access_token: String,
  refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct MsTokenError {
  error: Option<String>,
  error_description: Option<String>,
}

#[derive(Deserialize)]
struct XblResponse {
  #[serde(rename="Token")]
  token: String,
  #[serde(rename="DisplayClaims")]
  display_claims: XuiClaims,
}


#[derive(Deserialize)]
struct XuiClaims { xui: Vec<Xui> }

#[derive(Deserialize)]
struct Xui { uhs: String }

#[derive(Deserialize)]
#[allow(dead_code)]
struct McLoginResponse {
  access_token: String,
  expires_in: i64,
  token_type: String,
}

#[derive(Deserialize, Serialize, Clone)]
struct McProfile {
  id: String,
  name: String,
}

#[derive(Deserialize)]
struct McEntitlements {
  items: Vec<serde_json::Value>,
}


fn ms_client_id() -> Result<String, String> {
  // Minecraft Services only accepts a small set of OAuth client IDs. New/custom Azure app IDs
  // commonly fail with "Invalid app registration" at login_with_xbox unless Mojang approves them.
  // By default we use the official Minecraft Launcher client id, which works for consumer accounts.
  const OFFICIAL_CLIENT_ID: &str = "00000000402b5328";

  // Optional override via src-tauri/ms_client_id.txt:
  // - "AUTO" / blank / placeholder -> use official
  // - "FORCE_CUSTOM:<id>" -> use the custom id (may require Mojang review to work)
  let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("ms_client_id.txt");
  let raw = fs::read_to_string(&p).unwrap_or_default();
  let v = raw.trim();

  if v.is_empty() || v.eq_ignore_ascii_case("AUTO") || v.contains("PUT_YOUR_AZURE_APP_CLIENT_ID_HERE") {
    return Ok(OFFICIAL_CLIENT_ID.to_string());
  }
  if let Some(rest) = v.strip_prefix("FORCE_CUSTOM:") {
    let id = rest.trim();
    if !id.is_empty() { return Ok(id.to_string()); }
  }

  // Default: prefer the official id to avoid Minecraft 403 Invalid app registration.
  Ok(OFFICIAL_CLIENT_ID.to_string())
}

#[derive(Serialize, Deserialize, Clone)]
struct Instance {
  id: String,
  name: String,
  mc_version: Option<String>,
  loader: String,
  created_at: Option<String>,
}

#[derive(Default, Serialize, Deserialize, Clone)]
struct AppState {
  // Instances
  #[serde(default)]
  instances: Vec<Instance>,
  selected_instance_id: Option<String>,

  // Legacy (kept for backward compatibility)
  selected_version: Option<String>,
  selected_loader: Option<String>,

  // Misc
  join_server: Option<String>,
  auto_update: Option<bool>,

  // Microsoft / Minecraft auth
  ms_refresh_token: Option<String>,
  mc_access_token: Option<String>,
  mc_expires_at: Option<i64>,
  mc_uuid: Option<String>,
  mc_username: Option<String>,
}

impl AppState
 {
  fn base_dir() -> anyhow::Result<PathBuf> {
    let base = dirs::data_local_dir().context("no local data dir")?.join("MegaClient");
    fs::create_dir_all(&base).ok();
    Ok(base)
  }

  fn path() -> anyhow::Result<PathBuf> {
    Ok(Self::base_dir()?.join("state.json"))
  }

  
fn load() -> anyhow::Result<Self> {
  let p = Self::path()?;
  if !p.exists() { 
    return Ok(Self::default());
  }
  let st: Self = serde_json::from_slice(&fs::read(p)?)?;
  Ok(st)
}

  fn save(&self) -> anyhow::Result<()> {
    let p = Self::path()?;
    fs::write(p, serde_json::to_vec_pretty(self)?)?;
    Ok(())
  }


fn instance_dir(base_game_dir: &Path, instance_id: &str) -> PathBuf {
  base_game_dir.join("instances").join(instance_id)
}

fn base_game_dir() -> anyhow::Result<PathBuf> {
  Ok(Self::base_dir()?.join("game"))
}

  #[allow(dead_code)]
  fn game_dir() -> anyhow::Result<PathBuf> { Self::base_game_dir() }
}

#[derive(Serialize, Deserialize, Clone)]
struct McVersion {
  id: String,
  #[serde(rename="type")]
  vtype: String,
  #[serde(rename="releaseTime")]
  release_time: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct NewsItem {
  title: String,
  summary: String,
  url: String,
  date: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct LatestRef { release: String, snapshot: String }

#[derive(Deserialize)]
struct Manifest { latest: LatestRef, versions: Vec<ManifestVersion> }

#[derive(Deserialize)]
struct ManifestVersion {
  id: String,
  #[serde(rename="type")]
  vtype: String,
  #[serde(rename="releaseTime")]
  release_time: String,
  url: String,
}

async fn fetch_manifest() -> Result<Manifest, String> {
  let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
  reqwest::Client::new()
    .get(manifest_url)
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json::<Manifest>()
    .await
    .map_err(|e| e.to_string())
}

/// Resolves "latest" to the current latest release version id.
/// If the input is already a valid version id, returns it as-is.
async fn resolve_mc_version_id(input: &str) -> Result<String, String> {
  let v = input.trim();
  if v.is_empty() || v.eq_ignore_ascii_case("latest") {
    let manifest = fetch_manifest().await?;
    return Ok(manifest.latest.release);
  }
  Ok(v.to_string())
}

#[derive(Deserialize)]
struct FabricMetaVersion {
  version: String,
  stable: bool,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct FabricLoaderEntry {
  loader: FabricMetaVersion,
  intermediary: FabricMetaVersion,
}

#[derive(Deserialize)]
struct FabricInstallerEntry {
  version: String,
  stable: bool,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct FabricProfileJson {
  id: String,
  #[serde(rename="inheritsFrom")]
  inherits_from: Option<String>,
  #[serde(rename="mainClass")]
  main_class: String,
  #[serde(rename="type")]
  vtype: Option<String>,
  #[serde(rename="minecraftArguments")]
  minecraft_arguments: Option<String>,
  arguments: Option<ArgsModern>,
  libraries: Vec<Library>,
}

async fn ensure_fabric_profile(mc_version: &str, versions_dir: &Path) -> Result<(String, FabricProfileJson), String> {
  let http = http_client().map_err(|e| format!("Failed to build HTTP client: {e}"))?;
  let mc_version = mc_version.trim();

  // 1) Loaders compatible with this Minecraft version
  let loader_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
  let loader_resp = http
    .get(&loader_url)
    .send()
    .await
    .map_err(|e| format!("Fabric meta request failed: {e}"))?;

  if loader_resp.status() == reqwest::StatusCode::NOT_FOUND {
    return Err(format!(
      "Fabric does not currently provide a loader for Minecraft {} (not found on Fabric meta).",
      mc_version
    ));
  }

  let loaders: Vec<FabricLoaderEntry> = loader_resp
    .error_for_status()
    .map_err(|e| format!("Fabric meta returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse Fabric loader list: {e}"))?;

  if loaders.is_empty() {
    return Err(format!(
      "Fabric did not return any compatible loaders for Minecraft {}.",
      mc_version
    ));
  }

  // Keep meta order (usually newest first), but prefer stable entries first.
  let mut loader_candidates: Vec<String> = Vec::new();
  for e in loaders.iter().filter(|e| e.loader.stable) {
    if !loader_candidates.contains(&e.loader.version) {
      loader_candidates.push(e.loader.version.clone());
    }
  }
  for e in loaders.iter().filter(|e| !e.loader.stable) {
    if !loader_candidates.contains(&e.loader.version) {
      loader_candidates.push(e.loader.version.clone());
    }
  }
  // Cap to avoid excessive network calls.
  if loader_candidates.len() > 12 {
    loader_candidates.truncate(12);
  }

  // 2) Fabric installer builds (newest first; prefer stable)
  let installer_resp = http
    .get("https://meta.fabricmc.net/v2/versions/installer")
    .send()
    .await
    .map_err(|e| format!("Fabric installer list request failed: {e}"))?;

  let installers: Vec<FabricInstallerEntry> = installer_resp
    .error_for_status()
    .map_err(|e| format!("Fabric installer list returned error: {e}"))?
    .json()
    .await
    .map_err(|e| format!("Failed to parse Fabric installer list: {e}"))?;

  if installers.is_empty() {
    return Err("No Fabric installer builds available.".to_string());
  }

  let mut installer_candidates: Vec<String> = Vec::new();
  for e in installers.iter().filter(|e| e.stable) {
    if !installer_candidates.contains(&e.version) {
      installer_candidates.push(e.version.clone());
    }
  }
  for e in installers.iter().filter(|e| !e.stable) {
    if !installer_candidates.contains(&e.version) {
      installer_candidates.push(e.version.clone());
    }
  }
  if installer_candidates.len() > 10 {
    installer_candidates.truncate(10);
  }

  // 3) Find a working profile/json combination.
  // Some MC versions briefly land before a working installer/profile combo is published.
  // We try a small prioritized set (stable-first) with retry-on-429.
  let mut picked_loader: Option<String> = None;
  let mut picked_installer: Option<String> = None;
  let mut picked_profile_url: Option<String> = None;

  let mut last_error: Option<String> = None;

  for loader_ver in &loader_candidates {
    for installer_ver in &installer_candidates {
      let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/profile/json",
        mc_version, loader_ver, installer_ver
      );

      let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Fabric profile request failed: {e}"))?;

      if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // Respect Retry-After if present; otherwise wait briefly and retry once.
        let wait_secs = resp
          .headers()
          .get("retry-after")
          .and_then(|v| v.to_str().ok())
          .and_then(|s| s.parse::<u64>().ok())
          .unwrap_or(2);
        tokio::time::sleep(std::time::Duration::from_secs(wait_secs.min(10))).await;

        let retry = http
          .get(&url)
          .send()
          .await
          .map_err(|e| format!("Fabric profile request failed: {e}"))?;

        if retry.status().is_success() {
          picked_loader = Some(loader_ver.clone());
          picked_installer = Some(installer_ver.clone());
          picked_profile_url = Some(url);
          break;
        } else {
          last_error = Some(format!("{} for {}", retry.status(), url));
          continue;
        }
      }

      if resp.status().is_success() {
        picked_loader = Some(loader_ver.clone());
        picked_installer = Some(installer_ver.clone());
        picked_profile_url = Some(url);
        break;
      } else {
        last_error = Some(format!("{} for {}", resp.status(), url));
      }
    }
    if picked_profile_url.is_some() {
      break;
    }
  }

  
  // Fallback: some Fabric meta deployments expose a profile endpoint without an installer segment.
  if picked_profile_url.is_none() {
    for loader_ver in &loader_candidates {
      let alt_url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json",
        mc_version, loader_ver
      );
      let resp = http
        .get(&alt_url)
        .send()
        .await
        .map_err(|e| format!("Fabric profile request failed: {e}"))?;
      if resp.status().is_success() {
        picked_loader = Some(loader_ver.clone());
        picked_installer = Some("unknown".to_string());
        picked_profile_url = Some(alt_url);
        break;
      } else {
        last_error = Some(format!("{} for {}", resp.status(), alt_url));
      }
    }
  }

let Some(loader_ver) = picked_loader.clone() else {
    // Build a helpful hint of the latest Fabric-supported versions for this major.minor.
    let hint: Option<String> = {
      let parts: Vec<&str> = mc_version.split('.').collect();
      if parts.len() >= 2 {
        let prefix = format!("{}.{}", parts[0], parts[1]);
        match http.get("https://meta.fabricmc.net/v2/versions/game").send().await {
          Ok(resp) => match resp.error_for_status() {
            Ok(resp) => match resp.json::<Vec<FabricMetaVersion>>().await {
              Ok(games) => {
                let mut out: Vec<String> = Vec::new();
                for g in games {
                  let v = g.version;
                  if v.starts_with(&(prefix.clone() + ".")) && !out.contains(&v) {
                    out.push(v);
                  }
                  if out.len() >= 5 { break; }
                }
                if out.is_empty() {
                  None
                } else {
                  Some(format!("Latest Fabric-supported {}.* versions: {}", prefix, out.join(", ")))
                }
              }
              Err(_) => None,
            },
            Err(_) => None,
          },
          Err(_) => None,
        }
      } else {
        None
      }
    };

    let mut msg = if let Some(e) = last_error.clone() {
      format!(
        "Fabric profile returned error: no compatible loader/installer combination found for Minecraft {}. Last response: {}",
        mc_version, e
      )
    } else {
      format!(
        "Fabric profile returned error: no compatible loader/installer combination found for Minecraft {}",
        mc_version
      )
    };

    if let Some(h) = hint {
      msg.push_str("\n\n");
      msg.push_str(&h);
    }

    return Err(msg);
  };
  let _installer_ver = picked_installer.ok_or_else(|| "No Fabric installer builds available.".to_string())?;
  let profile_url = picked_profile_url.unwrap();

  let fabric_id = format!("fabric-loader-{}-{}", loader_ver, mc_version);

  let dir = versions_dir.join(&fabric_id);
  let json_path = dir.join(format!("{}.json", fabric_id));
  fs::create_dir_all(&dir).ok();

  if !json_path.exists() {
    // Download and save the Fabric profile json (we already validated the URL above)
    let bytes = http
      .get(&profile_url)
      .send()
      .await
      .map_err(|e| format!("Fabric profile download failed: {e}"))?
      .error_for_status()
      .map_err(|e| format!("Fabric profile returned error: {e}"))?
      .bytes()
      .await
      .map_err(|e| format!("Fabric profile read failed: {e}"))?;
    fs::write(&json_path, &bytes).map_err(|e| format!("Failed to write Fabric profile: {e}"))?;
  }

  let profile: FabricProfileJson = serde_json::from_slice(&fs::read(&json_path).map_err(|e| e.to_string())?)
    .map_err(|e| format!("Failed to parse Fabric profile json: {e}"))?;

  Ok((fabric_id, profile))
}


fn mc_version_ge(a: &str, min: &str) -> bool {
  fn parse(v: &str) -> Option<Vec<u32>> {
    let parts: Vec<_> = v.split('.').collect();
    if parts.len() < 2 { return None; }
    let mut out = vec![];
    for p in parts {
      if let Ok(n) = p.parse::<u32>() { out.push(n); } else { return None; }
    }
    Some(out)
  }
  let aa = match parse(a) { Some(x) => x, None => return false };
  let mm = match parse(min) { Some(x) => x, None => return false };
  let n = aa.len().max(mm.len());
  for i in 0..n {
    let x = *aa.get(i).unwrap_or(&0);
    let y = *mm.get(i).unwrap_or(&0);
    if x > y { return true; }
    if x < y { return false; }
  }
  true
}

fn http_client() -> anyhow::Result<reqwest::Client> {
  // A shared client with sane timeouts. `http1_only` avoids rare HTTP/2 stalls on some Windows setups.
  Ok(reqwest::Client::builder()
    .user_agent("MegaClient")
    .connect_timeout(std::time::Duration::from_secs(15))
    .timeout(std::time::Duration::from_secs(120))
    .http1_only()
    .build()?)
}

#[allow(dead_code)]
async fn download_to(url: &str, dest: &Path) -> anyhow::Result<()> {
  if let Some(parent) = dest.parent() { fs::create_dir_all(parent).ok(); }
  let http = http_client()?;
  // On some Windows setups the initial connect/TLS handshake can appear to hang.
  // Wrap the send in an explicit timeout so the launcher never gets stuck.
  use tokio::time::timeout;
  let resp = timeout(
      std::time::Duration::from_secs(30),
      http.get(url)
        .header("User-Agent", "MegaClient")
        .send()
    )
    .await
    .map_err(|_| anyhow::anyhow!("request timed out"))??
    .error_for_status()?;

  let tmp = dest.with_extension("part");
  let mut file = fs::File::create(&tmp)?;
  let mut stream = resp.bytes_stream();

  use futures_util::StreamExt;

  while let Some(chunk) = timeout(std::time::Duration::from_secs(30), stream.next())
    .await
    .map_err(|_| anyhow::anyhow!("download stalled"))?
  {
    let c = chunk?;
    file.write_all(&c)?;
  }

  // Ensure bytes hit disk before we rename.
  let _ = file.sync_all();
        drop(file);

  // Atomically move into place.
  fs::rename(&tmp, dest)?;

  Ok(())
}

// Download a file while periodically emitting progress to the UI.
async fn download_to_progress(window: &tauri::Window, url: &str, dest: &Path, label: &str) -> anyhow::Result<()> {
  if let Some(parent) = dest.parent() { fs::create_dir_all(parent).ok(); }

  // Emit *before* any network I/O so the UI never looks frozen while connecting.
  let connecting = format!("{} (connecting)...", label);
  let _ = window.emit("mc:launching", connecting.clone());
  append_log(&connecting);

  let http = http_client()?;

  // A tiny retry loop helps with transient CDN hiccups.
  let mut last_err: Option<anyhow::Error> = None;
  for attempt in 1..=3 {
    let attempt_msg = format!("{} (requesting... attempt {}/3)", label, attempt);
    let _ = window.emit("mc:launching", attempt_msg.clone());
    append_log(&attempt_msg);

    // Explicitly time out the request send to avoid rare hangs during connect/TLS.
    use tokio::time::timeout;
    let sent = timeout(
      std::time::Duration::from_secs(30),
      http.get(url).send()
    )
    .await
    .map_err(|_| anyhow::anyhow!("request timed out"))?;

    match sent.and_then(|r| r.error_for_status()) {
      Ok(resp) => {
        let total = resp.content_length();
        let tmp = dest.with_extension("part");
        let mut file = fs::File::create(&tmp)?;
        let mut stream = resp.bytes_stream();

        use futures_util::StreamExt;
        let mut downloaded: u64 = 0;
        let mut last_emit: u64 = 0;
        const EMIT_EVERY_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

        // Initial line (now that we have headers)
        let init = match total {
          Some(t) => format!("{} (0/{:.1} MB)...", label, (t as f64) / 1024.0 / 1024.0),
          None => format!("{} (0 MB)...", label),
        };
        let _ = window.emit("mc:launching", init.clone());
        append_log(&init);

        use tokio::time::timeout;
        while let Some(chunk) = timeout(std::time::Duration::from_secs(30), stream.next()).await.map_err(|_| anyhow::anyhow!("download stalled"))? {
          let c = chunk?;
          file.write_all(&c)?;
          downloaded += c.len() as u64;

          if downloaded.saturating_sub(last_emit) >= EMIT_EVERY_BYTES {
            last_emit = downloaded;
            let msg = match total {
              Some(t) => format!(
                "{} ({:.1}/{:.1} MB)...",
                label,
                (downloaded as f64) / 1024.0 / 1024.0,
                (t as f64) / 1024.0 / 1024.0
              ),
              None => format!("{} ({:.1} MB)...", label, (downloaded as f64) / 1024.0 / 1024.0),
            };
            let _ = window.emit("mc:launching", msg.clone());
            append_log(&msg);
          }
        }

        let done_msg = match total {
          Some(t) => format!(
            "{} complete ({:.1}/{:.1} MB)",
            label,
            (downloaded as f64) / 1024.0 / 1024.0,
            (t as f64) / 1024.0 / 1024.0
          ),
          None => format!("{} complete ({:.1} MB)", label, (downloaded as f64) / 1024.0 / 1024.0),
        };
        let _ = window.emit("mc:launching", done_msg.clone());
        append_log(&done_msg);
        // Ensure all bytes are flushed to disk before we rename.
        let _ = file.sync_all();
        drop(file);

        // Atomically move into place. If this fails and we ignore it, the launcher will
        // think the file exists but Minecraft will be missing critical artifacts.
        fs::rename(&tmp, dest).map_err(|e| {
          let msg = format!("Failed to finalize download (rename): {}", e);
          let _ = window.emit("mc:launching", msg.clone());
          append_log(&msg);
          anyhow::anyhow!(e)
        })?;

        return Ok(());
      }
      Err(e) => {
        last_err = Some(anyhow::anyhow!(e));
        let msg = format!("{} (attempt {}/3 failed, retrying...)", label, attempt);
        let _ = window.emit("mc:launching", msg.clone());
        append_log(&msg);
        // Small backoff
        tokio::time::sleep(std::time::Duration::from_millis(600 * attempt as u64)).await;
      }
    }
  }

  Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Download failed")))
}

fn extract_natives(jar_path: &Path, natives_dir: &Path) -> anyhow::Result<()> {
  fs::create_dir_all(natives_dir).ok();
  let f = fs::File::open(jar_path)?;
  let mut z = zip::ZipArchive::new(f)?;
  for i in 0..z.len() {
    let mut file = z.by_index(i)?;
    let name = file.name().to_string();
    if name.starts_with("META-INF/") { continue; }
    if !(name.ends_with(".dll") || name.ends_with(".so") || name.ends_with(".dylib")) { continue; }
    let out_path = natives_dir.join(Path::new(&name).file_name().unwrap());
    let mut out = fs::File::create(out_path)?;
    io::copy(&mut file, &mut out)?;
  }
  Ok(())
}

fn jar_blocked(path: &Path) -> anyhow::Result<Option<String>> {
  let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
  for p in CHEAT_PATTERNS {
    if name.contains(p) {
      return Ok(Some(format!("Blocked by filename: {}", path.display())));
    }
  }
  Ok(None)
}

#[tauri::command]
async fn list_versions() -> Result<Vec<McVersion>, String> {

  // Try online manifest first; fall back to a built-in list if the network is blocked.
  let fallback: Vec<McVersion> = vec![
    McVersion{ id: "1.8.9".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.9.4".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.10.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.11.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.12.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.13.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.14.4".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.15.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.16.5".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.17.1".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.18.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.19.4".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.20.1".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.20.4".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.20.6".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.21.1".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.21.2".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.21.3".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
    McVersion{ id: "1.21.4".to_string(), vtype: "release".to_string(), release_time: "".to_string() },
  ];

  let url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
  let http = reqwest::Client::builder()
    .user_agent("MegaClient/1.0")
    .connect_timeout(std::time::Duration::from_secs(15))
    .timeout(std::time::Duration::from_secs(30))
    .http1_only()
    .build()
    .map_err(|e| e.to_string())?;

  let resp = http.get(url).send().await;
  let resp = match resp {
    Ok(r) => r,
    Err(_) => return Ok(fallback),
  };
  let txt = match resp.text().await {
    Ok(t) => t,
    Err(_) => return Ok(fallback),
  };
  let parsed: Result<Manifest, _> = serde_json::from_str(&txt);
  let manifest = match parsed {
    Ok(m) => m,
    Err(_) => return Ok(fallback),
  };

  // Convert ManifestVersion -> McVersion (we only need id/type/releaseTime for the UI).
  let mut out: Vec<McVersion> = manifest.versions.into_iter().map(|v| McVersion {
    id: v.id,
    vtype: v.vtype,
    release_time: v.release_time,
  }).collect();

  // Only show release versions 1.8.9+ (filter out snapshots & very old versions).
  fn parse_ver(id: &str) -> Option<(i32,i32,i32)> {
    let parts: Vec<&str> = id.split('.').collect();
    if parts.len() < 2 { return None; }
    let maj: i32 = parts.get(0)?.parse().ok()?;
    let min: i32 = parts.get(1)?.parse().ok()?;
    let pat: i32 = parts.get(2).and_then(|p| p.parse().ok()).unwrap_or(0);
    Some((maj,min,pat))
  }
  let min_allowed = (1,8,9);
  out.retain(|v| {
    if v.vtype != "release" { return false; }
    if let Some(t) = parse_ver(&v.id) {
      t >= min_allowed
    } else {
      false
    }
  });

  // Ensure fallback versions exist if upstream omits them.

  for f in &fallback {
    if !out.iter().any(|v| v.id == f.id) {
      out.push(f.clone());
    }
  }

  // Sort newest-ish by release_time when available.
  out.sort_by(|a, b| b.release_time.cmp(&a.release_time));
  Ok(out)

}

fn extract_query_param(input: &str, key: &str) -> Option<String> {
  // Accept raw code (user pasted just the code)
  if key == "code" && !input.contains('?') && !input.contains("code=") {
    let trimmed = input.trim();
    if trimmed.len() >= 8 {
      return Some(trimmed.to_string());
    }
  }

  let mut s = input.trim();
  if let Some(hash) = s.find('#') { s = &s[..hash]; }
  let qpos = s.find('?')?;
  let q = &s[qpos + 1..];

  for part in q.split('&') {
    let mut it = part.splitn(2, '=');
    let k = it.next().unwrap_or("");
    let v = it.next().unwrap_or("");
    if k.eq_ignore_ascii_case(key) {
      return urlencoding::decode(v).ok().map(|c| c.to_string());
    }
  }
  None
}

#[tauri::command]
async fn start_microsoft_auth_code() -> Result<String, String> {
  // IMPORTANT:
  // The official Minecraft Launcher client id (00000000402b5328) does NOT work with the Entra v2 device-code endpoint.
  // It does work with the legacy Live.com auth-code flow used by many launchers.
  let client_id = ms_client_id()?;
  let scope = "XboxLive.signin offline_access";
  let redirect_uri = "https://login.live.com/oauth20_desktop.srf";

  let state = uuid::Uuid::new_v4().to_string();
  *PENDING_MS_OAUTH_STATE.lock().unwrap() = Some(state.clone());

  let url = format!(
    "https://login.live.com/oauth20_authorize.srf?client_id={}&response_type=code&redirect_uri={}&scope={}&state={}&prompt=select_account",
    urlencoding::encode(&client_id),
    urlencoding::encode(redirect_uri),
    urlencoding::encode(scope),
    urlencoding::encode(&state)
  );
  Ok(url)
}

#[tauri::command]
async fn finish_microsoft_auth_code(redirect_url: String) -> Result<McProfile, String> {
  // User pastes the final redirect URL from the browser:
  // https://login.live.com/oauth20_desktop.srf?code=...&state=...
  if let Some(err) = extract_query_param(&redirect_url, "error") {
    let desc = extract_query_param(&redirect_url, "error_description").unwrap_or_default();
    return Err(format!("Microsoft sign-in failed: {}{}", err, if desc.is_empty() { "".into() } else { format!("\n\n{}", desc) }));
  }

  let code = extract_query_param(&redirect_url, "code").ok_or_else(|| {
    "Couldn't find an OAuth code in the URL you pasted.\n\nAfter signing in, copy the FULL address from your browser (it starts with https://login.live.com/oauth20_desktop.srf?code=...) and paste it here.".to_string()
  })?;

  // Best-effort state validation (don't hard-fail; just prevents accidental mismatches).
  if let (Some(expected), Some(got)) = (
    PENDING_MS_OAUTH_STATE.lock().unwrap().clone(),
    extract_query_param(&redirect_url, "state"),
  ) {
    if expected != got {
      // Clear anyway to avoid getting stuck
      *PENDING_MS_OAUTH_STATE.lock().unwrap() = None;
      return Err("This login link looks like it's from an older attempt. Click 'Add Microsoft Account' again to start a fresh sign-in.".to_string());
    }
  }
  *PENDING_MS_OAUTH_STATE.lock().unwrap() = None;

  let client_id = ms_client_id()?;
  let redirect_uri = "https://login.live.com/oauth20_desktop.srf";
  let token_url = "https://login.live.com/oauth20_token.srf";
  let http = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .user_agent("MegaClient")
    .build()
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

  let params = [
    ("client_id", client_id.as_str()),
    ("grant_type", "authorization_code"),
    ("code", code.as_str()),
    ("redirect_uri", redirect_uri),
  ];

  let resp = http
    .post(token_url)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .form(&params)
    .send()
    .await
    .map_err(|e| format!("Microsoft token request failed: {e}"))?;

  let status = resp.status();
  let body = resp.text().await.unwrap_or_default();
  if !status.is_success() {
    let te: MsTokenError = serde_json::from_str(&body).unwrap_or(MsTokenError {
      error: Some("unknown_error".to_string()),
      error_description: Some(body.clone()),
    });
    let e = te.error.unwrap_or_else(|| "unknown_error".to_string());
    let d = te.error_description.unwrap_or_else(|| body);
    return Err(format!("Microsoft sign-in failed: {}\n\n{}", e, d));
  }

  let ms: MsTokenResponse = serde_json::from_str(&body)
    .map_err(|e| format!("Failed to parse Microsoft token response: {e}"))?;

  let (profile, mc_access_token, mc_expires_in) =
    microsoft_token_to_minecraft_profile(ms.access_token.clone()).await?;

  {
    let mut st = STATE.lock().unwrap();
    st.ms_refresh_token = ms.refresh_token.clone();
    st.mc_uuid = Some(profile.id.clone());
    st.mc_username = Some(profile.name.clone());
    st.mc_access_token = Some(mc_access_token);
    st.mc_expires_at = Some(now_epoch() + mc_expires_in);
    let _ = st.save();
  }

  Ok(profile)
}

#[tauri::command]
async fn get_current_account() -> Result<Option<McProfile>, String> {
  let st = STATE.lock().unwrap();
  if let (Some(id), Some(name)) = (st.mc_uuid.clone(), st.mc_username.clone()) {
    Ok(Some(McProfile { id, name }))
  } else {
    Ok(None)
  }
}

#[tauri::command]
async fn logout_account() -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  st.ms_refresh_token = None;
  st.mc_access_token = None;
  st.mc_expires_at = None;
  st.mc_uuid = None;
  st.mc_username = None;
  st.save().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
async fn open_url(window: tauri::Window, url: String) -> Result<(), String> {
  tauri::api::shell::open(&window.shell_scope(), url, None).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
async fn open_version_files(_window: tauri::Window, version: String) -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;
  let versions = game_dir.join("versions");
  let mut p = versions.join(&version);
  if !p.exists() {
    p = versions;
  }
  // Open using Explorer (avoids shell-scope URL validation issues)
  #[cfg(target_os = "windows")]
  {
    let _ = std::process::Command::new("explorer").arg(p.to_string_lossy().to_string()).spawn();
    return Ok(());
  }
  #[cfg(not(target_os = "windows"))]
  {
    tauri::api::shell::open(&_window.shell_scope(), p.to_string_lossy().to_string(), None)
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

#[tauri::command]
async fn get_news_items() -> Result<Vec<NewsItem>, String> {
  // Same endpoint the official launcher consumes.
  let url = "https://launchercontent.mojang.com/v2/news.json";
  let v: serde_json::Value = reqwest::Client::new()
    .get(url)
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  let mut out: Vec<NewsItem> = Vec::new();
  if let Some(entries) = v.get("entries").and_then(|e| e.as_array()) {
    for e in entries.iter().take(25) {
      let title = e.get("title").and_then(|x| x.as_str()).unwrap_or("Minecraft News").to_string();
      let summary = e
        .get("shortText")
        .or_else(|| e.get("text"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
      let url = e
        .get("readMoreLink")
        .or_else(|| e.get("url"))
        .or_else(|| e.get("link"))
        .and_then(|x| x.as_str())
        .unwrap_or("https://minecraft.net")
        .to_string();
      let date = e
        .get("date")
        .or_else(|| e.get("timestamp"))
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
      out.push(NewsItem { title, summary, url, date });
    }
  }
  Ok(out)
}

#[tauri::command]
async fn get_news() -> Result<Vec<NewsItem>, String> {
  get_news_items().await
}


#[derive(Serialize, Deserialize, Clone)]
struct LauncherUpdate {
  tag: String,
  name: String,
  body: String,
  url: String,
  date: String,
}

#[tauri::command]
async fn get_launcher_updates() -> Result<Vec<LauncherUpdate>, String> {
  let url = "https://api.github.com/repos/DamianGaming/MegaClient/releases?per_page=10";
  let v: serde_json::Value = reqwest::Client::new()
    .get(url)
    .header("Accept", "application/vnd.github+json")
    .header("User-Agent", "MegaClient")
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  let mut out: Vec<LauncherUpdate> = Vec::new();
  if let Some(arr) = v.as_array() {
    for r in arr.iter().take(10) {
      let tag = r.get("tag_name").and_then(|x| x.as_str()).unwrap_or("").to_string();
      let name = r.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
	      // Compute the display name before moving `tag` into the struct.
	      let display_name = if !name.is_empty() { name } else { tag.clone() };
      let body = r.get("body").and_then(|x| x.as_str()).unwrap_or("").to_string();
      let url = r.get("html_url").and_then(|x| x.as_str()).unwrap_or("https://github.com/DamianGaming/MegaClient/releases").to_string();
      let date = r.get("published_at").or_else(|| r.get("created_at")).and_then(|x| x.as_str()).unwrap_or("").to_string();
      out.push(LauncherUpdate {
	        tag,
	        name: display_name,
        body,
        url,
        date,
      });
    }
  }
  Ok(out)
}

fn sanitize_filename(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for ch in s.chars() {
    if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' {
      out.push(ch);
    } else {
      out.push('_');
    }
  }
  if out.is_empty() { "server".into() } else { out }
}

#[tauri::command]
async fn get_server_icon(host: String) -> Result<String, String> {
  let base = AppState::base_dir().map_err(|e| e.to_string())?;
  let cache_dir = base.join("cache").join("icons");
  fs::create_dir_all(&cache_dir).ok();
  let file = cache_dir.join(format!("{}.png", sanitize_filename(&host)));

  let bytes = if file.exists() {
    fs::read(&file).map_err(|e| e.to_string())?
  } else {
    let enc = urlencoding::encode(&host);
    // Primary: mcstatus.io
    let mut b: Vec<u8> = Vec::new();
    for url in [
      format!("https://api.mcstatus.io/v2/icon/java/{}", enc),
      format!("https://api.mcsrvstat.us/icon/{}", enc),
    ] {
      match reqwest::Client::new()
        .get(url)
        .header("User-Agent", "MegaClient")
        .send()
        .await
      {
        Ok(resp) => {
          if let Ok(resp) = resp.error_for_status() {
            if let Ok(bytes) = resp.bytes().await {
              let bb = bytes.to_vec();
              if !bb.is_empty() {
                b = bb;
                break;
              }
            }
          }
        }
        Err(_) => continue,
      }
    }
    if !b.is_empty() {
      let _ = fs::write(&file, &b);
    }
    b
  };

  if bytes.is_empty() {
    return Err("No icon returned".into());
  }

  Ok(format!("data:image/png;base64,{}", B64.encode(bytes)))
}






#[tauri::command]
fn get_selected_version() -> Result<String, String> {
  Ok(STATE.lock().unwrap().selected_version.clone().unwrap_or_default())
}

#[tauri::command]
fn set_selected_version(version: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  st.selected_version = Some(version);
  st.save().ok();
  Ok(())
}

fn normalize_loader(l: &str) -> String {
  match l.to_ascii_lowercase().as_str() {
    "fabric" => "fabric".into(),
    _ => "vanilla".into(),
  }
}

#[tauri::command]
fn get_selected_loader() -> Result<String, String> {
  Ok(STATE.lock().unwrap().selected_loader.clone().unwrap_or_else(|| "vanilla".into()))
}

#[tauri::command]
fn set_selected_loader(loader: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  st.selected_loader = Some(normalize_loader(&loader));
  st.save().ok();
  Ok(())
}



fn scan_mods_and_block_in(mods_dir: &Path) -> Result<(), String> {
  fs::create_dir_all(mods_dir).ok();
  let bad = ["wurst","meteor","aristois","liquidbounce","impactclient","futureclient","sigma","rise","novoline","rusherhack","konas"];
  if let Ok(rd) = fs::read_dir(mods_dir) {
    for ent in rd.flatten() {
      let p = ent.path();
      if p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase() != "jar" { continue; }
      let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
      for pat in &bad {
        if name.contains(pat) {
          return Err(format!("Blocked by signature: {} ({})", p.display(), pat));
        }
      }
    }
  }
  Ok(())
}

#[tauri::command]
fn scan_mods_and_block() -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;
  let mods = game_dir.join("mods");
  if !mods.exists() { return Ok(()); }

  for e in fs::read_dir(&mods).map_err(|e| e.to_string())? {
    let p = e.map_err(|e| e.to_string())?.path();
    if p.extension().map(|x| x.to_string_lossy().to_lowercase()) == Some("jar".into()) {
      if let Ok(Some(reason)) = jar_blocked(&p) {
        return Err(format!("{reason}

Delete the mod and try again.
Mods folder: {}", mods.display()));
      }
    }
  }
  Ok(())
}

#[allow(dead_code)]
fn default_minecraft_dir() -> PathBuf {
  #[cfg(target_os="windows")]
  {
    if let Ok(appdata) = std::env::var("APPDATA") {
      if !appdata.is_empty() { return PathBuf::from(appdata).join(".minecraft"); }
    }
  }
  dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".minecraft")
}

#[tauri::command]
fn set_join_server(host: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  st.join_server = Some(host);
  st.save().ok();
  Ok(())
}

#[tauri::command]
fn open_microsoft_login(window: tauri::Window) -> Result<(), String> {
  let _ = tauri::api::shell::open(&window.shell_scope(), "https://www.microsoft.com/link", None);
  Ok(())
}

#[tauri::command]
fn rpc_enable() -> Result<(), String> {
  rpc_set_activity(Some("In MegaClient"), Some("Launcher"))
}

fn rpc_set_activity(state: Option<&str>, details: Option<&str>) -> Result<(), String> {
  let mut guard = RPC_CLIENT.lock().unwrap();
  if guard.is_none() {
    let mut client = discord_rich_presence::DiscordIpcClient::new(DISCORD_APP_ID).map_err(|e| e.to_string())?;
    client.connect().map_err(|e| e.to_string())?;
    *guard = Some(client);
  }
  if let Some(client) = guard.as_mut() {
    let mut act = discord_rich_presence::activity::Activity::new();
    if let Some(s) = state { act = act.state(s); }
    if let Some(d) = details { act = act.details(d); }
    client.set_activity(act).map_err(|e| e.to_string())?;
  }
  Ok(())
}

fn rpc_clear() {
  let mut guard = RPC_CLIENT.lock().unwrap();
  if let Some(mut client) = guard.take() {
    // Ignore errors on shutdown.
    let _ = client.clear_activity();
    let _ = client.close();
  }
}

#[tauri::command]
fn rpc_set_state(state: Option<String>, details: Option<String>) -> Result<(), String> {
  rpc_set_activity(state.as_deref(), details.as_deref())
}

#[tauri::command]
fn rpc_disable() -> Result<(), String> {
  rpc_clear();
  Ok(())
}

#[tauri::command]
fn close_splash(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(splash) = app.get_window("splash") {
    let _ = splash.close();
  }
  if let Some(main) = app.get_window("main") {
    let _ = main.show();
    let _ = main.set_focus();
  }
  Ok(())
}

#[derive(Deserialize, Clone)]
struct VersionJson {
  #[allow(dead_code)]
  #[serde(rename="id")]
  #[allow(dead_code)]
  id: String,

  #[serde(rename="inheritsFrom")]
  inherits_from: Option<String>,

  #[serde(rename="mainClass")]
  main_class: Option<String>,

  #[serde(rename="assets")]
  assets_index: Option<String>,

  #[serde(rename="type")]
  vtype: Option<String>,

  #[serde(rename="minecraftArguments")]
  minecraft_arguments: Option<String>,

  #[serde(default)]
  arguments: Option<ArgsModern>,

  #[serde(default)]
  libraries: Vec<Library>,

  #[serde(default)]
  downloads: Option<DownloadsRoot>,

  #[serde(rename="assetIndex")]
  asset_index: Option<AssetIndexRef>,

}

fn merge_version_json(parent: VersionJson, mut child: VersionJson) -> VersionJson {
  if child.main_class.is_none() { child.main_class = parent.main_class; }
  if child.assets_index.is_none() { child.assets_index = parent.assets_index; }
  if child.vtype.is_none() { child.vtype = parent.vtype; }
  if child.minecraft_arguments.is_none() { child.minecraft_arguments = parent.minecraft_arguments; }
  if child.arguments.is_none() { child.arguments = parent.arguments; }
  if child.asset_index.is_none() { child.asset_index = parent.asset_index; }
  if child.downloads.is_none() { child.downloads = parent.downloads; }

  // Merge libraries (parent first, then child)
  let mut libs = parent.libraries;
  libs.extend(child.libraries.drain(..));
  child.libraries = libs;
  child
}

fn vjson_main_class(v: &VersionJson) -> Result<String, String> {
  v.main_class.clone().ok_or_else(|| "Missing mainClass in version json".to_string())
}

fn vjson_asset_index(v: &VersionJson) -> Result<AssetIndexRef, String> {
  v.asset_index.clone().ok_or_else(|| "Missing assetIndex in version json".to_string())
}

#[allow(dead_code)]
fn vjson_downloads(v: &VersionJson) -> Result<DownloadsRoot, String> {
  v.downloads.clone().ok_or_else(|| "Missing downloads in version json".to_string())
}


async fn load_version_json_cached(window: &tauri::Window, version_id: &str, versions_dir: &Path) -> Result<VersionJson, String> {
  let json_path = versions_dir.join(version_id).join(format!("{}.json", version_id));
  if !json_path.exists() {
    let manifest = fetch_manifest().await.map_err(|e| e.to_string())?;
    let link = manifest.versions.into_iter().find(|v| v.id == version_id)
      .ok_or_else(|| format!("Version not found in manifest: {}", version_id))?;
    download_to_progress(window, &link.url, &json_path, &format!("Downloading version metadata ({})", version_id))
      .await
      .map_err(|e| e.to_string())?;
  }
  let bytes = std::fs::read(&json_path).map_err(|e| e.to_string())?;
  serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

#[derive(Deserialize, Clone)]
struct ArgsModern {
  game: Vec<ArgValue>,
  jvm: Vec<ArgValue>,
}

#[derive(Deserialize, Clone)]
#[serde(untagged)]
enum ArgValue {
  Str(String),
  Obj { rules: Option<Vec<Rule>>, value: serde_json::Value },
}

#[derive(Deserialize, Clone)]
struct Rule {
  action: String,
  os: Option<HashMap<String,String>>,
  // Mojang argument rules may include "features" (e.g. quick play flags).
  // We treat missing features as false and only allow a rule if all specified
  // feature flags match.
  #[serde(default)]
  features: Option<HashMap<String, bool>>,
}

#[derive(Deserialize, Clone)]
struct AssetIndexRef {
  id: String,
  url: String,
}

#[derive(Deserialize, Clone)]
struct DownloadsRoot { client: DownloadItem }

#[derive(Deserialize, Clone)]
struct DownloadItem {
  url: String,
  #[serde(default)]
  sha1: Option<String>,
  #[serde(default)]
  #[allow(dead_code)]
  size: Option<u64>,
}

#[derive(Deserialize, Clone)]
struct Library {
  // Fabric (and some other launch profiles) provide Maven coordinates via `name`
  // and an optional base `url` (maven repo). Mojang profiles usually include
  // fully-resolved download URLs via `downloads`.
  #[serde(default)]
  name: Option<String>,
  #[serde(default)]
  url: Option<String>,
  downloads: Option<LibraryDownloads>,
  natives: Option<HashMap<String,String>>,
  rules: Option<Vec<Rule>>,
}

#[derive(Deserialize, Clone)]
struct LibraryDownloads {
  artifact: Option<LibraryArtifact>,
  classifiers: Option<HashMap<String, LibraryArtifact>>,
}

#[derive(Deserialize, Clone)]
struct LibraryArtifact { path: String, url: String }

fn rules_allow(rules: &Option<Vec<Rule>>, features: &HashMap<String, bool>) -> bool {
  let Some(rules) = rules.as_ref() else { return true; };

  let os_name: &str = if cfg!(target_os = "windows") {
    "windows"
  } else if cfg!(target_os = "macos") {
    "osx"
  } else {
    "linux"
  };

  let has_allow = rules.iter().any(|r| r.action == "allow");
  // Mojang rule semantics: if any allow rules exist, default is deny.
  // If only deny rules exist, default is allow.
  let mut allowed = !has_allow;

  for r in rules {
    // OS match (if specified)
    if let Some(os) = &r.os {
      if let Some(name) = os.get("name") {
        if name != os_name { continue; }
      }
    }

    // Feature match (if specified)
    if let Some(req) = &r.features {
      let mut ok = true;
      for (k, v) in req {
        let cur = *features.get(k).unwrap_or(&false);
        if cur != *v { ok = false; break; }
      }
      if !ok { continue; }
    }

    // Apply rule
    if r.action == "allow" {
      allowed = true;
    } else if r.action == "deny" {
      allowed = false;
    }
  }

  allowed
}

fn make_lib_path(root: &Path, maven_path: &str) -> PathBuf {
  root.join("libraries").join(maven_path.replace("/", &std::path::MAIN_SEPARATOR.to_string()))
}

/// Convert a Maven coordinate (`group:artifact:version[:classifier][@ext]`) to a repository path.
/// Examples:
/// - `net.fabricmc:fabric-loader:0.15.11` -> `net/fabricmc/fabric-loader/0.15.11/fabric-loader-0.15.11.jar`
/// - `org.lwjgl:lwjgl:3.3.3:natives-windows@jar` -> `org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3-natives-windows.jar`
fn maven_coord_to_repo_path(coord: &str) -> Option<String> {
  let coord = coord.trim();
  if coord.is_empty() { return None; }

  // Optional extension suffix (`@jar`, `@zip`, etc.)
  let (left, ext) = match coord.split_once('@') {
    Some((a, b)) if !b.trim().is_empty() => (a.trim(), b.trim()),
    _ => (coord, "jar"),
  };

  let parts: Vec<&str> = left.split(':').collect();
  if parts.len() < 3 { return None; }
  let group = parts[0].trim();
  let artifact = parts[1].trim();
  let version = parts[2].trim();
  if group.is_empty() || artifact.is_empty() || version.is_empty() { return None; }

  let classifier = if parts.len() >= 4 {
    let c = parts[3].trim();
    if c.is_empty() { None } else { Some(c) }
  } else {
    None
  };

  let group_path = group.replace('.', "/");
  let file_name = if let Some(c) = classifier {
    format!("{}-{}-{}.{}", artifact, version, c, ext)
  } else {
    format!("{}-{}.{}", artifact, version, ext)
  };

  Some(format!("{}/{}/{}/{}", group_path, artifact, version, file_name))
}

fn maven_coord_to_repo_path_with_classifier(coord: &str, classifier: &str) -> Option<String> {
  let coord = coord.trim();
  let classifier = classifier.trim();
  if coord.is_empty() || classifier.is_empty() { return None; }

  let (left, ext) = match coord.split_once('@') {
    Some((a, b)) if !b.trim().is_empty() => (a.trim(), b.trim()),
    _ => (coord, "jar"),
  };

  let parts: Vec<&str> = left.split(':').collect();
  if parts.len() < 3 { return None; }
  let group = parts[0].trim();
  let artifact = parts[1].trim();
  let version = parts[2].trim();
  if group.is_empty() || artifact.is_empty() || version.is_empty() { return None; }

  let group_path = group.replace('.', "/");
  let file_name = format!("{}-{}-{}.{}", artifact, version, classifier, ext);
  Some(format!("{}/{}/{}/{}", group_path, artifact, version, file_name))
}

fn join_url(base: &str, path: &str) -> String {
  let mut b = base.trim().to_string();
  if !b.ends_with('/') { b.push('/'); }
  let p = path.trim_start_matches('/');
  format!("{}{}", b, p)
}

fn features_for_loader(loader: &str) -> HashMap<String, bool> {
  let mut f = HashMap::new();
  // Mojang rules frequently reference this.
  if loader.eq_ignore_ascii_case("fabric") {
    f.insert("is_modded".to_string(), true);
  } else {
    f.insert("is_modded".to_string(), false);
  }
  f
}

async fn download_maven_artifact(
  window: &tauri::Window,
  lib_url: Option<&str>,
  repo_path: &str,
  dest: &Path,
  label: &str,
) -> Result<(), String> {
  if dest.exists() {
    return Ok(());
  }

  // Try the library's declared maven repo first, then fall back to common repos.
  let mut bases: Vec<String> = Vec::new();
  if let Some(u) = lib_url {
    let u = u.trim();
    if !u.is_empty() {
      bases.push(u.to_string());
    }
  }
  // Fabric's repo is the most common for Fabric loader deps.
  bases.push("https://maven.fabricmc.net/".to_string());
  // Maven Central for general artifacts.
  bases.push("https://repo.maven.apache.org/maven2/".to_string());
  // Mojang's library repo as a last resort.
  bases.push("https://libraries.minecraft.net/".to_string());

  // Deduplicate while preserving order.
  let mut uniq: Vec<String> = Vec::new();
  for b in bases {
    let key = b.trim_end_matches('/').to_string();
    if !uniq.iter().any(|x| x.trim_end_matches('/') == key) {
      uniq.push(b);
    }
  }

  let mut last_err: Option<String> = None;
  for base in uniq {
    let url = join_url(&base, repo_path);
    match download_to_progress(window, &url, dest, label).await {
      Ok(_) => return Ok(()),
      Err(e) => {
        last_err = Some(format!("{} ({})", e, url));
        // keep trying
      }
    }
  }
  Err(last_err.unwrap_or_else(|| "Failed to download maven artifact".to_string()))
}


fn bundled_java_path(window: &tauri::Window) -> Option<PathBuf> {
  // Bundled runtime is stored under src-tauri/resources/jre and included via tauri.bundle.resources.
  let res_dir = window.app_handle().path_resolver().resource_dir()?;
  let bin_dir = res_dir.join("jre").join("bin");
  // Prefer javaw.exe on Windows (no console window)
  if cfg!(windows) {
    let jw = bin_dir.join("javaw.exe");
    if jw.exists() { return Some(jw); }
    let je = bin_dir.join("java.exe");
    if je.exists() { return Some(je); }
  } else {
    let j = bin_dir.join("java");
    if j.exists() { return Some(j); }
  }
  None
}

fn java_path() -> Option<PathBuf> {
  if let Ok(jh) = std::env::var("JAVA_HOME") {
    let p = PathBuf::from(jh).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
    if p.exists() { return Some(p); }
  }
  None
}

fn parse_java_major(ver: &str) -> Option<u32> {
  let v = ver.trim();
  if v.is_empty() { return None; }
  // Java 8 reports "1.8.0_XXX"
  if v.starts_with("1.") {
    return v.split('.').nth(1)?.parse::<u32>().ok();
  }
  // Java 9+ reports "17.0.10", "21.0.2", etc.
  v.split('.').next()?.parse::<u32>().ok()
}

fn detect_java_major(java_bin: &Path) -> Option<u32> {
  let out = std::process::Command::new(java_bin)
    .arg("-version")
    .output()
    .ok()?;

  let s = format!(
    "{}
{}",
    String::from_utf8_lossy(&out.stderr),
    String::from_utf8_lossy(&out.stdout)
  );

  // Typical output contains: ... version "21.0.2" ...
  if let Some(a) = s.find('"') {
    if let Some(b_rel) = s[a + 1..].find('"') {
      let b = a + 1 + b_rel;
      let ver = &s[a + 1..b];
      if let Some(m) = parse_java_major(ver) { return Some(m); }
    }
  }

  // Fallback: scan the first digit-run, e.g. "21.0.2"
  let mut buf = String::new();
  let mut started = false;
  for ch in s.chars() {
    if ch.is_ascii_digit() || (started && ch == '.') {
      started = true;
      buf.push(ch);
    } else if started {
      break;
    }
  }
  parse_java_major(&buf)
}

fn java_satisfies(java_bin: &Path, required_major: u32) -> bool {
  detect_java_major(java_bin).map(|m| m >= required_major).unwrap_or(false)
}



async fn ensure_java_runtime(window: &tauri::Window, major: u32) -> anyhow::Result<PathBuf> {
  // 0) Prefer bundled runtime (ships with MegaClient) if it satisfies the required Java major.
  if let Some(p) = bundled_java_path(window) {
    if java_satisfies(&p, major) { return Ok(p); }
    append_log(&format!(
      "Bundled Java does not satisfy required Java {} (detected {:?})",
      major,
      detect_java_major(&p)
    ));
  }

  // 1) Use JAVA_HOME if available (and compatible)
  if let Some(p) = java_path() {
    if java_satisfies(&p, major) { return Ok(p); }
    append_log(&format!(
      "JAVA_HOME Java does not satisfy required Java {} (detected {:?})",
      major,
      detect_java_major(&p)
    ));
  }

  // 2) Use app-managed runtime (downloaded)
  let base = AppState::base_dir()?.join("runtime").join(format!("java{}", major));
  let bin = if cfg!(windows) {
    // Prefer javaw.exe on Windows (no console window)
    let jw = base.join("bin").join("javaw.exe");
    if jw.exists() { return Ok(jw); }
    base.join("bin").join("java.exe")
  } else {
    base.join("bin").join("java")
  };
  if bin.exists() { return Ok(bin); }

  if !cfg!(windows) {
    anyhow::bail!("Java not found. Please install Java {} or set JAVA_HOME.", major);
  }

  fs::create_dir_all(&base).ok();

  // Adoptium API provides a stable 'latest' binary endpoint. We download a ZIP and extract it.
  // Example pattern is documented by Adoptium community support: /v3/binary/latest/<ver>/ga/windows/x64/jdk/hotspot/normal/eclipse
  // We'll request a JRE ZIP for the given major.
  let url = format!(
    "https://api.adoptium.net/v3/binary/latest/{}/ga/windows/x64/jre/hotspot/normal/eclipse",
    major
  );

  let _ = window.emit("mc:status", format!("Downloading Java {} (first-time setup)...", major));
  append_log(&format!("Downloading Java {}...", major));
let archive = AppState::base_dir()?.join("runtime").join(format!("java{}_win.zip", major));
  download_to_progress(window, &url, &archive, &format!("Downloading Java {} (first-time setup)", major)).await?;

  // Extract zip: it usually contains a single top-level directory; we flatten into base.
  let file = fs::File::open(&archive)?;
  let mut zip = zip::ZipArchive::new(file)?;
  for i in 0..zip.len() {
    let mut f = zip.by_index(i)?;
    let outpath = match f.enclosed_name() { Some(p) => p.to_owned(), None => continue };
    let mut parts = outpath.components();
    // drop first component (top folder)
    let _ = parts.next();
    let stripped: PathBuf = parts.collect();
    if stripped.as_os_str().is_empty() { continue; }
    let final_path = base.join(stripped);
    if f.is_dir() {
      fs::create_dir_all(&final_path).ok();
    } else {
      if let Some(parent) = final_path.parent() { fs::create_dir_all(parent).ok(); }
      let mut out = fs::File::create(&final_path)?;
      io::copy(&mut f, &mut out)?;
    }
  }
  let _ = fs::remove_file(&archive);

  if cfg!(windows) {
    let jw = base.join("bin").join("javaw.exe");
    if jw.exists() { return Ok(jw); }
  }

  if bin.exists() { Ok(bin) } else {
    anyhow::bail!("Java download finished but java executable not found in runtime folder.")
  }
}

fn required_java_major(version: &str) -> u32 {
  // Vanilla Minecraft Java requirements (major versions):
  // - <= 1.16.5  : Java 8
  // - 1.17–1.20.4: Java 17 (Java 16 works for 1.17, but 17 is fine and simpler)
  // - >= 1.20.5  : Java 21 (1.20.5/1.20.6 and 1.21+ are compiled for classfile 65)
  if mc_version_ge(version, "1.20.5") { 21 }
  else if mc_version_ge(version, "1.17") { 17 }
  else { 8 }
}



fn build_classpath(sep: &str, libs: &[PathBuf], client_jar: &Path) -> String {
  let mut parts: Vec<String> = libs.iter().map(|p| p.display().to_string()).collect();
  parts.push(client_jar.display().to_string());
  parts.join(sep)
}

fn replace_placeholders(s: &str, map: &HashMap<&str, String>) -> String {
  let mut out = s.to_string();
  for (k,v) in map {
    out = out.replace(k, v);
  }
  out
}

fn expand_arg_value(
  av: &ArgValue,
  placeholders: &HashMap<&str, String>,
  features: &HashMap<String, bool>
) -> Vec<String> {
  match av {
    ArgValue::Str(s) => vec![replace_placeholders(s, placeholders)],
    ArgValue::Obj { rules, value } => {
      if !rules_allow(rules, features) { return vec![]; }
      match value {
        serde_json::Value::String(s) => vec![replace_placeholders(s, placeholders)],
        serde_json::Value::Array(arr) => arr.iter().filter_map(|v| v.as_str()).map(|s| replace_placeholders(s, placeholders)).collect(),
        _ => vec![]
      }
    }
  }
}


#[tauri::command]
fn open_profile_folder(kind: String, version: String) -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;
  let path = match kind.as_str() {
    "vanilla" => game_dir.join("versions").join(&version),
    "fabric" => game_dir.join("fabric").join("versions").join(&version),
    _ => game_dir.join("versions").join(&version),
  };
  fs::create_dir_all(&path).ok();
  #[cfg(target_os="windows")]
  {
    std::process::Command::new("explorer").arg(path).spawn().map_err(|e| e.to_string())?;
    return Ok(());
  }
  #[cfg(not(target_os="windows"))]
  {
    return Err("Open folder not implemented for this OS yet.".into());
  }
}

// Opens MegaClient's game directory (the folder where mods/resourcepacks/etc live).
#[tauri::command]
fn open_game_folder() -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(game_dir.to_string_lossy().to_string())
      .spawn()
      .map_err(|e| e.to_string())?;
    return Ok(());
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open").arg(game_dir).spawn().map_err(|e| e.to_string())?;
    return Ok(());
  }
  #[cfg(not(any(target_os = "windows", target_os = "macos")))]
  {
    std::process::Command::new("xdg-open").arg(game_dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
  }
}


#[tauri::command]
fn list_instances() -> Result<Vec<Instance>, String> {
  let st = STATE.lock().unwrap();
  Ok(st.instances.clone())
}

fn set_rpc_activity(state: &str, details: &str) -> Result<(), String> {
  rpc_set_activity(Some(state), Some(details))
}


#[tauri::command]
fn get_selected_instance() -> Result<Option<Instance>, String> {
  let st = STATE.lock().unwrap();
  Ok(selected_instance(&st))
}

#[tauri::command]
fn select_instance(instance_id: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  if st.instances.iter().any(|i| i.id == instance_id) {
    st.selected_instance_id = Some(instance_id);
    st.save().map_err(|e| e.to_string())?;
    Ok(())
  } else {
    Err("Instance not found".into())
  }
}

#[tauri::command]
fn create_instance(name: String, mc_version: Option<String>, loader: String) -> Result<Instance, String> {
  let mut st = STATE.lock().unwrap();
  let id = uuid::Uuid::new_v4().to_string();
  let inst = Instance {
    id: id.clone(),
    name: { let n = name.trim().to_string(); if n.is_empty() { "Instance".to_string() } else { n } },
    mc_version,
    loader: normalize_loader(&loader).to_string(),
    created_at: Some(chrono::Utc::now().to_rfc3339()),
  };
  st.instances.push(inst.clone());
  st.selected_instance_id = Some(id);
  st.save().map_err(|e| e.to_string())?;
  Ok(inst)
}

#[tauri::command]
fn update_instance(instance_id: String, name: String, mc_version: Option<String>, loader: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  if let Some(i) = st.instances.iter_mut().find(|x| x.id == instance_id) {
    i.name = name.trim().to_string();
    i.mc_version = mc_version;
    i.loader = normalize_loader(&loader).to_string();
    st.save().map_err(|e| e.to_string())?;
    Ok(())
  } else {
    Err("Instance not found".into())
  }
}

#[tauri::command]
fn delete_instance(instance_id: String) -> Result<(), String> {
  let mut st = STATE.lock().unwrap();
  st.instances.retain(|i| i.id != instance_id);
  if st.selected_instance_id.as_deref() == Some(&instance_id) {
    st.selected_instance_id = st.instances.first().map(|i| i.id.clone());
  }
  st.save().map_err(|e| e.to_string())?;

  // Best-effort remove instance folder
  if let Ok(base_game) = AppState::base_game_dir() {
    let dir = AppState::instance_dir(&base_game, &instance_id);
    let _ = fs::remove_dir_all(dir);
  }
  Ok(())
}

#[derive(Serialize)]
struct InstanceMod {
  file: String,
  enabled: bool,
}

#[tauri::command]
fn list_instance_mods(instance_id: String) -> Result<Vec<InstanceMod>, String> {
  let base_game = AppState::base_game_dir().map_err(|e| e.to_string())?;
  let dir = AppState::instance_dir(&base_game, &instance_id).join("mods");
  fs::create_dir_all(&dir).ok();

  let mut out = vec![];
  if let Ok(rd) = fs::read_dir(&dir) {
    for ent in rd.flatten() {
      if let Ok(ft) = ent.file_type() {
        if !ft.is_file() { continue; }
      }
      let name = ent.file_name().to_string_lossy().to_string();
      if name.to_lowercase().ends_with(".jar") {
        out.push(InstanceMod { file: name, enabled: true });
      } else if name.to_lowercase().ends_with(".jar.disabled") {
        out.push(InstanceMod { file: name, enabled: false });
      }
    }
  }
  out.sort_by(|a,b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
  Ok(out)
}

fn normalize_mod_filename(file: &str) -> String {
  file.replace('\\', "/").split('/').last().unwrap_or(file).to_string()
}

#[tauri::command]
fn set_instance_mod_enabled(instance_id: String, file: String, enabled: bool) -> Result<(), String> {
  let base_game = AppState::base_game_dir().map_err(|e| e.to_string())?;
  let mods_dir = AppState::instance_dir(&base_game, &instance_id).join("mods");
  fs::create_dir_all(&mods_dir).ok();

  let file = normalize_mod_filename(&file);
  let src = mods_dir.join(&file);

  if enabled {
    // .jar.disabled -> .jar
    if file.to_lowercase().ends_with(".jar.disabled") {
      let target_name = file[..file.len()-".disabled".len()].to_string();
      let dst = mods_dir.join(&target_name);
      fs::rename(&src, &dst).map_err(|e| e.to_string())?;
      Ok(())
    } else {
      Ok(())
    }
  } else {
    // .jar -> .jar.disabled
    if file.to_lowercase().ends_with(".jar") && !file.to_lowercase().ends_with(".jar.disabled") {
      let dst = mods_dir.join(format!("{}.disabled", file));
      fs::rename(&src, &dst).map_err(|e| e.to_string())?;
      Ok(())
    } else {
      Ok(())
    }
  }
}

#[tauri::command]
fn delete_instance_mod(instance_id: String, file: String) -> Result<(), String> {
  let base_game = AppState::base_game_dir().map_err(|e| e.to_string())?;
  let mods_dir = AppState::instance_dir(&base_game, &instance_id).join("mods");
  fs::create_dir_all(&mods_dir).ok();
  let file = normalize_mod_filename(&file);
  let p = mods_dir.join(&file);
  if p.exists() {
    fs::remove_file(&p).map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn open_instance_folder(instance_id: String) -> Result<(), String> {
  let base_game = AppState::base_game_dir().map_err(|e| e.to_string())?;
  let dir = AppState::instance_dir(&base_game, &instance_id);
  fs::create_dir_all(&dir).ok();

  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(dir)
      .spawn()
      .map_err(|e| e.to_string())?;
    return Ok(());
  }
  #[cfg(not(target_os = "windows"))]
  {
    tauri::api::shell::open(&tauri::api::shell::ShellScope::default(), dir.to_string_lossy(), None)
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}


#[derive(Serialize, Deserialize, Clone)]
struct ModrinthVersion {
  id: String,
  files: Vec<ModrinthFile>,
  dependencies: Option<Vec<ModrinthDep>>,
  game_versions: Vec<String>,
  loaders: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ModrinthFile {
  url: String,
  filename: String,
  primary: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ModrinthDep {
  dependency_type: String,
  project_id: Option<String>,
  version_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct ModrinthHit {
  id: String,
  slug: String,
  title: String,
  description: String,
  downloads: u64,
  icon_url: Option<String>,
}

async fn modrinth_pick_version(project_id: &str, mc_version: &str, loader: Option<&str>) -> Result<ModrinthVersion, String> {
  let url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
  let client = reqwest::Client::new();
  let list: Vec<ModrinthVersion> = client
    .get(url)
    .header("User-Agent", "MegaClient")
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  let loader = loader.map(|l| l.to_ascii_lowercase());
  fn parse_mc(v: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = v.split('.').collect();
    if parts.len() < 2 { return None; }
    let major = parts[0].parse().ok()?;
    let minor = parts[1].parse().ok()?;
    let patch = if parts.len() >= 3 { parts[2].parse().unwrap_or(0) } else { 0 };
    Some((major, minor, patch))
  }

  let target = parse_mc(mc_version);

  for v in list {
    // Modrinth often lags behind patch releases (e.g., 1.21.11). If we can't find an
    // exact match, accept the closest compatible version within the same major.minor
    // where the mod supports a patch <= our target patch.
    let ok_version = if v.game_versions.iter().any(|gv| gv == mc_version) {
      true
    } else if let Some((maj, min, patch)) = target {
      v.game_versions.iter().any(|gv| {
        if let Some((gmaj, gmin, gpatch)) = parse_mc(gv) {
          gmaj == maj && gmin == min && gpatch <= patch
        } else {
          false
        }
      })
    } else {
      false
    };

    if !ok_version {
      continue;
    }
    if let Some(l) = loader.as_deref() {
      if l != "vanilla" {
        if !v.loaders.iter().any(|x| x.eq_ignore_ascii_case(l)) {
          continue;
        }
      }
    }
    return Ok(v);
  }

  Err(match loader.as_deref() {
    Some(l) if l != "vanilla" => format!("No compatible Modrinth version for Minecraft {} ({})", mc_version, l),
    _ => format!("No compatible Modrinth version for Minecraft {}", mc_version),
  })
}

async fn modrinth_download(url: &str, dest: &std::path::Path) -> Result<(), String> {
  let client = reqwest::Client::new();
  let bytes = client.get(url)
    .header("User-Agent", "MegaClient")
    .send().await.map_err(|e| e.to_string())?
    .bytes().await.map_err(|e| e.to_string())?;
  if let Some(p) = dest.parent() { std::fs::create_dir_all(p).ok(); }
  std::fs::write(dest, &bytes).map_err(|e| e.to_string())?;
  Ok(())
}

async fn modrinth_install_iterative(project_id: &str, mc_version: &str, mods_dir: &std::path::Path, loader: Option<&str>) -> Result<(), String> {
  use std::collections::{HashSet, VecDeque};

  let mut seen: HashSet<String> = HashSet::new();
  let mut queue: VecDeque<String> = VecDeque::new();
  queue.push_back(project_id.to_string());

  while let Some(pid) = queue.pop_front() {
    if seen.contains(&pid) { continue; }
    seen.insert(pid.clone());

    let v = modrinth_pick_version(&pid, mc_version, loader).await?;
    let file = v.files.iter().find(|f| f.primary).or_else(|| v.files.first()).ok_or("No download file")?;
    let dest = mods_dir.join(&file.filename);
    modrinth_download(&file.url, &dest).await?;

    if let Some(deps) = v.dependencies {
      for d in deps {
        if d.dependency_type != "required" { continue; }
        if let Some(dep_pid) = d.project_id {
          if !seen.contains(&dep_pid) { queue.push_back(dep_pid); }
        } else if let Some(vid) = d.version_id {
          let url = format!("https://api.modrinth.com/v2/version/{}", vid);
          let client = reqwest::Client::new();
          let vv: serde_json::Value = client.get(url).header("User-Agent","MegaClient")
            .send().await.map_err(|e| e.to_string())?
            .json().await.map_err(|e| e.to_string())?;
          if let Some(pid2) = vv.get("project_id").and_then(|x| x.as_str()) {
            let pid2 = pid2.to_string();
            if !seen.contains(&pid2) { queue.push_back(pid2); }
          }
        }
      }
    }
  }

  Ok(())
}

#[tauri::command]
async fn modrinth_search(query: String, kind: String, limit: Option<u32>, loader: Option<String>) -> Result<Vec<ModrinthHit>, String> {
  let limit = limit.unwrap_or(20).max(1).min(50);
  let kind = kind.to_ascii_lowercase();

  let project_type = match kind.as_str() {
    "mod" => "mod",
    "resourcepack" => "resourcepack",
    "shader" => "shader",
    "modpack" => "modpack",
    _ => "mod",
  };

  let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", project_type)]];

  // Optional loader filter (only meaningful for mods)
  if project_type == "mod" {
    if let Some(l) = loader.as_deref() {
      let nl = normalize_loader(l);
      if nl != "vanilla" {
        facets.push(vec![format!("categories:{}", nl)]);
      }
    }
  }

  let facets_str = serde_json::to_string(&facets).unwrap_or_else(|_| "[]".into());

  let url = format!(
    "https://api.modrinth.com/v2/search?query={}&limit={}&facets={}",
    urlencoding::encode(&query),
    limit,
    urlencoding::encode(&facets_str)
  );

  let client = reqwest::Client::new();
  let v: serde_json::Value = client
    .get(url)
    .header("User-Agent", "MegaClient")
    .send()
    .await
    .map_err(|e| e.to_string())?
    .json()
    .await
    .map_err(|e| e.to_string())?;

  let mut out = Vec::<ModrinthHit>::new();
  if let Some(hits) = v.get("hits").and_then(|x| x.as_array()) {
    for h in hits {
      let id = h.get("project_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
      if id.is_empty() { continue; }
      out.push(ModrinthHit {
        id,
        slug: h.get("slug").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        title: h.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        description: h.get("description").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        downloads: h.get("downloads").and_then(|x| x.as_u64()).unwrap_or(0),
        icon_url: h.get("icon_url").and_then(|x| x.as_str()).map(|s| s.to_string()),
      });
    }
  }

  Ok(out)
}

#[tauri::command]
async fn install_modrinth_project(project_id: String, mc_version: String, kind: Option<String>, loader: Option<String>) -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;

  let kind = kind.unwrap_or_else(|| "mod".into()).to_ascii_lowercase();
  let mc_version = resolve_mc_version_id(&mc_version).await?;

  let dest_dir = match kind.as_str() {
    "resourcepack" => game_dir.join("resourcepacks"),
    "shader" => game_dir.join("shaderpacks"),
    _ => game_dir.join("mods"),
  };
  std::fs::create_dir_all(&dest_dir).ok();

  // allow slug: resolve to id
  let pid = if project_id.len() < 12 {
    let url = format!("https://api.modrinth.com/v2/project/{}", project_id);
    let client = reqwest::Client::new();
    let v: serde_json::Value = client
      .get(url)
      .header("User-Agent", "MegaClient")
      .send()
      .await
      .map_err(|e| e.to_string())?
      .json()
      .await
      .map_err(|e| e.to_string())?;
    v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string()
  } else {
    project_id
  };

  if pid.is_empty() {
    return Err("Invalid Modrinth project id/slug".into());
  }

  let loader_norm = loader.as_deref().map(normalize_loader);
  let loader_filter = if kind == "mod" { loader_norm.as_deref() } else { None };

  modrinth_install_iterative(&pid, &mc_version, &dest_dir, loader_filter).await?;
  Ok(())
}

#[tauri::command]
async fn install_modrinth_pack(slugs: Vec<String>, mc_version: String, loader: Option<String>) -> Result<(), String> {
  let game_dir = current_game_dir().map_err(|e| e.to_string())?;
  let dest_dir = game_dir.join("mods");
  std::fs::create_dir_all(&dest_dir).ok();

  let mc_version = resolve_mc_version_id(&mc_version).await?;
  let loader_norm = loader.as_deref().map(normalize_loader);
  let loader_filter = loader_norm.as_deref();

  let mut _skipped: Vec<String> = Vec::new();

  for slug in slugs {
    let url = format!("https://api.modrinth.com/v2/project/{}", slug);
    let client = reqwest::Client::new();
	  let resp = match client
	    .get(url)
	    .header("User-Agent", "MegaClient")
	    .send()
	    .await {
	      Ok(r) => r,
	      Err(e) => { _skipped.push(format!("{}: {}", slug, e)); continue; }
	    };
	  if !resp.status().is_success() {
	    _skipped.push(format!("{}: not found", slug));
	    continue;
	  }
	  let v: serde_json::Value = match resp.json().await {
	    Ok(v) => v,
	    Err(e) => { _skipped.push(format!("{}: {}", slug, e)); continue; }
	  };
    if let Some(pid) = v.get("id").and_then(|x| x.as_str()) {
      if let Err(e) = modrinth_install_iterative(pid, &mc_version, &dest_dir, loader_filter).await {
        // Don't hard-fail an entire pack when a single mod doesn't have a compatible
        // version yet (common on fresh patch releases). We still install what we can.
        _skipped.push(format!("{}: {}", slug, e));
      }
    } else {
      _skipped.push(format!("{}: not found", slug));
    }
  }

  Ok(())
}

#[tauri::command]
async fn launch_game(window: tauri::Window, instance_id: String) -> Result<(), String> {
  // Tell the UI immediately so the user sees feedback even if downloads take time.
  let _ = window.emit("mc:launching", "Preparing game...");

  
  // Load instance config
  let instance = {
    let state = STATE.lock().unwrap();
    state.instances.iter().find(|i| i.id == instance_id).cloned()
  }.ok_or_else(|| "Instance not found".to_string())?;
  let version = instance.mc_version.clone().unwrap_or_else(|| "latest".to_string());
  let _loader = instance.loader.clone();
// Resolve the instance directory ASAP so we can always create a log file and avoid silent hangs.
  let base_dir = AppState::base_game_dir().map_err(|e| e.to_string())?;
  let game_dir = base_dir.join("instances").join(&instance_id);
  fs::create_dir_all(&game_dir).ok();
  let versions_dir = game_dir.join("versions");
  let assets_dir = game_dir.join("assets");
  fs::create_dir_all(&versions_dir).ok();
  fs::create_dir_all(&assets_dir.join("indexes")).ok();

  // Create the launch log immediately (even if we later hang on a network request).
  let logs_dir = game_dir.join("launcher_logs");
  let _ = fs::create_dir_all(&logs_dir);
  let log_path = logs_dir.join("last_launch.log");
  set_log_path(log_path.clone());
  let _ = fs::write(&log_path, format!(
    "MegaClient launch started at {}\n",
    chrono::Utc::now().to_rfc3339()
  ));
  append_log("Stage: start");

  // Only scan mods for Fabric instances.
  // Vanilla should not create a mods folder or spend time scanning it.
  if instance.loader.to_lowercase() == "fabric" {
    let _ = window.emit("mc:launching", "Checking mods...");
    append_log("Checking mods...");
    scan_mods_and_block_in(&game_dir.join("mods"))?;
  } else {
    // If an old run created an empty mods folder, clean it up for vanilla.
    let mods_dir = game_dir.join("mods");
    if mods_dir.exists() {
      if let Ok(mut rd) = fs::read_dir(&mods_dir) {
        if rd.next().is_none() {
          let _ = fs::remove_dir(&mods_dir);
        }
      }
    }
  }

  // (dirs already created above)

  // Resolve "latest" -> actual release id
  append_log("Stage: resolve version");
  let _ = window.emit("mc:launching", "Resolving version...");
  let mc_version = resolve_mc_version_id(&version).await?;

  append_log("Stage: fetch manifest");
  let _ = window.emit("mc:launching", "Fetching version manifest...");
  let manifest = fetch_manifest().await?;
  let vref = manifest
    .versions
    .into_iter()
    .find(|v| v.id == mc_version)
    .ok_or_else(|| format!("Version not found in manifest: {}", mc_version))?;

  // Base version json (vanilla)
  append_log("Stage: download version metadata");
  let _ = window.emit("mc:launching", format!("Downloading version metadata ({})...", mc_version));
  let base_json_path = versions_dir.join(&mc_version).join(format!("{}.json", &mc_version));
  if !base_json_path.exists() {
    download_to_progress(&window, &vref.url, &base_json_path, &format!("Downloading version metadata ({})", mc_version)).await.map_err(|e| e.to_string())?;
  }

  let vjson: VersionJson =
    serde_json::from_slice(&fs::read(&base_json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  // Keep the vanilla metadata around for client.jar download even when using modloaders.
  let base_vjson = vjson.clone();
  let mut launch_vjson = vjson.clone();
  let launch_version_id = mc_version.clone();

  // Apply loader profile (Fabric). Vanilla uses the base version json.
  match instance.loader.to_lowercase().as_str() {
    "fabric" => {
      append_log("Stage: setup fabric");
      let _ = window.emit("mc:launching", format!("Setting up Fabric ({})...", mc_version));
      let (_fabric_id, profile) = ensure_fabric_profile(&mc_version, &versions_dir).await?;
      // Fabric profile provides its own main class and additional libraries.
      launch_vjson.main_class = Some(profile.main_class.clone());
      // Merge libraries (keep vanilla first, then Fabric libs)
      for lib in profile.libraries.into_iter() {
        launch_vjson.libraries.push(lib);
      }
      // Prefer modern arguments from Fabric profile when available.
      if let Some(args) = profile.arguments {
        launch_vjson.arguments = Some(args);
      }
    }
    "vanilla" | "" => {
      // vanilla uses base version json
    }
    other => {
      // Keep the launcher stable: only Vanilla + Fabric are supported.
      return Err(format!("Unsupported loader '{other}'. MegaClient currently supports only Vanilla and Fabric.").into());
    }
  }

  // Base client jar (used for Vanilla and Fabric)
  append_log("Stage: download client");
  let _ = window.emit("mc:launching", format!("Downloading client ({})...", mc_version));
  let base_client_jar_path = versions_dir.join(&mc_version).join(format!("{}.jar", &mc_version));
  if !base_client_jar_path.exists() {
    let label = format!("Downloading client ({})", mc_version);
    // Primary URL from version JSON
    let client_dl = base_vjson.downloads.as_ref().ok_or_else(|| "Missing client downloads in version json".to_string())?;
    let primary = client_dl.client.url.clone();
    let sha1_opt = client_dl.client.sha1.clone();

    // Try primary first
    if let Err(e) = download_to_progress(&window, &primary, &base_client_jar_path, &label).await {
      // Fallback mirror used by older launchers (requires sha1 from manifest)
      if let Some(sha1) = sha1_opt {
        let fallback = format!("https://launcher.mojang.com/v1/objects/{}/client.jar", sha1);
        let msg = format!("{} failed, trying fallback mirror...", label);
        let _ = window.emit("mc:launching", msg.clone());
        append_log(&msg);

        download_to_progress(&window, &fallback, &base_client_jar_path, &label)
          .await
          .map_err(|e2| format!(
            "Client download failed. Primary: {}\nFallback: {}\n\nLast error: {}",
            primary, fallback, e2
          ))?;
      } else {
        return Err(format!(
          "Client download failed and no sha1 was provided by the version manifest. Last error: {}",
          e
        ));
      }
    }
  }

  // Integrity / anti-tamper: if Mojang provided a sha1, verify the downloaded client.jar.
  if let Some(dl) = base_vjson.downloads.as_ref() {
    if let Some(expected) = dl.client.sha1.clone() {
      if let Ok(actual) = sha1_file(&base_client_jar_path) {
        if actual.to_lowercase() != expected.to_lowercase() {
          return Err(format!(
            "Client jar hash mismatch (possible modified client).\nExpected: {}\nActual:   {}",
            expected, actual
          ));
        }
      }
    }
  }

  // Loader + join server
  let join_host = {
    let st = STATE.lock().unwrap();
    st.join_server.clone()
  };

  // Finalize version json used for launching.
  let mut vjson = launch_vjson;
  // If the loader profile inherits from vanilla, merge missing fields from vanilla.
  if let Some(parent_id) = vjson.inherits_from.clone() {
    if parent_id == mc_version {
      vjson = merge_version_json(base_vjson.clone(), vjson);
    } else {
      if let Ok(parent) = load_version_json_cached(&window, &parent_id, &versions_dir).await {
        vjson = merge_version_json(parent, vjson);
      }
    }
  }

  // Determine launch id (affects natives dir + ${version_name})
  let launch_id = launch_version_id.clone();

  // Assets index (from base)
  append_log("Stage: download asset index");
  let _ = window.emit("mc:log_line", "[Launcher] Stage: Downloading asset index".to_string());
  append_log("Downloading asset index...");
  let _ = window.emit("mc:launching", "Downloading asset index...");
  let asset_ref = vjson_asset_index(&vjson)?;
  let asset_index_path = assets_dir
    .join("indexes")
    .join(format!("{}.json", asset_ref.id));
  if !asset_index_path.exists() {
    download_to_progress(&window, &asset_ref.url, &asset_index_path, "Asset index")
      .await
      .map_err(|e| e.to_string())?;
  }

  #[derive(Deserialize)]
  struct AssetIndex {
    objects: HashMap<String, AssetObj>,
  }
  #[derive(Deserialize)]
  struct AssetObj {
    hash: String,
  }

  let idx: AssetIndex =
    serde_json::from_slice(&fs::read(&asset_index_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

  let objects_root = assets_dir.join("objects");
  fs::create_dir_all(&objects_root).ok();

  // Assets download (can be large on first launch)
  append_log("Stage: download assets");
  let _ = window.emit("mc:log_line", "[Launcher] Stage: Downloading assets".to_string());

  use futures_util::{stream, StreamExt};
  use std::sync::atomic::{AtomicUsize, Ordering};
  use std::time::Duration;

  // Add a timeout so a single stalled connection doesn't hang the whole launch.
  let http = reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .build()
    .map_err(|e| e.to_string())?;
  let assets: Vec<(String, PathBuf)> = idx
    .objects
    .values()
    .map(|o| {
      let h = o.hash.clone();
      let sub = &h[0..2];
      let url = format!("https://resources.download.minecraft.net/{}/{}", sub, h);
      let dest = objects_root.join(sub).join(&h);
      (url, dest)
    })
    .collect();

  // Emit progress so the UI doesn't look frozen.
  let total_assets = assets.len();
  let done_assets = std::sync::Arc::new(AtomicUsize::new(0));
  let w_progress = window.clone();
  let _ = w_progress.emit(
    "mc:launching",
    format!(
      "Downloading assets (0/{})… First launch can take a few minutes.",
      total_assets
    ),
  );

  stream::iter(assets.into_iter())
    .map(|(url, dest)| {
      let http = http.clone();
      let done_assets = done_assets.clone();
      let w_progress = w_progress.clone();
      async move {
        if dest.exists() {
          let n = done_assets.fetch_add(1, Ordering::Relaxed) + 1;
          if n % 50 == 0 || n == total_assets {
            let _ = w_progress.emit(
              "mc:launching",
              format!("Downloading assets... ({}/{})", n, total_assets),
            );
            if n % 500 == 0 || n == total_assets {
              append_log(&format!("Downloading assets... ({}/{})", n, total_assets));
              let _ = w_progress.emit(
                "mc:log_line",
                format!("[Assets] ({}/{})", n, total_assets),
              );
            }
          }
          return Ok::<(), anyhow::Error>(());
        }
        if let Some(parent) = dest.parent() {
          fs::create_dir_all(parent).ok();
        }
        // Small retry helps transient CDN failures.
        let mut last_err: Option<anyhow::Error> = None;
        for _ in 0..3 {
          match http.get(&url).send().await {
            Ok(r) => match r.error_for_status() {
              Ok(ok) => {
                let bytes = ok.bytes().await?;
                fs::write(&dest, &bytes)?;
                let n = done_assets.fetch_add(1, Ordering::Relaxed) + 1;
                if n % 50 == 0 || n == total_assets {
                  let _ = w_progress.emit(
                    "mc:launching",
                    format!("Downloading assets... ({}/{})", n, total_assets),
                  );
                  if n % 500 == 0 || n == total_assets {
                    append_log(&format!("Downloading assets... ({}/{})", n, total_assets));
                    let _ = w_progress.emit(
                      "mc:log_line",
                      format!("[Assets] ({}/{})", n, total_assets),
                    );
                  }
                }
                last_err = None;
                break;
              }
              Err(e) => last_err = Some(e.into()),
            },
            Err(e) => last_err = Some(e.into()),
          }
        }

        if let Some(e) = last_err {
          return Err(e);
        }

        Ok(())
      }
    })
    .buffer_unordered(8)
    .collect::<Vec<_>>()
    .await
    .into_iter()
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("Asset download failed: {}", e))?;

  append_log("Stage: download libraries");
  let _ = window.emit("mc:launching", "Downloading libraries...");
  let _ = window.emit("mc:log_line", "[Launcher] Stage: Downloading libraries".to_string());
// Download libraries + extract natives
  let natives_dir = game_dir.join("natives").join(&launch_id);
  let mut classpath_libs: Vec<PathBuf> = vec![];

  // Feature flags used by Mojang rules. Missing features are treated as false by rules_allow().
  let features: HashMap<String, bool> = features_for_loader(&instance.loader);

  for lib in &vjson.libraries {
    if !rules_allow(&lib.rules, &features) {
      continue;
    }
    // Mojang-style resolved downloads
    if let Some(dl) = &lib.downloads {
      if let Some(art) = &dl.artifact {
        let jar_path = make_lib_path(&game_dir, &art.path);
        if !jar_path.exists() {
          download_to_progress(&window, &art.url, &jar_path, &format!("Library {}", art.path)).await.map_err(|e| e.to_string())?;
        }
        classpath_libs.push(jar_path);
      }
      if let (Some(natives), Some(classifiers)) = (&lib.natives, &dl.classifiers) {
        if let Some(classifier_key) = natives.get("windows") {
          if let Some(native_art) = classifiers.get(classifier_key) {
            let jar_path = make_lib_path(&game_dir, &native_art.path);
            if !jar_path.exists() {
              download_to_progress(&window, &native_art.url, &jar_path, &format!("Native {}", native_art.path)).await.map_err(|e| e.to_string())?;
            }
            extract_natives(&jar_path, &natives_dir).map_err(|e| e.to_string())?;
          }
        }
      }
      continue;
    }

    // Maven-coordinate libraries (Fabric profiles, etc.)
    if let Some(name) = &lib.name {
      if let Some(repo_path) = maven_coord_to_repo_path(name) {
        let jar_path = make_lib_path(&game_dir, &repo_path);
        download_maven_artifact(
          &window,
          lib.url.as_deref(),
          &repo_path,
          &jar_path,
          &format!("Library {}", repo_path),
        ).await?;
        classpath_libs.push(jar_path);
      }

      // Some profiles specify natives with Maven coordinates too (rare for Fabric, but supported).
      if let Some(natives) = &lib.natives {
        if let Some(classifier_key) = natives.get("windows") {
          if let Some(native_path) = maven_coord_to_repo_path_with_classifier(name, classifier_key) {
            let jar_path = make_lib_path(&game_dir, &native_path);
            download_maven_artifact(
              &window,
              lib.url.as_deref(),
              &native_path,
              &jar_path,
              &format!("Native {}", native_path),
            ).await?;
            extract_natives(&jar_path, &natives_dir).map_err(|e| e.to_string())?;
          }
        }
      }
    }
  }

  append_log("Stage: ensure java");
  let _ = window.emit("mc:log_line", "[Launcher] Stage: Ensuring Java runtime".to_string());

  // Ensure Java runtime
  let java = ensure_java_runtime(&window, required_java_major(&mc_version))
    .await
    .map_err(|e| e.to_string())?;

  // Auth details
  let (uuid, username, access_token) = {
    let st = STATE.lock().unwrap();
    let mut uuid = st
      .mc_uuid
      .clone()
      .ok_or_else(|| "Not logged in. Please add a Microsoft account first.".to_string())?;
    if uuid.len() == 32 {
      uuid = format!(
        "{}-{}-{}-{}-{}",
        &uuid[0..8],
        &uuid[8..12],
        &uuid[12..16],
        &uuid[16..20],
        &uuid[20..32]
      );
    }
    let username = st
      .mc_username
      .clone()
      .ok_or_else(|| "Not logged in. Please add a Microsoft account first.".to_string())?;
    let token = st
      .mc_access_token
      .clone()
      .ok_or_else(|| "Not logged in. Please add a Microsoft account first.".to_string())?;
    (uuid, username, token)
  };

  // Placeholder map
  let mut placeholders: HashMap<&str, String> = HashMap::new();
  placeholders.insert("${auth_player_name}", username.clone());
  placeholders.insert("${version_name}", launch_id.clone());
  placeholders.insert("${game_directory}", game_dir.display().to_string());
  placeholders.insert("${assets_root}", assets_dir.display().to_string());
    // Mojang version json uses `assets` for the asset index name (e.g. "legacy").
    placeholders.insert("${assets_index_name}", vjson.assets_index.clone().unwrap_or_else(|| "legacy".to_string()));
  placeholders.insert("${auth_uuid}", uuid);
  placeholders.insert("${auth_access_token}", access_token.clone());
  placeholders.insert("${user_type}", "msa".to_string());
    placeholders.insert("${version_type}", vjson.vtype.clone().unwrap_or_else(|| "release".to_string()));
  placeholders.insert("${natives_directory}", natives_dir.display().to_string());
  placeholders.insert("${launcher_name}", "MegaClient".to_string());
  placeholders.insert("${launcher_version}", env!("CARGO_PKG_VERSION").to_string());

  let cp_sep = if cfg!(windows) { ";" } else { ":" };
  placeholders.insert("${classpath_separator}", cp_sep.to_string());

  let classpath = build_classpath(cp_sep, &classpath_libs, &base_client_jar_path);
  placeholders.insert("${classpath}", classpath.clone());

  // Build args
  let mut jvm_args: Vec<String> = vec![
    "-Xms256M".to_string(),
    "-Xmx2048M".to_string(),
    format!("-Djava.library.path={}", natives_dir.display()),
  ];
  let mut game_args: Vec<String> = vec![];

  // Feature flags for Mojang's argument rules.
  // Anything not set is treated as false.
  let features: HashMap<String, bool> = features_for_loader(&instance.loader);

  if let Some(args) = &vjson.arguments {
    for av in &args.jvm {
      jvm_args.extend(expand_arg_value(av, &placeholders, &features));
    }
    for av in &args.game {
      game_args.extend(expand_arg_value(av, &placeholders, &features));
    }
  } else if let Some(legacy) = &vjson.minecraft_arguments {
    for part in legacy.split_whitespace() {
      game_args.push(replace_placeholders(part, &placeholders));
    }
  } else {
    return Err("Unsupported version json format (no arguments found)".into());
  }

  // Safety: strip any quick play args from the version json unless we explicitly add them.
  // (Older MegaClient versions mistakenly included multiple quick play options due to
  // incomplete rule evaluation, which causes Minecraft to crash during arg parsing.)
  let mut cleaned: Vec<String> = Vec::with_capacity(game_args.len());
  let mut i = 0usize;
  while i < game_args.len() {
    let a = &game_args[i];
    if a.starts_with("--quickPlay") || a.contains("${quickPlay") {
      // Quick play options always take a value; skip the next arg too if present.
      i += 1;
      if i < game_args.len() { i += 1; }
      continue;
    }
    cleaned.push(a.clone());
    i += 1;
  }
  game_args = cleaned;

  // One-click join server (if set)
  if let Some(host) = join_host {
    let mut host_part = host.clone();
    let mut port: u16 = 25565;
    if let Some((h, p)) = host.split_once(':') {
      host_part = h.to_string();
      if let Ok(pp) = p.parse::<u16>() {
        port = pp;
      }
    }
    // Minecraft 1.20+ replaced --server/--port with Quick Play.
    // We keep the old args for older versions.
    if mc_version_ge(&mc_version, "1.20") {
      if !game_args.iter().any(|a| a == "--quickPlayMultiplayer") {
        game_args.push("--quickPlayMultiplayer".into());
        game_args.push(format!("{}:{}", host_part, port));
      }
    } else {
      if !game_args.iter().any(|a| a == "--server") {
        game_args.push("--server".into());
        game_args.push(host_part);
      }
      if !game_args.iter().any(|a| a == "--port") {
        game_args.push("--port".into());
        game_args.push(port.to_string());
      }
    }
  }

  let main_class = vjson_main_class(&vjson)?;

  // Launch directly (Pandora-style pipeline, but without any wrapper).

  let mut cmd = Command::new(java);
  cmd.current_dir(&game_dir);
  for a in jvm_args {
    cmd.arg(a);
  }
  cmd.arg("-cp").arg(classpath);
  cmd.arg(&main_class);
  for a in &game_args {
    cmd.arg(a);
  }
  cmd.stdout(std::process::Stdio::piped());
  cmd.stderr(std::process::Stdio::piped());

  append_log("Stage: spawning java");
  let _ = window.emit("mc:log_line", "[Launcher] Spawning Java...".to_string());

  let mut child = cmd
    .spawn()
    .map_err(|e| format!("Failed to start Java. If this is the first launch, wait for Java to download. Error: {}", e))?;

  // (no stdin protocol; we pass args directly)

  // Stream stdout/stderr to UI and log file
  let w_out = window.clone();
  let w_err = window.clone();
  let log_path_clone = log_path.clone();

  if let Some(stdout) = child.stdout.take() {
    tauri::async_runtime::spawn(async move {
      let mut lines = BufReader::new(stdout).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        append_log(&line);
        let _ = w_out.emit("mc:log_line", line);
      }
    });
  }
  if let Some(stderr) = child.stderr.take() {
    tauri::async_runtime::spawn(async move {
      let mut lines = BufReader::new(stderr).lines();
      while let Ok(Some(line)) = lines.next_line().await {
        append_log(&line);
        let _ = w_err.emit("mc:log_line", line);
      }
    });
  }

  // Notify UI that the process started.
  let _ = window.emit("mc:started", "Minecraft launched");
  let _ = window.hide();

  let w = window.clone();
  tauri::async_runtime::spawn(async move {
    let _ = set_rpc_activity("Playing Minecraft", "In-game");
    let status = child.wait().await;
    let _ = set_rpc_activity("In MegaClient", "Launcher");
    let _ = w.show();
    let _ = w.set_focus();
    if let Ok(st) = status {
      let code = st.code().unwrap_or(-1);
      let _ = w.emit("mc:exited", format!("Minecraft closed (exit code {}).", code));
      append_log(&format!("[Launcher] Minecraft exited with code {}", code));
    } else {
      let _ = w.emit("mc:exited", "Minecraft closed.".to_string());
      append_log("[Launcher] Minecraft exited.");
    }
    // ensure log path touched
    let _ = fs::OpenOptions::new().create(true).append(true).open(&log_path_clone);
  });

  Ok(())
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      // Show a Feather/Lunar-style splash screen (season themed) while the UI loads.
      // The React app will call the `close_splash` command once mounted.
      let app_handle = app.handle();
      if let Some(main) = app.get_window("main") {
        let _ = main.hide();
      }

      let _ = tauri::WindowBuilder::new(
        app,
        "splash",
        WindowUrl::App("splash.html".into()),
      )
      .title("MegaClient")
      .decorations(false)
      .transparent(true)
      .always_on_top(true)
      .skip_taskbar(true)
      .resizable(false)
      .inner_size(640.0, 360.0)
      .center()
      .build();

      // Safety net: if the frontend fails to call `close_splash`, don't leave users stuck.
      // NOTE: tauri v1 doesn't expose an async `sleep` helper, so we use a small detached thread.
      std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        if let Some(s) = app_handle.get_window("splash") {
          let _ = s.close();
        }
        if let Some(m) = app_handle.get_window("main") {
          let _ = m.show();
          let _ = m.set_focus();
        }
      });

      // If the UI ever shows as a blank/black window in dev, devtools will reveal console errors.
      #[cfg(debug_assertions)]
      {
        if let Some(w) = app.get_window("main") {
          let _ = w.open_devtools();
        }
      }
      Ok(())
    })
    .on_window_event(|event| {
      use tauri::WindowEvent;
      // Ensure Discord RPC shuts down when the launcher closes.
      if let WindowEvent::CloseRequested { .. } = event.event() {
        rpc_clear();
      }
    })
    .invoke_handler(tauri::generate_handler![
      list_versions,
      get_selected_version,
      set_selected_version,
      get_selected_loader,
      set_selected_loader,
      scan_mods_and_block,
      launch_game,
      set_join_server,
      open_microsoft_login,
      rpc_enable,
      rpc_set_state,
      rpc_disable,
      start_microsoft_auth_code,
      finish_microsoft_auth_code,
      get_current_account,
      logout_account,
      open_url,
      close_splash,
      open_version_files,
      get_news_items,
      get_news,
      get_launcher_updates,
      get_server_icon,
      modrinth_search,
      open_game_folder,
      open_profile_folder,
      install_modrinth_project,
            install_modrinth_pack,
      list_instances,
      get_selected_instance,
      select_instance,
      create_instance,
      update_instance,
      delete_instance,
      list_instance_mods,
      set_instance_mod_enabled,
      delete_instance_mod,
      open_instance_folder
])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
