# MegaClient Launcher 1.9.5

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.5`
- Built-in MegaClient client: `0.13.1`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer
- Required Java version for the protected client: `25` or newer

## What changed in 1.9.5

- Replaced the protected built-in client with MegaClient `0.13.1`.
- Updated the encrypted client bundle, launch verifier, version checks and integrity hashes.
- Added clearer automatic-update download details, including transferred size and current speed.
- Update scanning now retries when Windows reports that the internet connection has returned.
- Update failures use cleaner messages without exposing long internal network errors.
- Reduced duplicate network work by sharing identical requests already in progress.
- Bounded Modrinth metadata caches to prevent unnecessary memory growth during long launcher sessions.
- Added background cleanup for abandoned protected runtime files left by interrupted launches.
- Improved Windows settings writes so brief file-lock conflicts are less likely to lose a settings change.
- Improved rendering performance for long mod, content, world, server and cape lists.
- Corrected fallback version labels so all launcher screens consistently show the current release.

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

Enter `1.9.5`. Pushing the version tag starts the release workflow automatically.

A packaged release still needs a final Windows installer test and a live Microsoft-authenticated Minecraft launch before public distribution.
