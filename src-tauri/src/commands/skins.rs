use std::path::PathBuf;

use reqwest::multipart::{Form, Part};
use tauri::State;

use crate::{
    commands::auth as auth_commands,
    error::{message, AppResult},
    models::SkinProfile,
    services::auth,
    state::AppState,
};

#[tauri::command]
pub async fn get_skin_profile(state: State<'_, AppState>) -> AppResult<SkinProfile> {
    let (_, access) = auth_commands::active_session(&state).await?;
    let profile = auth::fetch_profile(&state.http, &access).await?;
    let mut skin_profile = auth::map_skin_profile(&profile);
    auth::hydrate_skin_profile_images(&state.http, &mut skin_profile).await;
    Ok(skin_profile)
}

#[tauri::command]
pub async fn upload_skin(state: State<'_, AppState>, path: String, variant: String) -> AppResult<bool> {
    let path = PathBuf::from(path);
    if path.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("png")) != Some(true) { return Err(message("Minecraft skins must be PNG files.")); }
    let bytes = tokio::fs::read(&path).await?;
    if bytes.len() > 2 * 1024 * 1024 { return Err(message("The selected skin is unexpectedly large.")); }
    let (_, access) = auth_commands::active_session(&state).await?;
    let model = if variant.eq_ignore_ascii_case("slim") { "slim" } else { "classic" };
    let part = Part::bytes(bytes).file_name("skin.png").mime_str("image/png").map_err(|error| message(error.to_string()))?;
    let form = Form::new().text("variant", model.to_string()).part("file", part);
    state.http.post("https://api.minecraftservices.com/minecraft/profile/skins").bearer_auth(access).multipart(form).send().await?.error_for_status()?;
    Ok(true)
}

#[tauri::command]
pub async fn reset_skin(state: State<'_, AppState>) -> AppResult<bool> {
    let (_, access) = auth_commands::active_session(&state).await?;
    state.http.delete("https://api.minecraftservices.com/minecraft/profile/skins/active").bearer_auth(access).send().await?.error_for_status()?;
    Ok(true)
}

#[tauri::command]
pub async fn set_cape(state: State<'_, AppState>, cape_id: Option<String>) -> AppResult<bool> {
    let (_, access) = auth_commands::active_session(&state).await?;
    let response = if let Some(cape_id) = cape_id {
        state.http.put("https://api.minecraftservices.com/minecraft/profile/capes/active").bearer_auth(access).json(&serde_json::json!({ "capeId": cape_id })).send().await?
    } else {
        state.http.delete("https://api.minecraftservices.com/minecraft/profile/capes/active").bearer_auth(access).send().await?
    };
    response.error_for_status()?;
    Ok(true)
}
