# MegaClient Launcher 1.9.7

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.7`
- Built-in MegaClient client: `0.14.2`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer
- Required Java version for the protected client: `25` or newer

## What changed in 1.9.7

- Replaced the protected built-in client with MegaClient `0.14.2`.
- Added a visible adaptive performance state shared between the game process and launcher interface.
- The launcher now quietens decorative animations, shadows and transitions automatically while Minecraft is running.
- The interface also pauses non-essential visual movement when the launcher loses focus.
- Reworked the home screen with a cleaner live status panel for the selected instance, protected client and performance mode.
- Improved title-bar state styling for ready, working, offline and gameplay-performance states.
- Reduced launch-console retained history and DOM work while keeping useful recent output available.
- Improved remote image loading for mod, pack, server and account artwork.
- Fixed a duplicate cape IPC handler that could cause unreliable cosmetics behaviour or startup handler conflicts.
- Retained the automatic update, legitimate-mod compatibility, Microsoft account, skin/cape, Discord activity and protected-resource improvements from earlier releases.

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

Enter `1.9.7`. Pushing the version tag starts the release workflow automatically.

A packaged release still needs a final Windows installer test and a live Microsoft-authenticated Minecraft launch before public distribution.
