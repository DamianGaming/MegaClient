# MegaClient 1.9.0 Build Report

## Included versions

- Launcher: `1.9.0`
- Protected MegaClient client: `0.11.11`
- Minecraft target: `26.2`

## Compatibility fixes

- Removed location/signature-based native-module blocking that could reject legitimate native libraries.
- Kept exact high-confidence native injector identities and structured blocked-client metadata checks.
- Moved JAR metadata parsing into a bounded worker-thread pool.
- Preserved an already compatible Fabric Loader version instead of forcing the newest loader every launch.
- Improved required Modrinth dependency compatibility resolution.
- Restricted protected-client failure parsing to errors that explicitly identify MegaClient or its verifier.
- Increased the protected-client verification allowance for slower modded launches.

## Performance and reliability work

- Prevented launch-console pending output from growing while the console is closed.
- Increased console batching and bounded live pending output.
- Replaced repeated full-log reads with a 256 KiB tail reader.
- Reduced expensive Windows process/module scan frequency.
- Made Discord desktop IPC connection attempts non-blocking during startup.
- Added automatic updater scheduling and clearer update state reporting.
- Added hidden Windows attributes to protected at-rest resources and marker folders.

## Validation completed

- Protected MegaClient 0.11.11 bundle verification: passed.
- TypeScript strict type check: passed.
- Electron/Vite production build: passed.
- Mod-security worker execution: passed.
- Simple Voice Chat fixture with Opus/RNNoise native entries: allowed.
- C2ME performance-mod fixture: allowed.
- Addon-style compatibility fixture: allowed.
- Exact blocked mod identity fixture: blocked.
- Clear versioned blocked-client filename fixture: blocked.
- Packaged resource paths and relative renderer assets: statically checked.

## Release configuration still required

`resources/discord/application-id.txt` intentionally contains a placeholder in the distributable source. Run `configure-discord-activity.cmd` before publishing. Release scripts and GitHub Actions reject a release that still lacks a valid Discord Application ID.

## Environment limitation

The current Linux execution environment could not download the Electron runtime during `npm ci`, so a final Windows NSIS installer and a live Microsoft-authenticated Minecraft session were not executed here. The protected resource check, strict TypeScript check and complete Electron/Vite production compilation passed. Test the GitHub Actions installer on Windows before public release.
