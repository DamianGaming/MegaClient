# MegaClient 1.10.0 Validation Report

## Release contents

- Launcher: `1.10.0`
- Protected client: MegaClient `0.14.2` refreshed build
- Minecraft: `26.2`
- Minimum Fabric Loader: `0.19.3`
- Java class target: Java 25

## Protected client

- Uploaded JAR SHA-256: `f579cde28399753856e9f7f5032f8aca9b9df04ce2b7cbcd040b2271d5b6c886`
- JAR metadata ID: `megaclient`
- JAR metadata version: `0.14.2`
- JAR environment: `client`
- Required Minecraft version: `~26.2`
- Required Fabric Loader: `>=0.19.3`
- Required Java: `>=25`
- Encrypted `megaclient.bundle` was independently decrypted after creation and matched the uploaded JAR byte-for-byte.
- Updated launch verifier SHA-256: `a1aa00e99b83ef7de62103a64b82321e10b7e06eba5fc9611940b139e9d8bb80`
- Launch verifier metadata now requires `megaclient =0.14.2`.
- No stale `0.13.1` version string remains in the launch verifier.

## Import system review

- Import target can be either a new instance or an existing compatible instance.
- Profile/archive handling covers Modrinth `.mrpack`, CurseForge exported ZIP content, Lunar `.dawnpack`, Prism/MultiMC folders, standard Minecraft folders and generic profile archives.
- Modrinth remote downloads require HTTPS and an integrity hash before installation.
- Archive and folder paths are constrained to the instance directory.
- Folder symbolic links are ignored.
- Archive entry count, archive size, expanded size and individual-file limits are enforced.
- Existing config/options files are preserved rather than silently overwritten.
- Identical local files are skipped and other collisions receive an `-imported-N` suffix.
- Failed imports into newly-created instances clean up the partial instance.
- Import progress IPC is rate-limited to avoid flooding the renderer on large profiles.

## Performance / UI review

- Continuous hero-logo, ambient splash, loading-sheen and status-pulse animation work is disabled or reduced.
- Expensive sidebar/modal backdrop blur is disabled.
- Large card shadows and hover transforms are removed or reduced.
- New installations default to reduced motion.
- Existing game-performance mode now notifies the renderer so non-essential animation work can be disabled while Minecraft is running.
- Long cards/lists keep `content-visibility` containment.
- Functional progress indicators remain available for launch, updates and imports.

## Static validation

- All 23 executable TypeScript/TSX source files were parsed/transpiled with TypeScript 5.8.3 with zero syntax diagnostics.
- Package and package-lock launcher versions both resolve to `1.10.0`.
- IPC, preload and renderer declarations for profile importing are wired consistently.

## Still required on Windows before public release

This environment does not contain the project's npm dependencies, so the real project `npm run typecheck`, Electron/Vite production build, NSIS packaging, authenticated Microsoft profile actions and live Minecraft launch were not executed here. Run these in the source folder before publishing:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

The GitHub Actions release workflow should then build the final Windows installer and updater metadata.
