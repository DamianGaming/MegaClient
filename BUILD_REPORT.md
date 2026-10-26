# MegaClient 1.12.0 — validation report

## Changes reviewed

- Reworked game session lifecycle: protected runtime cleanup is now tied to `launch_close` rather than the resolution of `launcher.launch()`. The active-launch state and background throttling persist during gameplay.
- Updated player interface structure, layout and shared theme, including sign-in; eliminated decorative repeated animation work.
- Added compatible local Fabric API detection, explicit minimum-version checks and cached scans of unrelated unchanged mod JARs.
- Refreshed the protected AES-GCM client bundle from the latest uploaded `megaclient-0.14.2(2).jar`.

## Verification performed

- Uploaded JAR: Fabric mod ID `megaclient`, version `0.14.2`; Minecraft `~26.2`, Java >=25 (class version 69); minimum Fabric Loader `0.19.3`, Fabric API `0.152.2+26.2`; client entrypoint and mixin JSON present.
- JAR SHA-256: `95eaefa80ffb9ed70ce93b59c9a2dff05dbc6070f59141cb407f97af6d5a0e0a`.
- New encrypted bundle decrypted successfully and matched the original JAR byte-for-byte.
- Existing launch verifier SHA-256: `a1aa00e99b83ef7de62103a64b82321e10b7e06eba5fc9611940b139e9d8bb80`.
- Node built-in release tests: seven tests passed (protected JAR, verifier, versions, essential UI and launch lifecycle invariants).
- TypeScript/TSX parsing: passed, no syntax diagnostics. CSS parsing: passed with PostCSS.
- Source/patch archive integrity: verified after packaging.

## Not verified in this environment

- `npm ci` cannot complete due DNS/network errors (EAI_AGAIN from the npm registry); `npm run typecheck` is consequently blocked by missing type packages.
- No full Electron/Vite production build, Windows NSIS build, Microsoft sign-in, Java 25/Fabric runtime or live Minecraft session was available here.
- Therefore the lifecycle fix is **source-level verified, not yet end-to-end proven**. Before publishing, run a protected-client launch on Windows and confirm the game opens and remains running.

## Recommended release-gate commands

```bat
npm ci
npm run client:verify
npm run test:release
npm run typecheck
npm run build
npm run dist:win
```
