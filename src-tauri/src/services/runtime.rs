use std::{
    io::{BufRead, BufReader},
    process::{ChildStderr, ChildStdout},
    sync::mpsc,
    thread,
    time::Duration,
};

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};

use crate::{commands::instances, models::{ConsoleLine, GameStatus}, state::AppState};

pub fn attach_output(app: AppHandle, stdout: Option<ChildStdout>, stderr: Option<ChildStderr>) {
    let (sender, receiver) = mpsc::channel::<ConsoleLine>();
    if let Some(stdout) = stdout { spawn_reader(BufReader::new(stdout), "info", sender.clone()); }
    if let Some(stderr) = stderr { spawn_reader(BufReader::new(stderr), "warn", sender.clone()); }
    drop(sender);

    thread::spawn(move || {
        let mut batch = Vec::with_capacity(16);
        loop {
            match receiver.recv_timeout(Duration::from_millis(90)) {
                Ok(line) => {
                    batch.push(line);
                    while batch.len() < 16 {
                        match receiver.try_recv() {
                            Ok(line) => batch.push(line),
                            Err(_) => break,
                        }
                    }
                    if batch.len() >= 12 { flush(&app, std::mem::take(&mut batch)); }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if !batch.is_empty() { flush(&app, std::mem::take(&mut batch)); }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !batch.is_empty() { flush(&app, batch); }
                    break;
                }
            }
        }
    });
}

fn spawn_reader<R: std::io::Read + Send + 'static>(reader: BufReader<R>, default_level: &'static str, sender: mpsc::Sender<ConsoleLine>) {
    thread::spawn(move || {
        for line in reader.lines().map_while(Result::ok) {
            let lower = line.to_lowercase();
            let level = if lower.contains("error") || lower.contains("exception") { "error" } else { default_level };
            if sender.send(ConsoleLine { level: level.into(), text: line, timestamp: Utc::now().to_rfc3339() }).is_err() { break; }
        }
    });
}

fn flush(app: &AppHandle, lines: Vec<ConsoleLine>) {
    if let Some(state) = app.try_state::<AppState>() {
        let mut history = state.console.lock();
        history.extend(lines.clone());
        if history.len() > 1200 { let excess = history.len() - 1200; history.drain(0..excess); }
    }
    let _ = app.emit("launcher://console", lines);
}

pub fn monitor_child(app: AppHandle, instance_id: String, started: std::time::Instant) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(600));
        let Some(state) = app.try_state::<AppState>() else { break; };
        let result = {
            let mut child = state.game.lock();
            child.as_mut().and_then(|process| process.try_wait().ok()).flatten()
        };
        if let Some(exit) = result {
            state.game.lock().take();
            let elapsed = started.elapsed().as_secs();
            if let Ok(mut instance) = instances::find(&state, &instance_id) {
                instance.play_time_seconds = instance.play_time_seconds.saturating_add(elapsed);
                let _ = instances::persist(&state, &instance);
            }
            let status = GameStatus {
                state: "closed".into(),
                instance_id: Some(instance_id.clone()),
                pid: None,
                started_at: None,
                message: Some(format!("Minecraft exited with {} after {} seconds", exit, elapsed)),
            };
            *state.status.lock() = status.clone();
            let _ = app.emit("launcher://status", status);
            let restore_launcher = crate::commands::app::load_settings(&state)
                .map(|settings| settings.minimize_while_playing)
                .unwrap_or(true);
            if restore_launcher {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            break;
        }
    });
}
