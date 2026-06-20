# MegaClient 2.3.2

MegaClient 2.2 is a complete source rewrite of the launcher as a Tauri desktop application. The interface remains React + TypeScript, while authentication, game installation, Java management, file work, downloads, content management and process control move into a Rust backend.


## Publishing a release

Run `npm run release:setup` once, then publish future versions with `npm run release -- 2.3.3`. See [RELEASING.md](RELEASING.md).

## Project structure

```text
MegaClient-Tauri-Rewrite-2.3.2/
├─ src/                    React + TypeScript interface
├─ src-tauri/              Rust/Tauri native backend
├─ client-mod/             Lightweight Fabric companion source
├─ dist/                   Prebuilt renderer assets
└─ .github/workflows/      Cross-platform release workflow
```

## What is implemented

- Interactive Microsoft authorization-code sign-in with Minecraft ownership/profile checks
- A full sign-in gate: launcher pages and launch controls stay unavailable until an account session is restored or completed
- Previous-style login experience with saved accounts and an automatic in-app Microsoft sign-in window
- Refreshable tokens stored through the operating-system credential vault
- Vanilla, Fabric, Quilt, Forge and NeoForge installation through `mc-launcher-core`
- Isolated instances with shared libraries and assets
- Version-aware Java discovery and managed Eclipse Temurin installation
- Modrinth search, compatible-version resolution, verified downloads and safe `.mrpack` extraction
- Mods, resource packs and shaders
- Essential Java and memory controls remain in Settings without a separate performance center
- Skin and cape management
- Live install progress, batched game-console streaming, play-time tracking and stop control
- Account switching/removal, persistent favourites and a configurable game-data location
- A new rounded, minimal interface based on the supplied comet palette

## Requirements

- Node.js 20 or newer
- Rust stable toolchain
- The platform prerequisites listed by Tauri
- Java is not required for the launcher itself; MegaClient can discover or install a suitable Minecraft runtime

## Microsoft sign-in

MegaClient includes the same public Microsoft OAuth client identifier used by the previous working launcher, so players do not need to enter or configure an application ID. Sign-in uses an interactive Microsoft authorization window, then stores refresh credentials in the operating-system credential vault. No client secret is bundled or requested.

Release builders may optionally replace the bundled public identifier at compile time with `MEGACLIENT_MICROSOFT_CLIENT_ID`. This is an advanced build override only and is never shown to players.


### Session reliability in 2.3.1

- Credential-vault reads and writes are retried briefly to tolerate transient Windows vault failures.
- UUID keys are normalized and older hyphenated/case-variant entries are migrated automatically.
- Successfully loaded tokens are cached in memory for the current launcher process.
- Temporary Minecraft Services failures no longer get misreported as an expired Microsoft session.
- Actions that genuinely require reconnection open the normal Microsoft sign-in flow once and retry after success.
- Authentication recovery stays on the login/reconnect flow instead of producing a global red error notification.

## Run the desktop app

```bash
npm ci
npm run tauri:dev
```

Build release packages:

```bash
npm run tauri:build
```

The renderer alone can be previewed in a browser with local demonstration data:

```bash
npm run dev
```

## Build the Fabric companion

The companion targets Minecraft 1.21.1 and Java 21. It adds a small local in-game menu, FPS/coordinates/ping HUD options and a properties-based configuration. It does not run telemetry or a background daemon.

```bash
cd client-mod
gradle build
```

Copy the resulting JAR from `client-mod/build/libs/` into the selected Fabric instance’s `mods` folder. Open its panel with **Right Shift**.

## Data locations

Launcher metadata remains under the operating system’s application-data directory in a `MegaClient` folder:

- `settings.json` — launcher preferences
- `accounts.json` — non-secret account/profile metadata
- `instances.json` — instance definitions
- `runtime/` — launcher-managed Java runtimes

Game data is stored under the folder selected in **Settings → Storage**:

- `minecraft/` — shared versions, libraries and assets
- `instances/<id>/` — saves, mods, packs, logs and per-instance configuration

Secret tokens are requested from the operating-system credential vault and are not intentionally written into the JSON metadata files.

When upgrading from an older build, MegaClient migrates compatible credential keys automatically. If Microsoft has genuinely revoked a refresh token, the saved profile remains available and the launcher requests one clean reconnect instead of deleting the account.

## Design direction

The layout is original rather than a clone. It uses an instance-focused library, content discovery, a focused home dashboard, profile-focused Library controls and a dismissible launch-console overlay. Opaque layered panels avoid expensive full-window blur; geometry stays rounded; motion is restrained and can be reduced; and the supplied comet’s ice-blue, violet, magenta and red palette drives the interface.

## Reliability and performance work

- Route-level code splitting and separate React/icon chunks
- Login-first rendering so unauthenticated users do not initialize or access the full launcher workspace
- Automatic restoration and refresh of the active Microsoft/Minecraft session before the workspace unlocks
- Dark native-select styling and explicit option colors for readable dropdowns on Windows
- Platform webview rather than a bundled Electron Chromium runtime
- Shared Minecraft assets/libraries across isolated instances
- Reused HTTP client and on-demand native commands
- Bounded console history with approximately 90 ms output batching
- Atomic launch guard to prevent duplicate starts
- Exact Mojang-metadata Java selection, including Java 8/17/21/25, with automatic managed runtime installation
- Managed-Java PATH handling for Forge and NeoForge installers
- Persisted play time, clean exit-state recovery and minimize-while-playing background support
- Safe archive extraction, HTTPS-only content downloads and protected launcher metadata

## Validation included with this package

- React/TypeScript production build completed successfully and is included in `dist/`
- Tauri configuration was recognized by the Tauri CLI
- All Rust source files passed a Tree-sitter syntax parse
- JSON configuration files were parsed successfully
- ZIP integrity was checked after packaging

The current execution environment did not include Rust/Cargo or the Linux WebKit development libraries, so the native Tauri binary could not be compiled here. It also did not include Gradle, so the Fabric JAR was not compiled here. Run the commands above on a machine with those toolchains for native integration testing.

The uploaded 1.2.0 project contained launcher source but no separate in-game client source tree. `client-mod/` is therefore a new companion scaffold, not a line-for-line port of unavailable client code.

## Development updater behavior

`npm run tauri:dev` and ordinary unsigned builds do not register the updater plugin. This is intentional: Tauri's updater configuration requires a real public signing key, so loading the plugin without signed release configuration can fail during startup. Signed release commands enable the `signed-updater` Cargo feature and merge `src-tauri/tauri.release.conf.json` automatically.
