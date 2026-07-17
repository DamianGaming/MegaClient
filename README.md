# MegaClient Launcher 1.9.0

MegaClient is a Windows Minecraft launcher with isolated Vanilla, Fabric, Forge and NeoForge instances, Microsoft sign-in, Modrinth content management, automatic updates, Discord activity, clearer launch progress and the protected MegaClient client.

## What changed in 1.9.0

### Mod compatibility and launch protection

- Simple Voice Chat, C2ME and other legitimate native/performance mods are no longer rejected because they load native libraries or use writable cache folders.
- Native-module protection now acts only on explicit high-confidence injector identities rather than file location or Windows signing alone.
- JAR inspection runs in worker threads so large mod folders do not block Electron's interface.
- Existing compatible Fabric Loader versions are retained instead of being silently replaced every launch.
- Required Modrinth dependencies are checked against the selected Minecraft version and loader before installation.
- Compatibility errors from unrelated mods are no longer misreported as a protected MegaClient failure.
- Slow first launches have more time to complete protected-client verification.

### Performance and reliability

- Closed launch consoles no longer accumulate a second unbounded live-log queue.
- Active console output is batched more efficiently.
- Protected-client log verification reads only the end of `latest.log` rather than repeatedly loading the whole file.
- Expensive Windows process and loaded-module scans run less often while launch protection remains active.
- Discord IPC connection attempts run in the background and cannot delay launcher startup.
- Existing startup progress, interface recovery and renderer responsiveness protections remain enabled.

### Updates, Discord and cosmetics

- Automatic updates scan shortly after startup, every 20 minutes, after resume and whenever the launcher is focused again.
- New updates download automatically and show live status before offering **Restart and update**.
- Discord activity can show browsing, launching and playing states, including the selected instance or joined server.
- The skin/cape viewer now has a sharper high-DPI render, full outer skin layers, a segmented 3D cape, front/cape controls and improved rotation/zoom.
- Installed protected-client resources and private runtime marker folders are marked hidden on Windows. They appear when Explorer's **Hidden items** option is enabled.

## Discord activity setup

Before publishing a public build, run:

```bat
configure-discord-activity.cmd
```

Paste the numeric Application ID from the MegaClient application in the Discord Developer Portal. The publisher also prompts for this automatically when it is missing. Players do not need to configure anything.

## Setup and development

```bat
setup-windows.cmd
run-development.cmd
```

Validation:

```bat
npm run client:verify
npm run typecheck
npm run build
```

## Publishing

From an extracted source package, double-click:

```text
publish-megaclient-update.cmd
```

From an existing Git repository clone, use:

```text
publish-update.cmd
```

Enter `1.9.0`. The publisher validates the protected client, Discord activity configuration, TypeScript and production build before creating the GitHub release tag.
