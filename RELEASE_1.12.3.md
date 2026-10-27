# MegaClient Launcher 1.12.3 — Windows release regression fix

## Changes

- Fixed `archive-responsiveness.test.mjs` failing on GitHub Actions when Windows Git checkout converts source files from LF to CRLF line endings. The test now accepts both while still exercising the actual worker code and tamper detection.
- Added an explicit CRLF regression assertion to protect future Windows releases.
- Both Windows release commands now run `npm run test:release` **before** creating or pushing the version tag, so regressions fail locally instead of during GitHub Actions.
- Bumped and synchronised launcher version, package lockfile, network User-Agent, displayed version, and release integrity checks to **1.12.3**.
- The protected in-game client is still **0.14.2**, targeting Minecraft **26.2**. Its encrypted bundle and verifier are unchanged.

No changes were made to UI layouts, styles, graphics, icons, visual resources, or gameplay behaviour.

## Before publishing

Run `npm ci`, `npm run client:verify`, `npm run discord:verify`, `npm run typecheck`, `npm run test:release`, and `npm run build` on Windows. Then publish with `publish-megaclient-update.cmd` using version **1.12.3**. GitHub already has a failed **v1.12.2** release tag, so use the new version.
