use std::{sync::Arc, time::Duration as StdDuration};

use chrono::{Duration, Utc};
use parking_lot::Mutex;
use tauri::{
    AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::{
    commands::app::{load_account_records, save_account_records},
    error::{message, AppResult},
    models::{AccountRecord, AccountSummary},
    services::auth,
    state::AppState,
};

const RECONNECT_REQUIRED: &str = "Microsoft reauthentication is required.";

fn canonical_account_id(value: &str) -> String {
    auth::canonical_account_id(value)
}

fn find_account_index(records: &[AccountRecord], account_id: &str) -> Option<usize> {
    let requested = canonical_account_id(account_id);
    records
        .iter()
        .position(|record| canonical_account_id(&record.summary.id) == requested)
}

fn secret_cache_key(account_id: &str, kind: &str) -> String {
    format!("{}:{kind}", canonical_account_id(account_id))
}

fn cache_secret(state: &AppState, account_ids: &[&str], kind: &str, value: &str) {
    let mut cache = state.auth_secrets.lock();
    for account_id in account_ids {
        cache.insert(secret_cache_key(account_id, kind), value.to_string());
    }
}

fn read_account_secret(state: &AppState, record: &AccountRecord, kind: &str) -> AppResult<String> {
    let ids = [record.summary.id.as_str(), record.uuid.as_str()];
    {
        let cache = state.auth_secrets.lock();
        for account_id in ids {
            if let Some(value) = cache.get(&secret_cache_key(account_id, kind)) {
                if !value.trim().is_empty() {
                    return Ok(value.clone());
                }
            }
        }
    }

    let mut last_error = None;
    for account_id in ids {
        match auth::read_secret(account_id, kind) {
            Ok(value) if !value.trim().is_empty() => {
                cache_secret(state, &ids, kind, &value);
                let _ = auth::store_fallback_secret(
                    &state.paths.auth_vault,
                    account_id,
                    kind,
                    &value,
                );
                return Ok(value);
            }
            Ok(_) => continue,
            Err(error) => last_error = Some(error),
        }
    }

    for account_id in ids {
        match auth::read_fallback_secret(&state.paths.auth_vault, account_id, kind) {
            Ok(value) if !value.trim().is_empty() => {
                cache_secret(state, &ids, kind, &value);
                let _ = auth::store_secret(account_id, kind, &value);
                return Ok(value);
            }
            Ok(_) => continue,
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| message("No saved account credential was found.")))
}

fn store_account_secret(
    state: &AppState,
    account_ids: &[&str],
    kind: &str,
    value: &str,
) -> AppResult<()> {
    let primary_id = account_ids
        .first()
        .copied()
        .ok_or_else(|| message("The account identifier is missing."))?;
    let keyring_result = auth::store_secret(primary_id, kind, value);
    let fallback_result = auth::store_fallback_secret(
        &state.paths.auth_vault,
        primary_id,
        kind,
        value,
    );
    if keyring_result.is_err() && fallback_result.is_err() {
        return Err(message(format!(
            "MegaClient could not persist the Microsoft session: {}; {}",
            keyring_result.unwrap_err(),
            fallback_result.unwrap_err()
        )));
    }
    cache_secret(state, account_ids, kind, value);
    Ok(())
}

fn clear_account_secrets(state: &AppState, record: &AccountRecord) {
    let ids = [record.summary.id.as_str(), record.uuid.as_str()];
    {
        let mut cache = state.auth_secrets.lock();
        for account_id in ids {
            cache.remove(&secret_cache_key(account_id, "minecraft-access"));
            cache.remove(&secret_cache_key(account_id, "microsoft-refresh"));
        }
    }
    for account_id in ids {
        let _ = auth::delete_secret(account_id, "minecraft-access");
        let _ = auth::delete_secret(account_id, "microsoft-refresh");
        let _ = auth::delete_fallback_secret(
            &state.paths.auth_vault,
            account_id,
            "minecraft-access",
        );
        let _ = auth::delete_fallback_secret(
            &state.paths.auth_vault,
            account_id,
            "microsoft-refresh",
        );
    }
}

pub(crate) fn repair_active_account(
    state: &AppState,
    records: &mut Vec<AccountRecord>,
) -> AppResult<()> {
    let original_len = records.len();
    let mut deduplicated: Vec<AccountRecord> = Vec::with_capacity(original_len);
    for record in records.drain(..) {
        if let Some(index) = find_account_index(&deduplicated, &record.summary.id) {
            if record.summary.active || !deduplicated[index].summary.active {
                deduplicated[index] = record;
            }
        } else {
            deduplicated.push(record);
        }
    }
    *records = deduplicated;

    let active_indices = records
        .iter()
        .enumerate()
        .filter_map(|(index, record)| record.summary.active.then_some(index))
        .collect::<Vec<_>>();

    let mut changed = records.len() != original_len;
    if active_indices.len() > 1 {
        let keep = active_indices[0];
        for (index, record) in records.iter_mut().enumerate() {
            let active = index == keep;
            if record.summary.active != active {
                record.summary.active = active;
                changed = true;
            }
        }
    } else if active_indices.is_empty() && !records.is_empty() {
        // Older builds could leave every saved account inactive. Always repair
        // that state so bootstrap has a deterministic account to restore.
        records[0].summary.active = true;
        changed = true;
    }

    if changed {
        save_account_records(state, records)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sign_in_microsoft(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<AccountSummary> {
    // Sign-in and refresh both rotate credentials. Keeping them serialized avoids
    // one request invalidating credentials that another request has just saved.
    let _auth_guard = state.auth_gate.lock().await;
    let client_id = auth::resolve_client_id()
        .ok_or_else(|| message("Microsoft sign-in is not configured in this build."))?;
    let csrf_state = Uuid::new_v4().simple().to_string();
    let authorize_url = auth::authorization_url(client_id, &csrf_state)?;

    if let Some(existing) = app.get_webview_window("microsoft-auth") {
        let _ = existing.close();
    }

    let (sender, receiver) = oneshot::channel::<Result<String, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let navigation_sender = Arc::clone(&sender);
    let expected_state = csrf_state.clone();

    let auth_window = WebviewWindowBuilder::new(
        &app,
        "microsoft-auth",
        WebviewUrl::External(authorize_url),
    )
    .title("Sign in to Microsoft")
    .inner_size(520.0, 720.0)
    .min_inner_size(440.0, 620.0)
    .resizable(true)
    .center()
    // Keep Microsoft's normal webview session so a reconnect can reuse the
    // selected account instead of behaving like a brand-new private browser.
    .incognito(false)
    .on_navigation(move |url| {
        if let Some(result) = auth::parse_authorization_redirect(url, &expected_state) {
            if let Some(sender) = navigation_sender.lock().take() {
                let _ = sender.send(result);
            }
            return false;
        }
        auth::is_trusted_auth_navigation(url)
    })
    .build()
    .map_err(|error| message(format!("Could not open the Microsoft sign-in window: {error}")))?;

    let close_sender = Arc::clone(&sender);
    auth_window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(sender) = close_sender.lock().take() {
                let _ = sender.send(Err("Microsoft sign-in was cancelled.".into()));
            }
        }
    });

    let authorization_result = tokio::time::timeout(StdDuration::from_secs(10 * 60), receiver)
        .await
        .map_err(|_| message("Microsoft sign-in timed out. Please try again."))
        .and_then(|result| {
            result.map_err(|_| message("Microsoft sign-in window closed unexpectedly."))
        })
        .and_then(|result| result.map_err(message));

    let _ = auth_window.close();
    let authorization = authorization_result?;

    let oauth = auth::exchange_authorization_code(&state.http, client_id, &authorization).await?;
    save_authenticated_account(&state, oauth).await
}

async fn save_authenticated_account(
    state: &AppState,
    oauth: auth::TokenResponse,
) -> AppResult<AccountSummary> {
    let refresh_token = oauth
        .refresh_token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| message("Microsoft could not create a reusable session. Please try once more."))?;
    let (record, minecraft_access, _) = auth::microsoft_to_minecraft(&state.http, &oauth).await?;
    let ids = [record.summary.id.as_str(), record.uuid.as_str()];

    store_account_secret(state, &ids, "minecraft-access", &minecraft_access)?;
    if let Err(error) = store_account_secret(state, &ids, "microsoft-refresh", &refresh_token) {
        clear_account_secrets(state, &record);
        return Err(error);
    }

    let mut records = load_account_records(state)?;
    for existing in &mut records {
        existing.summary.active = false;
    }
    if let Some(index) = find_account_index(&records, &record.summary.id) {
        records[index] = record.clone();
    } else {
        records.push(record.clone());
    }
    save_account_records(state, &records)?;
    Ok(record.summary)
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> AppResult<Vec<AccountSummary>> {
    let mut records = load_account_records(&state)?;
    repair_active_account(&state, &mut records)?;
    Ok(records.into_iter().map(|item| item.summary).collect())
}

#[tauri::command]
pub fn switch_account(
    state: State<'_, AppState>,
    account_id: String,
) -> AppResult<Vec<AccountSummary>> {
    let mut records = load_account_records(&state)?;
    repair_active_account(&state, &mut records)?;
    let index = find_account_index(&records, &account_id)
        .or_else(|| (records.len() == 1).then_some(0))
        .ok_or_else(|| message("That saved account is no longer available."))?;
    for (record_index, item) in records.iter_mut().enumerate() {
        item.summary.active = record_index == index;
    }
    save_account_records(&state, &records)?;
    Ok(records.into_iter().map(|item| item.summary).collect())
}

#[tauri::command]
pub fn remove_account(
    state: State<'_, AppState>,
    account_id: String,
) -> AppResult<Vec<AccountSummary>> {
    let mut records = load_account_records(&state)?;
    let index = find_account_index(&records, &account_id)
        .ok_or_else(|| message("That saved account is no longer available."))?;
    let removed = records.remove(index);
    if removed.summary.active {
        for record in &mut records {
            record.summary.active = false;
        }
        if let Some(first) = records.first_mut() {
            first.summary.active = true;
        }
    }
    clear_account_secrets(&state, &removed);
    save_account_records(&state, &records)?;
    Ok(records.into_iter().map(|item| item.summary).collect())
}

#[tauri::command]
pub async fn restore_active_account(state: State<'_, AppState>) -> AppResult<AccountSummary> {
    let (record, _) = active_session(&state).await?;
    Ok(record.summary)
}

pub async fn active_session(state: &AppState) -> AppResult<(AccountRecord, String)> {
    let _auth_guard = state.auth_gate.lock().await;
    let mut records = load_account_records(state)?;
    repair_active_account(state, &mut records)?;
    let index = records
        .iter()
        .position(|item| item.summary.active)
        .ok_or_else(|| message("Sign in with Microsoft to continue."))?;
    let current = records[index].clone();
    let still_valid = current
        .summary
        .expires_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|expires| expires.with_timezone(&Utc) > Utc::now() + Duration::minutes(5))
        .unwrap_or(false);

    if let Ok(access) = read_account_secret(state, &current, "minecraft-access") {
        if still_valid {
            return Ok((current, access));
        }

        // Only an explicit 401/403 means the token must be refreshed. Network
        // or service failures are surfaced as temporary errors and never erase
        // a valid saved Microsoft session.
        match auth::inspect_profile(&state.http, &access).await? {
            auth::ProfileTokenState::Valid(profile) => {
                let mut verified = current.clone();
                verified.summary.name = profile.name.clone();
                verified.summary.avatar_url =
                    format!("https://mc-heads.net/avatar/{}/80", profile.id);
                verified.summary.expires_at =
                    Some((Utc::now() + Duration::minutes(30)).to_rfc3339());
                records[index] = verified.clone();
                save_account_records(state, &records)?;
                return Ok((verified, access));
            }
            auth::ProfileTokenState::Unauthorized => {}
        }
    }

    let client_id = auth::resolve_client_id()
        .ok_or_else(|| message("Microsoft sign-in is unavailable in this build."))?;
    let refresh = read_account_secret(state, &current, "microsoft-refresh")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| message(RECONNECT_REQUIRED))?;

    let oauth = match auth::refresh_microsoft(&state.http, client_id, &refresh).await {
        Ok(value) => value,
        Err(error) => {
            let details = error.to_string().to_ascii_lowercase();
            if details.contains("invalid_grant")
                || details.contains("interaction_required")
                || details.contains("expired token")
                || details.contains("token has been revoked")
            {
                clear_account_secrets(state, &current);
                records[index].summary.expires_at = None;
                save_account_records(state, &records)?;
                return Err(message(RECONNECT_REQUIRED));
            }
            return Err(error);
        }
    };

    let next_refresh = oauth
        .refresh_token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(refresh);
    let (mut refreshed, minecraft_access, _) =
        auth::microsoft_to_minecraft(&state.http, &oauth).await?;
    refreshed.summary.active = true;
    let refreshed_ids = [refreshed.summary.id.as_str(), refreshed.uuid.as_str()];
    store_account_secret(state, &refreshed_ids, "minecraft-access", &minecraft_access)?;
    store_account_secret(state, &refreshed_ids, "microsoft-refresh", &next_refresh)?;

    if canonical_account_id(&current.summary.id) != canonical_account_id(&refreshed.summary.id) {
        clear_account_secrets(state, &current);
        // Re-cache the new credentials because the old and new identifiers can
        // share a credential key after canonicalization.
        cache_secret(state, &refreshed_ids, "minecraft-access", &minecraft_access);
        cache_secret(state, &refreshed_ids, "microsoft-refresh", &next_refresh);
    }

    records[index] = refreshed.clone();
    save_account_records(state, &records)?;
    Ok((refreshed, minecraft_access))
}
