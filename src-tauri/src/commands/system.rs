use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    error::AppResult,
    models::{JavaRuntime, UiProgressEvent},
    services::java,
    state::AppState,
};

#[tauri::command]
pub async fn detect_java(
    state: State<'_, AppState>,
    minecraft_version: Option<String>,
) -> AppResult<Vec<JavaRuntime>> {
    let runtimes = match minecraft_version.as_deref() {
        Some(version) => {
            let major = java::required_java_major(&state.http, version).await;
            java::detect_for_major(&state.paths.managed_java, major)
        }
        None => java::detect(None, &state.paths.managed_java),
    };

    Ok(runtimes)
}

#[tauri::command]
pub async fn install_java(app: AppHandle, state: State<'_, AppState>, major: u32) -> AppResult<JavaRuntime> {
    let id = Uuid::new_v4().to_string();
    let _ = app.emit("launcher://progress", UiProgressEvent { id: id.clone(), kind: "java".into(), label: format!("Installing Java {major}"), detail: "Downloading Eclipse Temurin runtime…".into(), percent: 10.0, bytes_per_second: 0, done: false });
    let runtime = java::install(&state.http, major, &state.paths.managed_java).await?;
    java::prepend_to_path(std::path::Path::new(&runtime.path));
    let _ = app.emit("launcher://progress", UiProgressEvent { id, kind: "java".into(), label: format!("Java {major} ready"), detail: runtime.path.clone(), percent: 100.0, bytes_per_second: 0, done: true });
    Ok(runtime)
}
