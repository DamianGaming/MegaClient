# MegaClient 1.12.0 — Functionality-only fixes

This update is based exclusively on the supplied `MegaClient-Launcher-1.12.0-redesign.zip`.

## Behaviour and reliability

- Reserve a game launch before asynchronous loader/account/mod setup so simultaneous Play requests cannot overlap or corrupt protected runtime staging.
- Release the reservation only after game-close cleanup; recover from errors during setup, including before the underlying launcher is constructed.
- Preserve protected Fabric client files while Minecraft is alive; clean up failed staging and do not terminate a valid game on unrelated post-spawn errors.
- Use the latest compatible stable Fabric Loader automatically for the protected MegaClient profile (minimum required loader version still enforced). Auto-managed standard profiles refresh on launch, with a fallback to their saved version if the version service is offline.
- Respect explicitly selected older loader versions and imported modpack loader pins. New standard instances follow the newest build only if the newest version was selected when creating them.
- Sort Forge / NeoForge Maven builds numerically, respecting 26.x NeoForge four-part versions and prioritising stable builds over beta/pre-release builds.
- Validate new instance names, versions and loader choices; resolve missing mod loader versions; avoid duplicate slugs and lost concurrent instance creation updates.
- When an instance's game version or loader is changed without an explicit loader version, discard the stale loader build so it can be resolved for the new configuration.
- Prevent deleting an instance while it is launching or running.
- Prevent overwriting the protected client with an incompatible Modrinth modpack. Preserve the existing launch configuration if a modpack download fails and pin the modpack's required loader after a successful installation.
- Avoid duplicate renderer error notifications from failed EML launches.
- Do not pass Fabric-only tuning arguments to vanilla, Forge or NeoForge sessions.

## Visual preservation

No CSS, themes, fonts, icons, layout markup or other appearance-related files have been changed. The only renderer source adjustment is a nonvisual argument in the instance-creation request that identifies whether the chosen loader should auto-update.

## Verification

- `npm run test:release`: 11 passed, 0 failed (7 original and 4 additional tests).
- TypeScript/TSX parser/transpiler syntax checks: passed for all modified source files using the locally available TypeScript compiler.
- Protected bundle and verifier hashes: passed by original release tests.
- Original ZIP vs output: preserved all original entries; only intended functionality files changed.
- Full application typecheck/Electron/Windows build and live Minecraft launch: NOT VERIFIED. npm registry dependencies were unavailable in this execution environment (`ENOTCACHED`, missing `yocto-queue`).

To fully validate on Windows, extract the ZIP, run `npm ci`, `npm run test:release`, `npm run typecheck` and `npm run build`, then test standard Vanilla, Fabric and MegaClient 26.2 instances with a signed-in Minecraft account before publishing.
