# MegaClient Launcher 1.12.1 — launch responsiveness patch

This release includes the launch responsiveness and functional fixes from the previous 1.12.0 source update. Its launcher/package/updater version is **1.12.1**, suitable for a new `v1.12.1` release tag.

- Launcher version: **1.12.1** (package metadata, lockfile, displayed fallback version, HTTP User-Agent, release test)
- Protected in-game MegaClient: **0.14.2** (unchanged; encrypted client/version verification depends on this)
- Existing visual layout, theme, CSS, fonts and assets: **unchanged**

Before publishing on Windows, run `npm ci`, `npm run test:release`, `npm run typecheck` and `npm run build`; then run `publish-megaclient-update.cmd` with version **1.12.1**. Test actual Minecraft launch and the installed updater before public release.
