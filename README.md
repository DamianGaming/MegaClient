# MegaClient (Tauri) — FixedBuild4

Changes:
- Sidebar keeps **Play** button, but **no version selector** there.
- Versions page shows 1.8.9+ releases, with **search/filter**.
- Selecting a version in Versions page sets the launcher’s active version.
- Pressing **Play** in the sidebar launches the selected version.
- Rust backend now downloads + launches vanilla Minecraft (offline mode for now).

## Dev
```powershell
npm install
npm run tauri dev
```

## Notes
- Requires Java on PATH or JAVA_HOME set.
- Offline mode only (Microsoft login/ownership check can be added next).

## Microsoft Login setup (required)

1) Create an Azure App Registration (Public client / Mobile & desktop).
2) Put the Client ID into `src-tauri/ms_client_id.txt` (replace the placeholder), OR set env var `MEGACLIENT_MS_CLIENT_ID`.
3) Run `npm run tauri dev`.

This launcher is locked to your Client ID (users can't change it in-app).
