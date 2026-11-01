# MegaClient Launcher 1.12.20

## Fix

- Added the missing `hosting.versions(software: string): Promise<string[]>` declaration to `src/renderer/src/global.d.ts`.
- The Host Servers version picker already uses this method, the preload bridge already exposes it, and the Electron main process already handles `hosting:versions`. Their implementation was not changed.
- Added a release regression test that checks the renderer declaration, preload bridge and IPC handler remain connected.
- Synchronized launcher version strings and package metadata to 1.12.20.

## Preserved

- Existing 26.2 and 26.3 protected client bundles and version-specific verifiers.
- WillowSMP partnered server (`play.willowsmp.co.uk`).
- Existing local hosting and outbound relay behaviour.
- All artwork, styling, icons, layouts, and user interface functionality.

## Validation

Run `npm ci`, `npm run test:release`, `npm run typecheck` and `npm run build` on your Windows build machine before publishing. This change fixes the reported TS2339 type error; it does not require a change to the hosting runtime.
