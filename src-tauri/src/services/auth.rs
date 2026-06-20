use std::{collections::HashMap, fs, path::Path, thread, time::Duration as StdDuration};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{Duration, Utc};
use reqwest::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Client, Response, StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    error::{message, AppResult},
    models::{AccountRecord, AccountSummary, Cape, SkinProfile},
};

const AUTHORIZE_URL: &str = "https://login.live.com/oauth20_authorize.srf";
const LIVE_TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";
const REDIRECT_URL: &str = "https://login.live.com/oauth20_desktop.srf";
const OAUTH_SCOPE: &str = "XboxLive.signin offline_access";
const XBOX_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";
const MC_ENTITLEMENTS_URL: &str = "https://api.minecraftservices.com/entitlements/mcstore";

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    error: String,
    error_description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct XboxResponse {
    #[serde(rename = "Token")]
    token: String,
    #[serde(rename = "DisplayClaims")]
    claims: XboxClaims,
}

#[derive(Debug, Deserialize)]
struct XboxClaims {
    xui: Vec<XuiClaim>,
}

#[derive(Debug, Deserialize)]
struct XuiClaim {
    uhs: String,
}

#[derive(Debug, Deserialize)]
struct MinecraftLoginResponse {
    access_token: String,
    expires_in: i64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct MinecraftProfileResponse {
    pub(crate) id: String,
    pub(crate) name: String,
    skins: Option<Vec<MinecraftSkin>>,
    capes: Option<Vec<MinecraftCape>>,
}

#[derive(Debug, Deserialize, Clone)]
struct MinecraftSkin {
    url: String,
    variant: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct MinecraftCape {
    id: String,
    alias: String,
    url: String,
    state: Option<String>,
}

/// The public desktop OAuth identifier used by the official Minecraft launcher flow.
/// Public desktop client identifiers are not secrets; no client secret is bundled.
const BUILTIN_MICROSOFT_CLIENT_ID: &str = "00000000402b5328";

pub fn resolve_client_id() -> Option<&'static str> {
    option_env!("MEGACLIENT_MICROSOFT_CLIENT_ID")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(Some(BUILTIN_MICROSOFT_CLIENT_ID))
}

pub fn authorization_url(client_id: &str, csrf_state: &str) -> AppResult<Url> {
    if client_id.trim().is_empty() {
        return Err(message("Microsoft sign-in is not configured in this build."));
    }

    let mut url = Url::parse(AUTHORIZE_URL)
        .map_err(|error| message(format!("Could not build the Microsoft sign-in URL: {error}")))?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URL)
        .append_pair("scope", OAUTH_SCOPE)
        .append_pair("prompt", "select_account")
        .append_pair("state", csrf_state)
        .append_pair("mkt", "en-US");
    Ok(url)
}

pub fn parse_authorization_redirect(url: &Url, expected_state: &str) -> Option<Result<String, String>> {
    if url.scheme() != "https"
        || url.host_str() != Some("login.live.com")
        || url.path() != "/oauth20_desktop.srf"
    {
        return None;
    }

    let value = |key: &str| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    };

    if let Some(error) = value("error") {
        let description = value("error_description").unwrap_or(error);
        return Some(Err(description));
    }

    if value("state").as_deref() != Some(expected_state) {
        return Some(Err("Microsoft sign-in returned an invalid security state. Please try again.".into()));
    }

    Some(
        value("code")
            .filter(|code| !code.trim().is_empty())
            .ok_or_else(|| "Microsoft sign-in finished without an authorization code.".into()),
    )
}

pub fn is_trusted_auth_navigation(url: &Url) -> bool {
    if url.scheme() == "about" {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    host == "microsoft.com"
        || host.ends_with(".microsoft.com")
        || host == "microsoftonline.com"
        || host.ends_with(".microsoftonline.com")
        || host == "live.com"
        || host.ends_with(".live.com")
}

async fn decode_token_response(response: Response, context: &str) -> AppResult<TokenResponse> {
    let status = response.status();
    let body = response.text().await?;
    if status.is_success() {
        return serde_json::from_str::<TokenResponse>(&body)
            .map_err(|error| message(format!("{context} returned an invalid response: {error}")));
    }

    let details = serde_json::from_str::<OAuthError>(&body)
        .map(|value| value.error_description.unwrap_or(value.error))
        .unwrap_or_else(|_| format!("HTTP {}", status.as_u16()));
    Err(message(format!("{context}: {details}")))
}

pub async fn exchange_authorization_code(
    http: &Client,
    client_id: &str,
    code: &str,
) -> AppResult<TokenResponse> {
    let response = http
        .post(LIVE_TOKEN_URL)
        .form(&[
            ("client_id", client_id),
            ("code", code),
            ("grant_type", "authorization_code"),
            ("redirect_uri", REDIRECT_URL),
        ])
        .send()
        .await?;
    decode_token_response(response, "Microsoft sign-in failed").await
}

pub async fn microsoft_to_minecraft(
    http: &Client,
    oauth: &TokenResponse,
) -> AppResult<(AccountRecord, String, SkinProfile)> {
    let xbox = http
        .post(XBOX_AUTH_URL)
        .json(&json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", oauth.access_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<XboxResponse>()
        .await?;
    let uhs = xbox
        .claims
        .xui
        .first()
        .ok_or_else(|| message("Xbox authentication returned no user hash."))?
        .uhs
        .clone();
    let xsts = http
        .post(XSTS_URL)
        .json(&json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbox.token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<XboxResponse>()
        .await?;
    let mc = http
        .post(MC_LOGIN_URL)
        .json(&json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, xsts.token) }))
        .send()
        .await?
        .error_for_status()?
        .json::<MinecraftLoginResponse>()
        .await?;

    let entitlement = http
        .get(MC_ENTITLEMENTS_URL)
        .bearer_auth(&mc.access_token)
        .send()
        .await?
        .error_for_status()?
        .json::<serde_json::Value>()
        .await?;
    let owns_game = entitlement
        .get("items")
        .and_then(|value| value.as_array())
        .is_some_and(|items| !items.is_empty());
    if !owns_game {
        return Err(message(
            "This Microsoft account does not appear to own Minecraft: Java Edition.",
        ));
    }

    let profile = fetch_profile(http, &mc.access_token).await?;
    let expires_at = Utc::now() + Duration::seconds(mc.expires_in);
    let summary = AccountSummary {
        id: profile.id.clone(),
        name: profile.name.clone(),
        avatar_url: format!("https://mc-heads.net/avatar/{}/80", profile.id),
        active: true,
        expires_at: Some(expires_at.to_rfc3339()),
    };
    let skin_profile = map_skin_profile(&profile);
    Ok((
        AccountRecord {
            summary,
            uuid: profile.id,
        },
        mc.access_token,
        skin_profile,
    ))
}

pub async fn refresh_microsoft(
    http: &Client,
    client_id: &str,
    refresh_token: &str,
) -> AppResult<TokenResponse> {
    let response = http
        .post(LIVE_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("redirect_uri", REDIRECT_URL),
            ("scope", OAUTH_SCOPE),
        ])
        .send()
        .await?;
    decode_token_response(response, "Microsoft session refresh failed").await
}

pub(crate) enum ProfileTokenState {
    Valid(MinecraftProfileResponse),
    Unauthorized,
}

pub(crate) async fn inspect_profile(
    http: &Client,
    access_token: &str,
) -> AppResult<ProfileTokenState> {
    let response = http
        .get(MC_PROFILE_URL)
        .bearer_auth(access_token)
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .await?;
    let status = response.status();
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return Ok(ProfileTokenState::Unauthorized);
    }
    if !status.is_success() {
        return Err(message(format!(
            "Minecraft services are temporarily unavailable (HTTP {}).",
            status.as_u16()
        )));
    }
    Ok(ProfileTokenState::Valid(response.json().await?))
}

pub async fn fetch_profile(
    http: &Client,
    access_token: &str,
) -> AppResult<MinecraftProfileResponse> {
    match inspect_profile(http, access_token).await? {
        ProfileTokenState::Valid(profile) => Ok(profile),
        ProfileTokenState::Unauthorized => Err(message("Minecraft rejected the current access token.")),
    }
}

pub fn map_skin_profile(profile: &MinecraftProfileResponse) -> SkinProfile {
    let active_skin = profile.skins.as_ref().and_then(|items| {
        items
            .iter()
            .find(|item| is_active_state(item.state.as_deref()))
            .or_else(|| items.first())
    });
    SkinProfile {
        id: profile.id.clone(),
        name: profile.name.clone(),
        skin_url: active_skin.map(|skin| skin.url.clone()),
        skin_variant: active_skin
            .and_then(|skin| skin.variant.clone())
            .unwrap_or_else(|| "CLASSIC".into())
            .to_lowercase(),
        capes: profile
            .capes
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|cape| Cape {
                id: cape.id,
                alias: cape.alias,
                url: cape.url,
                active: is_active_state(cape.state.as_deref()),
            })
            .collect(),
    }
}

fn is_active_state(state: Option<&str>) -> bool {
    state.is_some_and(|value| value.eq_ignore_ascii_case("ACTIVE"))
}

/// Converts Mojang texture URLs to data URLs before they cross the Tauri IPC
/// boundary. This avoids WebView hot-link, cache, and certificate-policy
/// differences that otherwise make skins and capes appear blank on some
/// systems. Only the trusted Minecraft texture host is fetched.
pub async fn hydrate_skin_profile_images(http: &Client, profile: &mut SkinProfile) {
    if let Some(url) = profile.skin_url.clone() {
        if let Some(data_url) = texture_data_url(http, &url).await {
            profile.skin_url = Some(data_url);
        }
    }

    for cape in &mut profile.capes {
        if let Some(data_url) = texture_data_url(http, &cape.url).await {
            cape.url = data_url;
        }
    }
}

async fn texture_data_url(http: &Client, value: &str) -> Option<String> {
    let normalized = if let Some(path) = value.strip_prefix("http://textures.minecraft.net") {
        format!("https://textures.minecraft.net{path}")
    } else {
        value.to_string()
    };
    let url = Url::parse(&normalized).ok()?;
    if url.scheme() != "https" || url.host_str() != Some("textures.minecraft.net") {
        return None;
    }

    let response = http.get(url).send().await.ok()?.error_for_status().ok()?;
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png")
        .to_string();
    let bytes = response.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return None;
    }
    Some(format!(
        "data:{content_type};base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}


#[derive(Debug, Default, Serialize, Deserialize)]
struct EncryptedCredentialVault {
    #[serde(default)]
    secrets: HashMap<String, String>,
}

fn vault_key(account_id: &str, kind: &str) -> String {
    format!("{}:{kind}", canonical_account_id(account_id))
}

fn read_vault(path: &Path) -> AppResult<EncryptedCredentialVault> {
    if !path.exists() {
        return Ok(EncryptedCredentialVault::default());
    }
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_vault(path: &Path, vault: &EncryptedCredentialVault) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(vault)?)?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(temporary, path)?;
    Ok(())
}

/// Stores a current-user encrypted fallback copy of a credential. Windows
/// Credential Manager remains the primary store, while DPAPI prevents a
/// temporary keyring failure from forcing players through OAuth on every run.
pub fn store_fallback_secret(
    path: &Path,
    account_id: &str,
    kind: &str,
    value: &str,
) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(message("MegaClient refused to save an empty account credential."));
    }
    let protected = protect_for_current_user(value.as_bytes())?;
    let mut vault = read_vault(path)?;
    vault
        .secrets
        .insert(vault_key(account_id, kind), BASE64_STANDARD.encode(protected));
    write_vault(path, &vault)
}

pub fn read_fallback_secret(path: &Path, account_id: &str, kind: &str) -> AppResult<String> {
    let vault = read_vault(path)?;
    let encoded = vault
        .secrets
        .get(&vault_key(account_id, kind))
        .ok_or_else(|| message("No encrypted fallback credential was found."))?;
    let protected = BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| message(format!("Saved account credential is damaged: {error}")))?;
    let clear = unprotect_for_current_user(&protected)?;
    String::from_utf8(clear)
        .map_err(|_| message("Saved account credential is not valid UTF-8."))
}

pub fn delete_fallback_secret(path: &Path, account_id: &str, kind: &str) -> AppResult<()> {
    let mut vault = read_vault(path)?;
    if vault.secrets.remove(&vault_key(account_id, kind)).is_some() {
        write_vault(path, &vault)?;
    }
    Ok(())
}

#[cfg(windows)]
fn protect_for_current_user(value: &[u8]) -> AppResult<Vec<u8>> {
    windows_dpapi::protect(value)
}

#[cfg(windows)]
fn unprotect_for_current_user(value: &[u8]) -> AppResult<Vec<u8>> {
    windows_dpapi::unprotect(value)
}

#[cfg(not(windows))]
fn protect_for_current_user(_value: &[u8]) -> AppResult<Vec<u8>> {
    Err(message("The encrypted credential fallback is only required on Windows."))
}

#[cfg(not(windows))]
fn unprotect_for_current_user(_value: &[u8]) -> AppResult<Vec<u8>> {
    Err(message("The encrypted credential fallback is only required on Windows."))
}

#[cfg(windows)]
mod windows_dpapi {
    use std::{ffi::c_void, ptr, slice};

    use crate::error::{message, AppResult};

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            data_in: *const DataBlob,
            description: *const u16,
            optional_entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *const c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
        fn CryptUnprotectData(
            data_in: *const DataBlob,
            description: *mut *mut u16,
            optional_entropy: *const DataBlob,
            reserved: *mut c_void,
            prompt: *const c_void,
            flags: u32,
            data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }

    pub fn protect(value: &[u8]) -> AppResult<Vec<u8>> {
        let length = u32::try_from(value.len())
            .map_err(|_| message("Account credential is too large to protect."))?;
        let input = DataBlob {
            cb_data: length,
            pb_data: value.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };
        let result = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        copy_and_free(result, output, "protect")
    }

    pub fn unprotect(value: &[u8]) -> AppResult<Vec<u8>> {
        let length = u32::try_from(value.len())
            .map_err(|_| message("Saved account credential is too large."))?;
        let input = DataBlob {
            cb_data: length,
            pb_data: value.as_ptr() as *mut u8,
        };
        let mut output = DataBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };
        let mut description: *mut u16 = ptr::null_mut();
        let result = unsafe {
            CryptUnprotectData(
                &input,
                &mut description,
                ptr::null(),
                ptr::null_mut(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if !description.is_null() {
            unsafe { LocalFree(description.cast()) };
        }
        copy_and_free(result, output, "restore")
    }

    fn copy_and_free(result: i32, output: DataBlob, operation: &str) -> AppResult<Vec<u8>> {
        if result == 0 {
            return Err(message(format!(
                "Windows could not {operation} the saved Microsoft session: {}",
                std::io::Error::last_os_error()
            )));
        }
        if output.pb_data.is_null() || output.cb_data == 0 {
            return Err(message(format!(
                "Windows returned an empty credential while trying to {operation} it."
            )));
        }
        let bytes = unsafe {
            slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec()
        };
        unsafe { LocalFree(output.pb_data.cast()) };
        Ok(bytes)
    }
}

const CREDENTIAL_SERVICE: &str = "studio.megastudios.megaclient";

pub fn canonical_account_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| *character != '-')
        .collect::<String>()
        .trim()
        .to_ascii_lowercase()
}

fn hyphenated_account_id(value: &str) -> Option<String> {
    let canonical = canonical_account_id(value);
    if canonical.len() != 32 || !canonical.chars().all(|character| character.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!(
        "{}-{}-{}-{}-{}",
        &canonical[0..8],
        &canonical[8..12],
        &canonical[12..16],
        &canonical[16..20],
        &canonical[20..32]
    ))
}

fn account_id_candidates(account_id: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut push = |value: String| {
        if !value.is_empty() && !values.iter().any(|existing| existing == &value) {
            values.push(value);
        }
    };
    push(canonical_account_id(account_id));
    push(account_id.trim().to_string());
    if let Some(hyphenated) = hyphenated_account_id(account_id) {
        push(hyphenated.clone());
        push(hyphenated.to_ascii_uppercase());
    }
    push(account_id.trim().to_ascii_uppercase());
    values
}

fn exact_secret(account_id: &str, kind: &str) -> AppResult<keyring::Entry> {
    Ok(keyring::Entry::new(
        CREDENTIAL_SERVICE,
        &format!("{account_id}:{kind}"),
    )?)
}

pub fn secret(account_id: &str, kind: &str) -> AppResult<keyring::Entry> {
    exact_secret(&canonical_account_id(account_id), kind)
}

fn retry_get_password(entry: &keyring::Entry) -> Result<String, keyring::Error> {
    let mut last_error = None;
    for delay_ms in [0_u64, 45, 120, 260] {
        if delay_ms > 0 {
            thread::sleep(StdDuration::from_millis(delay_ms));
        }
        match entry.get_password() {
            Ok(value) => return Ok(value),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("credential read attempted"))
}

fn retry_set_password(entry: &keyring::Entry, value: &str) -> Result<(), keyring::Error> {
    let mut last_error = None;
    for delay_ms in [0_u64, 45, 120, 260] {
        if delay_ms > 0 {
            thread::sleep(StdDuration::from_millis(delay_ms));
        }
        match entry.set_password(value) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.expect("credential write attempted"))
}

pub fn store_secret(account_id: &str, kind: &str, value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(message("MegaClient refused to save an empty account credential."));
    }
    let entry = secret(account_id, kind)?;
    retry_set_password(&entry, value)?;
    let verified = retry_get_password(&entry)?;
    if verified != value {
        return Err(message("The system credential vault could not verify the saved Microsoft session."));
    }
    Ok(())
}

pub fn read_secret(account_id: &str, kind: &str) -> AppResult<String> {
    let canonical = canonical_account_id(account_id);
    let mut last_error = None;
    for candidate in account_id_candidates(account_id) {
        let entry = exact_secret(&candidate, kind)?;
        match retry_get_password(&entry) {
            Ok(value) if !value.trim().is_empty() => {
                if candidate != canonical {
                    let _ = store_secret(&canonical, kind, &value);
                }
                return Ok(value);
            }
            Ok(_) => continue,
            Err(error) => last_error = Some(error),
        }
    }
    match last_error {
        Some(error) => Err(error.into()),
        None => Err(message("No saved account credential was found.")),
    }
}

pub fn delete_secret(account_id: &str, kind: &str) -> AppResult<()> {
    for candidate in account_id_candidates(account_id) {
        if let Ok(entry) = exact_secret(&candidate, kind) {
            let _ = entry.delete_credential();
        }
    }
    Ok(())
}
