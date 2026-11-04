# MegaClient Launcher 1.12.22 — Local Hosting Management

This release improves the existing **Host Servers** panel without redesigning other launcher screens.

- Automatically provisions a version-appropriate Eclipse Temurin Java JDK when the matching Java feature version is missing or mismatched, using the official Adoptium GA release metadata, SHA-256 verification, a size limit and an app-local runtime cache. Java downloads and extraction do not block Electron's main process. A custom Java path remains an explicit override.
- Adds additional gameplay configuration: PvP, whitelist and whitelist enforcement, flight, hardcore, simulation distance and spawn protection.
- Adds world backups while the server is stopped, keeping compressed archives outside the managed server directory, plus backup browsing and deletion.
- Adds duplicate server profile creation, creating a new address and port without copying or overwriting the original world.
- Adds an overview with local port, Java requirement, player count and relay status, plus quick console commands for saves, player listing and whitelist listing.
- Keeps the existing server software support, world files, WillowSMP partnership, 26.2/26.3 protected client bundles and unmodified relay integration.

## Verification

- `npm run test:release` passes its source-level release tests, including a new Java download/extraction test and a world-backup/duplication test.
- The full Windows Electron build and real-world public guest connection were not run in this environment; run `npm ci`, `npm run typecheck`, `npm run test:release`, `npm run build`, and actual Windows Java/game launches before publishing.
- The supplied relay server was neither edited nor repackaged.
