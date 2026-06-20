mod commands;
mod error;
mod models;
mod services;
mod state;
mod store;

use std::fs;

use models::Paths;
use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(feature = "signed-updater")]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Closing the launcher while Minecraft is active must not tear
                // down the background process that owns status, console and
                // play-time tracking. Treat the close button as minimize until
                // the game exits.
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    if state.game.lock().is_some() {
                        api.prevent_close();
                        let _ = window.minimize();
                    }
                }
            }
        })
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("MegaClient");
            fs::create_dir_all(&root)?;
            let paths = Paths {
                settings: root.join("settings.json"),
                accounts: root.join("accounts.json"),
                instances: root.join("instances.json"),
                managed_java: root.join("runtime"),
                auth_vault: root.join("auth-vault.json"),
                root,
            };
            app.manage(AppState::new(paths));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::bootstrap,
            commands::app::get_settings,
            commands::app::save_settings,
            commands::app::get_version_manifest,
            commands::app::delete_version,
            commands::auth::sign_in_microsoft,
            commands::auth::list_accounts,
            commands::auth::restore_active_account,
            commands::auth::switch_account,
            commands::auth::remove_account,
            commands::instances::list_instances,
            commands::instances::create_instance,
            commands::instances::update_instance,
            commands::instances::duplicate_instance,
            commands::instances::delete_instance,
            commands::launch::install_version,
            commands::launch::launch_game,
            commands::launch::kill_game,
            commands::launch::game_status,
            commands::launch::get_console_lines,
            commands::system::detect_java,
            commands::system::install_java,
            commands::content::search_modrinth,
            commands::content::get_project_versions,
            commands::content::install_content,
            commands::content::list_content,
            commands::content::toggle_content,
            commands::content::delete_content,
            commands::content::update_content,
            commands::skins::get_skin_profile,
            commands::skins::upload_skin,
            commands::skins::reset_skin,
            commands::skins::set_cape,
            commands::servers::list_partnered_servers
        ])
        .run(tauri::generate_context!())
        .expect("error while running MegaClient");
}
