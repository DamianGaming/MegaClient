use std::{collections::HashMap, process::Child};

use parking_lot::Mutex;
use reqwest::Client;

use crate::models::{ConsoleLine, GameStatus, Paths};

pub struct AppState {
    pub paths: Paths,
    pub http: Client,
    pub game: Mutex<Option<Child>>,
    pub status: Mutex<GameStatus>,
    pub console: Mutex<Vec<ConsoleLine>>,
    pub auth_gate: tokio::sync::Mutex<()>,
    pub auth_secrets: Mutex<HashMap<String, String>>,
}

impl AppState {
    pub fn new(paths: Paths) -> Self {
        let http = Client::builder()
            .user_agent(format!(
                "MegaClient/{} (+https://megastudios.studio)",
                env!("CARGO_PKG_VERSION")
            ))
            .pool_max_idle_per_host(8)
            .tcp_keepalive(std::time::Duration::from_secs(30))
            .build()
            .expect("HTTP client");
        Self {
            paths,
            http,
            game: Mutex::new(None),
            status: Mutex::new(GameStatus::default()),
            console: Mutex::new(Vec::new()),
            auth_gate: tokio::sync::Mutex::new(()),
            auth_secrets: Mutex::new(HashMap::new()),
        }
    }
}
