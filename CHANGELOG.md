# Changelog

## 2.3.5

- Built Windows release binaries as GUI applications so opening MegaClient no longer creates a terminal window whose closure also terminates the launcher. Development builds keep their terminal for diagnostics.
- Preserve Modrinth's exact publisher-provided filenames for selected mods and every required dependency; filename collisions now stop with a clear error instead of silently renaming or overwriting another file.
- Stream SHA-1 verification during downloads instead of reading completed files back into memory, reducing memory spikes for large mods and modpacks.
- Throttle download-progress events to reduce native-to-UI event spam and make the launcher feel smoother during large dependency installs.
- Skip redundant standalone update checks for dependency-only entries and cache sort keys while listing installed content.
- Corrected the GitHub release action inputs and disabled automatic full rebuild retries for deterministic signing/configuration failures.

## 2.3.2

- Fixed Windows release scripts falsely reporting that npm was missing by invoking npm through the active Node/npm entry point instead of spawning the `npm.cmd` shim directly.
- Made release setup handle updater-key passwords directly and made publishing attach safely to an existing GitHub repository history before pushing.
- Simplified release pipeline: one-time `npm run release:setup`, then one-command `npm run release -- <version>`.
- Windows-only signed release workflow now publishes automatically instead of leaving a draft.
- Removed unrelated macOS, Linux and companion-mod jobs from the launcher release gate.
- Updater endpoint is derived from the connected GitHub repository rather than a hard-coded repository name.

- Minimize MegaClient after Minecraft starts while keeping the native launcher process alive in the background.
- Restore, show and focus the launcher automatically when the Minecraft process exits.
- Treat a close request as minimize while a game is active so console capture, play-time tracking and status monitoring continue.
- Unminimize the existing launcher when a second MegaClient process is opened.
- Migrated the old `closeOnLaunch` preference to a new `minimizeWhilePlaying` setting that defaults on for both existing and new installations, while remaining independent from the launch-console preference.
- Synchronized the release version across npm, Cargo, Tauri and preview metadata so automatic update comparison works.
- Added release verification and version synchronization scripts.
- Added early GitHub Actions validation for updater signing secrets and source metadata.
- Restored the compile-time Microsoft OAuth client ID override used by the release workflow.
- Added a complete release and signed-update checklist.

## 2.3.1

- Inset the frameless UI from the native Windows resize frame, disabled the native window shadow and applied explicit clipping/radii to remove the bright corner slivers shown on all four corners.
- Removed Console from the sidebar and route system; console output remains available only as the dismissible launch overlay controlled by Settings.
- Added a Windows DPAPI-encrypted credential fallback alongside Credential Manager, plus refresh-request compatibility fields, so one successful Microsoft login remains reusable across launcher restarts.
- Simplified the Microsoft login gate to one compact reconnect/sign-in card.
- Removed the installed-content preview list from the selected Library profile; content is loaded only after opening the Installed Content modal.
- Added live Modrinth update checks and only renders Update controls when a newer compatible version is confirmed.
- Changed cape cards to crop and display the wearable cape panel instead of exposing the raw texture atlas, while keeping the 3D player preview focused on the skin.
- Added a Partnered Servers page with Skylabs (`play.sky-labs.co.uk`), live online state, MOTD, server icon, player totals, version, address copy and direct join support.
- Replaced internal npm mirror URLs with the public npm registry and pinned the project registry in `.npmrc`.
- Keeps the launcher unlocked whenever a saved account exists and repairs multi-account data where no account was marked active, preventing unnecessary startup login prompts.
- Replaced the flat skin texture preview with an interactive 3D Minecraft player model for the active skin.
- Added an optional dismissible launch-console modal that opens when Play is pressed, plus a Settings toggle to disable it.
- Removed the persistent bottom launch dock and expanded the main workspace into the freed space.
- Reworked the Modrinth version picker into an in-window paginated modal with no internal scrolling.
- Added an Installed Content button to selected Library profiles with a launcher-native modal for enabling, disabling, updating and removing files.
- Detects manually installed mods, resource packs and shaders so they also appear in the installed-content manager.
- Automatically resolves and installs required Modrinth mod dependencies, including transitive dependencies, while avoiding duplicate project/version installs.
- Added dependency labels and preserves enabled/disabled state when managed content is updated.
- Enabled a transparent frameless Tauri shell and consistent clipping so all four main-window corners render as rounded corners.
- Made Hide while playing and Show launch console mutually exclusive to avoid hiding the console immediately after launch.
- Fixed Fabric launches failing with `ClassNotFoundException: net.fabricmc.loader.impl.launch.knot.KnotClient` by downloading Maven-coordinate loader libraries that are present on the classpath but omitted from `downloads.artifact` metadata.
- Fixed the asynchronous `detect_java` Tauri command to return `AppResult`, resolving the `AsyncCommandMustReturnResult` and borrowed-state lifetime compile errors.
- Removed unused `chrono::DateTime` and `chrono::Utc` imports from the shared models module.
- Resolved each Minecraft version's declared Java runtime from Mojang metadata, including Java 25 for class-file version 69 snapshots.
- Automatically downloads and installs the exact required Eclipse Temurin JRE when no compatible local runtime exists.
- Rejects stale configured Java paths when their major version does not match the selected Minecraft version.
- Opens directly into the launcher for saved accounts while session refresh continues in the background; only missing or revoked credentials require sign-in again.
- Proxies trusted Minecraft skin and cape textures through the native backend as data URLs and improves pixel-art preview sizing.
- Removed the unsupported `--sun-misc-unsafe-memory-access=allow` JVM option from generated and inherited Java settings so Java 21 can start normally.
- Fixed false Microsoft-session expiry caused by transient Windows credential-vault reads and account-ID formatting differences.
- Added bounded credential-vault retries, canonical account-key migration and an in-memory session cache.
- Kept saved account metadata intact when interactive reconnection is required.
- Distinguished rejected Minecraft access tokens from temporary Minecraft Services/network failures.
- Changed the Microsoft sign-in webview from private/incognito storage to a normal persistent webview session.
- Added a single-flight reconnect flow so authenticated actions can recover through Microsoft sign-in once and retry automatically.
- Prevented authentication-recovery messages from appearing as the global red error banner.
- Updated the renderer, native package metadata and prebuilt production assets to 2.3.1.

## 2.2.3

- Fixed stale, missing or rejected Microsoft refresh-token records so they are cleaned up and return users to a normal sign-in screen instead of showing a credential-vault error.
- New sign-ins now require a reusable refresh token and verify both saved credentials immediately.
- Removed the dedicated Performance page, presets, backend commands, sidebar badge and Performance center card.
- Simplified the home dashboard and removed all performance-center shortcuts.
- Added consistent inset spacing around selected sidebar items in both normal and compact navigation.
- Renamed the remaining essential Java and RAM section to Minecraft runtime.
- Updated the production frontend and package metadata.

## 2.2.1

- Restored the previous launcher behavior by bundling the same public Microsoft OAuth client identifier used by the working Electron authentication flow.
- Removed the first-run client-ID setup form from the login gate.
- Removed the editable OAuth application field from Settings.
- Kept the optional compile-time client-ID override for release maintainers without exposing it to players.
- Existing settings remain migration-compatible, but legacy user-entered client IDs are no longer required or used by default.
- Updated the renderer and native package version to 2.2.1.

## 2.2.0

- Added a full Microsoft authentication gate; the launcher workspace, launch dock, library, discovery, skins, console and settings no longer render until an account session is valid.
- Restores and refreshes the active account during startup using the operating-system credential vault.
- Rebuilt the login experience around the previous launcher's flow: saved accounts, automatic device-code polling, copy/open controls and direct continuation after approval.
- Added first-run OAuth configuration to the login screen so users cannot become locked out before reaching Settings.
- Added optional compile-time `MEGACLIENT_MICROSOFT_CLIENT_ID` support for release builders while keeping client secrets unsupported.
- Promoted Performance to a clearly labelled navigation item with a Boost badge and a dedicated performance-center shortcut.
- Expanded the Performance page with editable memory allocation, active-instance compatibility state, Java recommendations and safer preset controls.
- Made sidebar navigation scroll correctly on short windows so no route is hidden behind account controls.
- Improved all native dropdowns with dark color-scheme handling, visible option text, hover/focus borders and keyboard focus indicators.
- Improved device-code terminal-state handling so expired, declined and failed requests are shown in the login UI rather than surfacing only as command failures.
- Updated the renderer and native package version to 2.2.0.

## 2.1.2

- Fixed the development startup panic caused by registering the updater plugin without an updater configuration.
- Updater registration is now compiled in only for signed release builds via the `signed-updater` Cargo feature.
- Signed local builds and GitHub Actions automatically enable the updater feature.
- Normal development and unsigned builds start without updater configuration and keep the updater UI disabled.
- Removed three unused internal fields instead of suppressing Rust warnings.

## 2.0.0 — Native rewrite

### Architecture

- Replaced Electron and the Node.js main process with Tauri 2 and a Rust backend.
- Kept a React + TypeScript renderer for a polished and maintainable interface.
- Added a command/event bridge for state, downloads, launch progress, console output and process status.
- Added isolated instances backed by a shared Minecraft asset/library store.
- Added an optional lightweight Fabric companion source for Minecraft 1.21.1.

### Launcher functionality

- Microsoft device-code sign-in with Xbox Live, XSTS and Minecraft Services exchange.
- Operating-system credential-vault storage and refresh handling for tokens.
- Account switching and account removal.
- Vanilla, Fabric, Quilt, Forge and NeoForge install planning through `mc-launcher-core`.
- Java discovery and managed Eclipse Temurin runtime installation with version-aware Java 8/17/21 routing.
- Instance creation, editing, duplication, deletion, favourites and configurable game-data directories.
- Modrinth discovery for mods, modpacks, resource packs and shaders.
- Compatible-version resolution, verified downloads and safe `.mrpack` extraction.
- Performance presets, live launch progress, bounded console history and process control.
- Skin upload/reset and cape selection through Minecraft Services.
- Persisted play time and clean launcher recovery when the game exits.

### Design

- Entirely new rounded shell with a narrow navigation rail, focused home dashboard and persistent launch dock.
- Original layout informed by instance-oriented launchers, content-first discovery apps and quick-play gaming launchers without copying their visual assets.
- Uses the supplied comet icon and its ice-blue, violet, magenta and red palette.
- Avoids expensive full-window blur and favors opaque layered surfaces, transform-based progress and small bounded animations.
- Includes reduced-motion and compact-navigation settings.

### Performance and reliability

- Uses the platform webview instead of packaging a complete Electron browser runtime.
- Lazy-loaded route bundles with split React and icon chunks.
- Shared asset/library downloads across isolated instances.
- Bounded console history with batched native-to-frontend events.
- Reused HTTP client and deferred on-demand work.
- Atomic launch guard prevents duplicate game starts.
- Launch/build/spawn failures produce recoverable error state rather than leaving the UI stuck.
- Game output is flushed at low volume instead of waiting for process exit.
- Managed Java is added to installer PATH for Forge and NeoForge.
- HTTPS-only content downloads, protected metadata paths and safer archive extraction.

### Companion module

- Added a Java 21/Fabric 1.21.1 companion scaffold.
- Added a Right Shift configuration menu.
- Added optional FPS, coordinates and ping HUD modules.
- Added local properties persistence with no telemetry or resident background service.
- Pinned Fabric Loom to a stable release instead of a moving snapshot.
