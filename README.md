# MegaClient Launcher 1.9.6

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.6`
- Built-in MegaClient client: `0.13.1`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer
- Required Java version for the protected client: `25` or newer

## What changed in 1.9.6

- Added an automatic gameplay performance mode for Fabric and other modded instances.
- Launcher-owned update downloads, update scans and partner-server polling pause while Minecraft is launching or running.
- An update download already in progress is cancelled safely and resumes after Minecraft closes.
- MegaClient lowers only its own Electron processes to below-normal priority while playing; the Minecraft Java process remains at normal priority.
- Reworked runtime protection so expensive Windows process/module enumeration runs much less often without removing pre-launch protection.
- Reduced protected-client log polling from repeated large reads to small changed-file tail checks.
- Reduced launch-console DOM work, retained fewer lines and made the console opt-in by default for new installations.
- Compatible configured Fabric/Forge/NeoForge loaders are reused instead of querying loader services before every launch.
- Fabric API is reused locally and refreshed periodically instead of being resolved and downloaded on every protected-client start.
- Added loader metadata, DNS and server-status caching and request de-duplication.
- Reduced Discord desktop reconnect probing when Discord is closed.
- Added clearer in-launcher messages when update activity is paused for gameplay.

## Development

```bat
npm ci
npm run dev
```

Validate a release build:

```bat
npm run client:verify
npm run typecheck
npm run build
```

## Publishing

Double-click:

```text
publish-megaclient-update.cmd
```

Enter `1.9.6`. Pushing the version tag starts the release workflow automatically.

A packaged release still needs a final Windows installer test and a live Microsoft-authenticated multiplayer test before public distribution.
