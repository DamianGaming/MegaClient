use serde::Deserialize;
use tauri::State;

use crate::{
    error::AppResult,
    models::PartneredServer,
    state::AppState,
};

const SKYLABS_ADDRESS: &str = "play.sky-labs.co.uk";

#[derive(Debug, Deserialize)]
struct StatusResponse {
    #[serde(default)]
    online: bool,
    motd: Option<StatusMotd>,
    players: Option<StatusPlayers>,
    icon: Option<String>,
    version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatusMotd {
    #[serde(default)]
    clean: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct StatusPlayers {
    #[serde(default)]
    online: u32,
    #[serde(default)]
    max: u32,
}

fn offline_server(message: &str) -> PartneredServer {
    PartneredServer {
        id: "skylabs".into(),
        name: "Skylabs".into(),
        address: SKYLABS_ADDRESS.into(),
        online: false,
        motd: vec![message.into()],
        icon_url: Some(format!(
            "https://api.mcsrvstat.us/icon/{SKYLABS_ADDRESS}"
        )),
        players_online: 0,
        players_max: 0,
        version: None,
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

#[tauri::command]
pub async fn list_partnered_servers(
    state: State<'_, AppState>,
) -> AppResult<Vec<PartneredServer>> {
    let response = state
        .http
        .get(format!(
            "https://api.mcsrvstat.us/3/{SKYLABS_ADDRESS}"
        ))
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await;

    let status = match response {
        Ok(response) => match response.error_for_status() {
            Ok(response) => response.json::<StatusResponse>().await.ok(),
            Err(_) => None,
        },
        Err(_) => None,
    };

    let Some(status) = status else {
        return Ok(vec![offline_server(
            "Server status is temporarily unavailable.",
        )]);
    };

    let players = status.players.unwrap_or(StatusPlayers { online: 0, max: 0 });
    let motd = status
        .motd
        .map(|motd| motd.clean)
        .filter(|lines| !lines.is_empty())
        .unwrap_or_else(|| {
            vec![if status.online {
                "Skylabs is online.".into()
            } else {
                "Skylabs is currently offline.".into()
            }]
        });

    Ok(vec![PartneredServer {
        id: "skylabs".into(),
        name: "Skylabs".into(),
        address: SKYLABS_ADDRESS.into(),
        online: status.online,
        motd,
        icon_url: status.icon.or_else(|| {
            Some(format!(
                "https://api.mcsrvstat.us/icon/{SKYLABS_ADDRESS}"
            ))
        }),
        players_online: players.online,
        players_max: players.max,
        version: status.version,
        checked_at: chrono::Utc::now().to_rfc3339(),
    }])
}
