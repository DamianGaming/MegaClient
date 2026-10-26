# MegaClient 1.12.0 — upgrade guide

This is a source update for **MegaClient Launcher 1.11.0 → 1.12.0**. The supplied protected game client remains version **0.14.2** and targets Minecraft **26.2** and Java **25**. Do not remove existing instance folders or user data.

## Install the patch

1. Back up your current **source folder**.
2. Extract `MegaClient-1.12.0-upgrade-patch.zip` directly over the **1.11.0 source folder**, replacing existing files. The patch includes the re-encrypted client bundle and the updated launcher services.
3. Run the following from that folder:

```bat
npm ci
npm run client:verify
npm run test:release
npm run typecheck
npm run build
```

4. Start `npm run dev` and test: launching a protected 26.2 instance, remaining in game without protected JAR cleanup, returning to the launcher after closing Minecraft, importing a Fabric instance containing Fabric API, switching game instances, and signing in with Microsoft.
5. Build/test the Windows installer with `npm run dist:win` (or the existing release workflow), then run `publish-megaclient-update.cmd` and specify `1.12.0`.

## Before publishing

Check a real Windows device, including Java 25, latest stable Fabric Loader selection, correct Fabric API, both online and offline dependency caching, launch exit and memory performance. **Static checks alone cannot verify a successful Minecraft launch.**

The release workflow is tag-triggered; do not manually create a duplicate release for the same tag.
