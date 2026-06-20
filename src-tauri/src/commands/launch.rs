use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};

use chrono::Utc;
use mc_launcher_core::prelude::*;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    commands::{app::{load_settings, shared_directory}, auth as auth_commands, instances},
    error::{message, AppError, AppResult},
    models::{ConsoleLine, GameStatus, LaunchRequest, UiProgressEvent},
    services::{java, runtime},
    state::AppState,
};

#[tauri::command]
pub async fn install_version(app: AppHandle, state: State<'_, AppState>, instance_id: String) -> AppResult<bool> {
    let instance = instances::find(&state, &instance_id)?;
    let settings = load_settings(&state)?;
    let required_java = java::required_java_major(&state.http, &instance.minecraft_version).await;
    let java_path = ensure_java_runtime(
        &app,
        &state,
        &settings.java_path,
        required_java,
    )
    .await?;
    configure_installer_java(&java_path, &instance);
    let shared = shared_directory(&state)?;
    let version_id = install_for_instance(app.clone(), shared.clone(), instance).await?;
    let downloaded = ensure_metadata_libraries(&state.http, &shared, &version_id).await?;
    if downloaded > 0 {
        push_console(
            &app,
            &state,
            "info",
            format!("Downloaded {downloaded} missing loader libraries."),
        );
    }
    Ok(true)
}

#[tauri::command]
pub async fn launch_game(app: AppHandle, state: State<'_, AppState>, request: LaunchRequest) -> AppResult<bool> {
    {
        let game = state.game.lock();
        if game.is_some() { return Err(message("Minecraft is already running.")); }
    }
    let mut instance = instances::find(&state, &request.instance_id)?;
    let settings = load_settings(&state)?;
    let (account_record, access_token) = auth_commands::active_session(&state).await?;

    begin_launch(&app, &state, &instance.id)?;
    let preliminary_java = java::required_java_major(&state.http, &instance.minecraft_version).await;
    let installer_java = ensure_java_runtime(
        &app,
        &state,
        &settings.java_path,
        preliminary_java,
    )
    .await
    .map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    configure_installer_java(&installer_java, &instance);

    let shared = shared_directory(&state).map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    let version_id = install_for_instance(app.clone(), shared.clone(), instance.clone()).await
        .map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    let downloaded = ensure_metadata_libraries(&state.http, &shared, &version_id)
        .await
        .map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    if downloaded > 0 {
        push_console(
            &app,
            &state,
            "info",
            format!("Downloaded {downloaded} missing loader libraries."),
        );
    }
    let required_java = installed_java_major(shared.clone(), version_id.clone(), preliminary_java)
        .await
        .map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    let java_path = ensure_java_runtime(
        &app,
        &state,
        &settings.java_path,
        required_java,
    )
    .await
    .map_err(|error| fail_launch(&app, &state, &instance.id, error))?;
    if !settings.java_path.trim().is_empty()
        && Path::new(settings.java_path.trim()) != java_path.as_path()
    {
        push_console(
            &app,
            &state,
            "warn",
            format!(
                "Configured Java was not compatible with this Minecraft version; using Java {required_java} at {}.",
                java_path.display()
            ),
        );
    }
    set_status(&app, &state, GameStatus { state: "launching".into(), instance_id: Some(instance.id.clone()), pid: None, started_at: None, message: Some(format!("Building Java {required_java} command")) });
    let game_directory = PathBuf::from(&instance.directory);
    let account = Account::Microsoft { username: account_record.summary.name.clone(), uuid: account_record.uuid.clone(), access_token };
    let resolution = Some((settings.width, settings.height));
    let server = request.server.map(|host| (host, request.port));
    let min_ram = settings.min_ram_mb;
    let max_ram = settings.max_ram_mb;

    let launch_result = tokio::task::spawn_blocking(move || -> AppResult<LaunchCommand> {
        let launcher = Launcher::new(shared);
        let version = launcher.load_version(&version_id)?;
        let mut command = launcher.build_launch_command_from_version(&version, LaunchOptions {
            account,
            java_executable: Some(java_path),
            game_directory: Some(game_directory.clone()),
            launcher_name: "MegaClient".into(),
            launcher_version: env!("CARGO_PKG_VERSION").into(),
            custom_resolution: resolution,
            server,
            ..Default::default()
        })?;
        let mut tuned = vec![
            format!("-Xms{}M", min_ram),
            format!("-Xmx{}M", max_ram),
            "-XX:+UseG1GC".into(),
            "-XX:+ParallelRefProcEnabled".into(),
            "-XX:MaxGCPauseMillis=50".into(),
            "-XX:+UnlockExperimentalVMOptions".into(),
            "-XX:+DisableExplicitGC".into(),
            "-XX:G1NewSizePercent=20".into(),
            "-XX:G1ReservePercent=20".into(),
            "-XX:InitiatingHeapOccupancyPercent=15".into(),
            "-Dfile.encoding=UTF-8".into(),
        ];
        // This option is only understood by newer JDKs. It can be injected by
        // third-party version metadata or a custom profile, but runtimes such as
        // Java 21 reject it before the game can start. MegaClient does not rely
        // on it, so drop it safely.
        command.args.retain(|arg| arg.as_str() != UNSUPPORTED_UNSAFE_MEMORY_OPTION);
        tuned.extend(command.args);
        command.args = tuned;
        Ok(command)
    }).await;
    let launch = match launch_result {
        Ok(Ok(command)) => command,
        Ok(Err(error)) => return Err(fail_launch(&app, &state, &instance.id, error)),
        Err(error) => return Err(fail_launch(&app, &state, &instance.id, message(error.to_string()))),
    };

    std::fs::create_dir_all(&launch.working_dir)
        .map_err(|error| fail_launch(&app, &state, &instance.id, error.into()))?;
    let mut process = Command::new(&launch.executable);
    process.args(&launch.args).current_dir(&launch.working_dir).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    sanitize_inherited_java_options(&mut process);
    for (key, value) in launch.env {
        if JAVA_OPTION_ENV_VARS.contains(&key.as_str()) {
            set_sanitized_java_option_env(&mut process, &key, value.into());
        } else {
            process.env(key, value);
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        process.creation_flags(0x08000000);
    }
    let mut child = process.spawn().map_err(|error| {
        fail_launch(&app, &state, &instance.id, message(format!("Unable to start Java at {}: {error}", launch.executable.display())))
    })?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *state.game.lock() = Some(child);
    state.console.lock().clear();
    let started_at = Utc::now();
    let status = GameStatus { state: "running".into(), instance_id: Some(instance.id.clone()), pid: Some(pid), started_at: Some(started_at.to_rfc3339()), message: Some("Minecraft is running".into()) };
    set_status(&app, &state, status);
    runtime::attach_output(app.clone(), stdout, stderr);
    runtime::monitor_child(app.clone(), instance.id.clone(), Instant::now());

    instance.last_played_at = Some(started_at.to_rfc3339());
    if let Err(error) = instances::persist(&state, &instance) {
        push_console(&app, &state, "warn", format!("Minecraft started, but play metadata could not be saved: {error}"));
    }
    push_console(&app, &state, "info", format!("Started {} with Java {} (PID {pid}).", instance.name, launch.executable.display()));
    if settings.minimize_while_playing {
        // Keep the Tauri process alive while Minecraft is running, but move the
        // launcher out of the way. Minimizing (rather than hiding or exiting)
        // keeps tray/taskbar behavior predictable and lets the window restore
        // cleanly when the game process ends.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.minimize();
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn kill_game(app: AppHandle, state: State<'_, AppState>) -> AppResult<bool> {
    let current = state.status.lock().clone();
    if state.game.lock().is_none() {
        set_status(&app, &state, GameStatus { state: "idle".into(), instance_id: current.instance_id, pid: None, started_at: None, message: Some("No Minecraft process is running".into()) });
        return Ok(false);
    }
    set_status(&app, &state, GameStatus { state: "stopping".into(), instance_id: current.instance_id.clone(), pid: current.pid, started_at: current.started_at.clone(), message: Some("Stopping Minecraft".into()) });
    let result = state.game.lock().as_mut().is_some_and(|child| child.kill().is_ok());
    if result {
        push_console(&app, &state, "warn", "Stop requested by user.".into());
    } else {
        set_status(&app, &state, GameStatus { state: "error".into(), instance_id: current.instance_id, pid: current.pid, started_at: current.started_at, message: Some("Minecraft could not be stopped".into()) });
    }
    Ok(result)
}

#[tauri::command]
pub fn game_status(state: State<'_, AppState>) -> GameStatus { state.status.lock().clone() }

#[tauri::command]
pub fn get_console_lines(state: State<'_, AppState>) -> Vec<ConsoleLine> { state.console.lock().clone() }

async fn install_for_instance(app: AppHandle, shared: PathBuf, instance: crate::models::InstanceProfile) -> AppResult<String> {
    let task_id = Uuid::new_v4().to_string();
    let app_for_task = app.clone();
    tokio::task::spawn_blocking(move || -> AppResult<String> {
        let launcher = Launcher::new(shared);
        let loader = loader_spec(&instance.loader, instance.loader_version.as_deref())?;
        let request = InstallRequest { minecraft_version: instance.minecraft_version.clone(), loader, java: JavaInstallPolicy::Auto };
        let mut finished = 0u32;
        let mut reporter = |event: mc_launcher_core::progress::ProgressEvent| {
            let (label, detail, bump) = match event {
                mc_launcher_core::progress::ProgressEvent::StageStarted { stage } => ("Preparing Minecraft".to_string(), format!("{stage:?}"), 2.0),
                mc_launcher_core::progress::ProgressEvent::TaskStarted { label, .. } => ("Downloading game files".to_string(), label, 0.0),
                mc_launcher_core::progress::ProgressEvent::TaskSkipped { label, .. } => { finished += 1; ("Verifying game files".to_string(), label, 0.8) },
                mc_launcher_core::progress::ProgressEvent::TaskFinished { label } => { finished += 1; ("Installing game files".to_string(), label, 1.2) },
                mc_launcher_core::progress::ProgressEvent::BytesReceived { label, received, total } => {
                    let detail = total.map(|total| format!("{label} · {} / {}", human_bytes(received), human_bytes(total))).unwrap_or_else(|| format!("{label} · {}", human_bytes(received)));
                    ("Downloading game files".to_string(), detail, 0.0)
                }
            };
            let percent = (5.0 + finished as f64 * 0.9 + bump).min(94.0);
            let _ = app_for_task.emit("launcher://progress", UiProgressEvent { id: task_id.clone(), kind: "version".into(), label, detail, percent, bytes_per_second: 0, done: false });
        };
        let result = launcher.install_with_progress(request, &mut reporter)?;
        let _ = app_for_task.emit("launcher://progress", UiProgressEvent { id: task_id, kind: "version".into(), label: "Minecraft ready".into(), detail: format!("{} · {}", instance.minecraft_version, instance.loader), percent: 100.0, bytes_per_second: 0, done: true });
        Ok(result.version_id)
    }).await.map_err(|error| message(error.to_string()))?
}


/// Downloads libraries whose loader metadata only provides a Maven coordinate
/// and repository URL. Fabric profiles commonly use this legacy shape. The
/// launcher core adds these files to the classpath, but version 0.1.1 does not
/// include them in its download plan when `downloads.artifact` is absent.
async fn ensure_metadata_libraries(
    http: &reqwest::Client,
    shared: &Path,
    version_id: &str,
) -> AppResult<usize> {
    let shared_for_load = shared.to_path_buf();
    let version_id_for_load = version_id.to_string();
    let version = tokio::task::spawn_blocking(move || -> AppResult<_> {
        let launcher = Launcher::new(shared_for_load);
        Ok(launcher.load_version(&version_id_for_load)?)
    })
    .await
    .map_err(|error| message(error.to_string()))??;

    let mut downloaded = 0usize;
    for library in version.libraries {
        // Match mc-launcher-core's classpath fallback: native-only entries are
        // not classpath artifacts, and explicit artifacts are already handled
        // by the normal installer download plan.
        if library.natives.is_some()
            || library
                .downloads
                .as_ref()
                .and_then(|downloads| downloads.artifact.as_ref())
                .is_some()
        {
            continue;
        }

        let relative = maven_artifact_path(&library.name)?;
        let destination = shared.join("libraries").join(&relative);
        if destination.metadata().is_ok_and(|metadata| metadata.len() > 0) {
            continue;
        }

        let repository = library
            .url
            .as_deref()
            .unwrap_or("https://libraries.minecraft.net/")
            .trim_end_matches('/');
        let url = format!(
            "{repository}/{}",
            relative.to_string_lossy().replace('\\', "/")
        );
        let response = http.get(&url).send().await?.error_for_status().map_err(|error| {
            message(format!(
                "Unable to download required library {} from {url}: {error}",
                library.name
            ))
        })?;
        let bytes = response.bytes().await?;
        if bytes.is_empty() {
            return Err(message(format!(
                "Required library {} downloaded as an empty file from {url}",
                library.name
            )));
        }

        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temporary = destination.with_extension("jar.part");
        std::fs::write(&temporary, &bytes)?;
        if destination.exists() {
            std::fs::remove_file(&destination)?;
        }
        std::fs::rename(&temporary, &destination)?;
        downloaded += 1;
    }

    Ok(downloaded)
}

fn maven_artifact_path(coordinate: &str) -> AppResult<PathBuf> {
    let (coordinate, extension) = coordinate
        .split_once('@')
        .map_or((coordinate, "jar"), |(value, extension)| (value, extension));
    let parts: Vec<&str> = coordinate.split(':').collect();
    if !(3..=4).contains(&parts.len()) || parts.iter().any(|part| part.is_empty()) {
        return Err(message(format!("Invalid Maven library coordinate: {coordinate}")));
    }

    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).map(|value| format!("-{value}")).unwrap_or_default();
    Ok(PathBuf::from(format!(
        "{group}/{artifact}/{version}/{artifact}-{version}{classifier}.{extension}"
    )))
}

fn loader_spec(loader: &str, version: Option<&str>) -> AppResult<Option<LoaderSpec>> {
    let selector = match version.filter(|value| !value.is_empty() && *value != "latest") { Some(value) => LoaderVersion::Exact(value.into()), None => LoaderVersion::LatestStable };
    Ok(match loader {
        "vanilla" => None,
        "fabric" => Some(LoaderSpec::Fabric { version: selector }),
        "quilt" => Some(LoaderSpec::Quilt { version: selector }),
        "forge" => Some(LoaderSpec::Forge { version: selector }),
        "neoforge" => Some(LoaderSpec::NeoForge { version: selector }),
        other => return Err(message(format!("Unsupported loader: {other}"))),
    })
}

fn configure_installer_java(java_executable: &Path, instance: &crate::models::InstanceProfile) {
    if matches!(instance.loader.as_str(), "forge" | "neoforge") {
        java::prepend_to_path(java_executable);
    }
}

async fn ensure_java_runtime(
    app: &AppHandle,
    state: &AppState,
    configured: &str,
    required_major: u32,
) -> AppResult<PathBuf> {
    if let Some(runtime) = java::select_runtime(
        configured,
        &state.paths.managed_java,
        required_major,
    ) {
        return Ok(PathBuf::from(runtime.path));
    }

    let task_id = Uuid::new_v4().to_string();
    let _ = app.emit(
        "launcher://progress",
        UiProgressEvent {
            id: task_id.clone(),
            kind: "java".into(),
            label: format!("Installing Java {required_major}"),
            detail: "Downloading the required Eclipse Temurin runtime…".into(),
            percent: 8.0,
            bytes_per_second: 0,
            done: false,
        },
    );
    let runtime = java::ensure(
        &state.http,
        configured,
        &state.paths.managed_java,
        required_major,
    )
    .await?;
    let _ = app.emit(
        "launcher://progress",
        UiProgressEvent {
            id: task_id,
            kind: "java".into(),
            label: format!("Java {required_major} ready"),
            detail: runtime.path.clone(),
            percent: 100.0,
            bytes_per_second: 0,
            done: true,
        },
    );
    Ok(PathBuf::from(runtime.path))
}

async fn installed_java_major(
    shared: PathBuf,
    version_id: String,
    fallback: u32,
) -> AppResult<u32> {
    tokio::task::spawn_blocking(move || -> AppResult<u32> {
        let launcher = Launcher::new(shared);
        let version = launcher.load_version(&version_id)?;
        Ok(version
            .java_version
            .as_ref()
            .and_then(|java| u32::try_from(java.major_version).ok())
            .filter(|major| *major >= 8)
            .unwrap_or(fallback))
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

fn begin_launch(app: &AppHandle, state: &AppState, instance_id: &str) -> AppResult<()> {
    let status = GameStatus { state: "installing".into(), instance_id: Some(instance_id.into()), pid: None, started_at: None, message: Some("Checking game files".into()) };
    {
        let mut current = state.status.lock();
        if matches!(current.state.as_str(), "installing" | "launching" | "running" | "stopping") {
            return Err(message("Minecraft is already running or being prepared."));
        }
        *current = status.clone();
    }
    let _ = app.emit("launcher://status", status);
    Ok(())
}

fn fail_launch(app: &AppHandle, state: &AppState, instance_id: &str, error: AppError) -> AppError {
    let text = error.to_string();
    set_status(app, state, GameStatus { state: "error".into(), instance_id: Some(instance_id.into()), pid: None, started_at: None, message: Some(text.clone()) });
    push_console(app, state, "error", text);
    error
}

fn set_status(app: &AppHandle, state: &AppState, status: GameStatus) {
    *state.status.lock() = status.clone();
    let _ = app.emit("launcher://status", status);
}

fn push_console(app: &AppHandle, state: &AppState, level: &str, text: String) {
    let line = ConsoleLine { level: level.into(), text, timestamp: Utc::now().to_rfc3339() };
    {
        let mut history = state.console.lock();
        history.push(line.clone());
        if history.len() > 1200 { let excess = history.len() - 1200; history.drain(0..excess); }
    }
    let _ = app.emit("launcher://console", line);
}


const UNSUPPORTED_UNSAFE_MEMORY_OPTION: &str = "--sun-misc-unsafe-memory-access=allow";
const JAVA_OPTION_ENV_VARS: [&str; 3] = ["JDK_JAVA_OPTIONS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS"];

/// Removes a JDK-version-specific option that may be inherited from the parent
/// process. Java reads these variables before normal command-line arguments, so
/// filtering only `LaunchCommand::args` is not sufficient.
fn sanitize_inherited_java_options(command: &mut Command) {
    for name in JAVA_OPTION_ENV_VARS {
        if let Some(value) = std::env::var_os(name) {
            set_sanitized_java_option_env(command, name, value);
        }
    }
}

fn set_sanitized_java_option_env(command: &mut Command, name: &str, value: OsString) {
    match without_unsupported_java_option(&value) {
        Some(filtered) if filtered.is_empty() => {
            command.env_remove(name);
        }
        Some(filtered) => {
            command.env(name, filtered);
        }
        None => {
            command.env(name, value);
        }
    }
}

fn without_unsupported_java_option(value: &OsStr) -> Option<OsString> {
    let text = value.to_string_lossy();
    if !text.contains(UNSUPPORTED_UNSAFE_MEMORY_OPTION) {
        return None;
    }
    Some(text.replace(UNSUPPORTED_UNSAFE_MEMORY_OPTION, "").trim().into())
}

fn human_bytes(value: u64) -> String {
    if value >= 1_048_576 { format!("{:.1} MB", value as f64 / 1_048_576.0) }
    else if value >= 1024 { format!("{:.1} KB", value as f64 / 1024.0) }
    else { format!("{value} B") }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_standard_maven_artifact_path() {
        assert_eq!(
            maven_artifact_path("net.fabricmc:fabric-loader:0.16.14").unwrap(),
            PathBuf::from("net/fabricmc/fabric-loader/0.16.14/fabric-loader-0.16.14.jar")
        );
    }

    #[test]
    fn builds_classifier_maven_artifact_path() {
        assert_eq!(
            maven_artifact_path("example:library:1.0:client@zip").unwrap(),
            PathBuf::from("example/library/1.0/library-1.0-client.zip")
        );
    }

    #[test]
    fn removes_unsupported_java_option_from_environment_value() {
        let value = OsStr::new("-Xmx2G --sun-misc-unsafe-memory-access=allow -Dfile.encoding=UTF-8");
        assert_eq!(
            without_unsupported_java_option(value),
            Some(OsString::from("-Xmx2G  -Dfile.encoding=UTF-8"))
        );
    }

    #[test]
    fn removes_environment_value_when_it_only_contains_unsupported_option() {
        let value = OsStr::new(" --sun-misc-unsafe-memory-access=allow ");
        assert_eq!(without_unsupported_java_option(value), Some(OsString::new()));
    }

    #[test]
    fn leaves_unrelated_environment_values_untouched() {
        let value = OsStr::new("-Xmx2G -Dfile.encoding=UTF-8");
        assert_eq!(without_unsupported_java_option(value), None);
    }
}
