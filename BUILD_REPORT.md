# MegaClient 1.9.6 Build Report

## Included protected client

- Built-in client: MegaClient `0.13.1`
- Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer
- Required Java: `25` or newer
- Original client JAR SHA-256: `dae16c4990db9a5af83bc648855577210f17c15ee30bc55c3fe1c2d6ae83c154`
- Encrypted bundle SHA-256: `18cb337487af88d8c495da6c05370ee221825914ad0ef3c30ed388b5d7bc9c83`
- Launch verifier SHA-256: `f7107c353cca54c05bf4a316a22ff5f6027130384049eb5eede505c6b22249fa`
- The protected bundle and verifier are byte-for-byte unchanged from the previously validated 1.9.5 release.

## Performance work completed

- Added automatic gameplay performance mode.
- Cancels an active launcher update download when Minecraft starts and resumes it after Minecraft exits.
- Pauses update checks, update downloads and partner-server status requests during gameplay.
- Lowers only MegaClient Electron process priority while leaving the Minecraft Java process untouched.
- Replaced frequent full Windows process scans with lightweight, cached and much less frequent checks.
- Reduced native-module scans from every 90 seconds to an initial delayed check followed by 15-minute intervals.
- Added generation guards so stopped security and client-verification loops cannot restart after Minecraft closes.
- Reduced protected-client log polling from a 256 KB read every 1.5 seconds to a changed 64 KB tail read every 8 seconds.
- Reduced console flush frequency, retained history and DOM size.
- Disabled the separate launch console by default for new installations.
- Reuses configured compatible loaders rather than querying loader services before every start.
- Reuses a recently installed Fabric API dependency and supports offline fallback when the local dependency is valid.
- Added loader-version, DNS and server-status caching and in-flight request sharing.
- Pauses renderer server polling while Minecraft runs or the launcher is hidden.
- Reduced Discord IPC reconnect attempts from every 15 seconds to every 60 seconds when Discord is closed.

## Validation completed here

- TypeScript and TSX syntax transpilation passed for every implementation file.
- Static performance-mode assertions passed.
- Update cancellation/gameplay-pause state test passed with a mocked updater.
- Server-status gameplay-pause test passed.
- Package and lock-file versions are both `1.9.6`.
- Protected-resource checksums match the previously validated MegaClient 0.13.1 resources.

## Validation still required

The dependency registry available in this environment returned `503 Service Temporarily Unavailable` during `npm ci`. Because dependencies could not be restored, the full strict TypeScript check and Electron/Vite production build could not be rerun here.

Before publishing, run on Windows or allow GitHub Actions to run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

The final NSIS installer, live Fabric multiplayer ping test, Simple Voice Chat test and Microsoft-authenticated launch must also be confirmed on Windows. The launcher changes remove identified MegaClient-owned bandwidth, process-scan, console and polling spikes; they cannot correct latency caused by the Minecraft server, ISP, Wi-Fi or an individual third-party mod.
