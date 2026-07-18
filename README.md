# MegaClient Launcher 1.9.4

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.4`
- Built-in MegaClient client: `0.12.4`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer

## What changed in 1.9.4

- Restoring a saved Microsoft account no longer depends on Microsoft services being reachable during launcher startup.
- Skin and cape profile loading now uses the saved access token first and refreshes only when Minecraft Services returns an authentication rejection.
- Concurrent token refresh requests are combined into one refresh operation to prevent duplicate Microsoft requests.
- Cached skin and cape information remains available during temporary service, network or rate-limit problems.
- Electron IPC error prefixes are removed from user-facing messages.
- Automatic cosmetics loading no longer creates duplicate error notifications.
- Failed profile loading now appears as one clean inline notice with a retry control.
- The GitHub release workflow runs only from a pushed version tag.
- Each version tag has one concurrency group, preventing overlapping release jobs.
- Installer creation and GitHub release uploading are now separate steps.
- Existing release assets are safely replaced during a workflow rerun instead of attempting to create the same release again.
- The workflow verifies that `latest.yml` exists before publishing so automatic updates are not released without metadata.

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

Enter `1.9.4`. Do not manually start a second release workflow. Pushing the version tag starts the one release job automatically.

A packaged release still needs a final Windows installer test with a real Microsoft account before public distribution.
