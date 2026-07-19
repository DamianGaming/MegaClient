# MegaClient 1.9.5 Build Report

## Protected client

- Supplied JAR: `megaclient-0.13.1.jar`
- Mod ID: `megaclient`
- Version: `0.13.1`
- Minecraft target: `~26.2`
- Fabric Loader requirement: `>=0.19.3`
- Java requirement: `>=25`
- Fabric API requirement: `>=0.152.2+26.2`
- Client SHA-256: `dae16c4990db9a5af83bc648855577210f17c15ee30bc55c3fe1c2d6ae83c154`
- Launch verifier SHA-256: `f7107c353cca54c05bf4a316a22ff5f6027130384049eb5eede505c6b22249fa`
- The encrypted bundle was decrypted during validation and matched the supplied JAR byte-for-byte.
- Launch-verifier metadata and its embedded required MegaClient version were updated to `0.13.1`.

## Launcher validation

- `npm run client:protect` completed successfully using the supplied JAR.
- `npm run client:verify` passed.
- Strict TypeScript checking passed.
- Electron/Vite main-process build passed.
- Electron/Vite preload build passed.
- Electron/Vite renderer build passed.
- The protected client, updater, cache, network, settings-write, cleanup and renderer changes compiled together successfully.

## Improvements included

- More informative launcher-update transfer progress.
- Automatic update retry after the network reconnects.
- Cleaner updater failure messages.
- Header-aware coalescing of identical in-flight JSON requests.
- Bounded Modrinth metadata caches.
- Background cleanup of abandoned protected runtime files.
- More reliable atomic settings writes on Windows.
- Lighter rendering for long launcher lists.
- Correct current-version fallbacks throughout the interface.

## Remaining Windows validation

A normal `npm ci` reached the Electron post-install step, but this environment could not download the Electron binary because outbound fetching failed. Dependencies were installed with lifecycle scripts disabled so the TypeScript and Electron/Vite production builds could still be validated.

The GitHub Actions Windows job must therefore perform the final NSIS installer build, updater-metadata check and live Microsoft-authenticated Minecraft launch test before public release.
