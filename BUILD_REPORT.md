# MegaClient 1.8.1 Build Report

## Included versions

- Launcher: `1.8.1`
- Protected MegaClient client: `0.11.11`
- Minecraft target: `26.2`

## False-positive protection changes

- Replaced broad full-archive keyword searching with structured metadata parsing.
- Checks the mod's own Fabric, Quilt, Forge, NeoForge or legacy identity fields.
- Ignores dependency declarations, descriptions and unrelated class paths.
- Versioned release filenames remain a secondary high-confidence signal.
- Addon and compatibility filenames are not blocked solely by their name.
- Findings include the exact evidence used.

## Validation completed

- Protected client resource verification: passed.
- TypeScript strict type check: passed.
- Electron/Vite production build: passed.
- Security regression fixtures: passed.
  - Legitimate compatibility metadata containing blocked names: allowed.
  - Legitimate addon filename: allowed.
  - Normal performance mod: allowed.
  - Renamed JAR with an exact blocked mod identity: blocked.
  - Clear versioned blocked-client release filename: blocked.

## Limitations

A full Microsoft-authenticated Windows Minecraft launch and NSIS installer execution were not run in this Linux environment. Test the GitHub Actions installer on Windows before public release.
