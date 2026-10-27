# MegaClient 1.12.1 — launch responsiveness improvements

Based on MegaClient-Launcher-1.12.0-functionality-fixed.zip. This is a **functionality-only** update.

## Changes

- Moved protected Fabric archive metadata inspection, integrity hashing, and ZIP entry decompression into a dedicated reusable Node worker thread, preventing those synchronous archive operations from blocking the Electron main/UI/IPC process.
- Moved inspection of unrelated mod ZIPs out of the Electron main process. Preserved duplicate mod-ID detection, integrity checks and runtime cleanup.
- Added real progress messages for profile resolution, mod-loader compatibility, security scans, Microsoft session verification, protected client preparation and archive checks. Existing download, Java, asset, loader and game-process progress remain intact.
- Added bounded, serialized console-log rendering to avoid overwhelming the console window with overlapping script executions during noisy Fabric launches.
- Synchronised console status on initial window readiness, so progress messages generated while the console window loads are not lost.
- Kept the existing UI progress bars from moving backwards when EML reports launch phases in a different sequence; displayed phase/message remains the real current task.
- Yielded the main event loop before handing control to EML's launch pipeline so pending progress IPC can be processed.
- Reported `launch:closed` only after session cleanup unlocks the next launch.
- Added release tests exercising the worker code, archive validation and tamper detection.

## Unchanged

- No layout, theme, CSS, markup, icons, fonts, images or window appearance has been modified.
- All existing account, protected-client, loader auto-update and game-launch functionality is retained.

## Verification

- `node --test tests/*.test.mjs`: **13 passed, 0 failed**.
- TypeScript / TSX source parse validation: **27 files, 0 syntax errors**.
- Protected client hashes checked by existing release tests.
- Compared with the previous ZIP: no CSS or visual asset differences.

## Environment limitations

Full TypeScript typechecking, Windows/Electron packaging and a real Minecraft launch have **not** been tested in this environment; npm packages could not be installed from the local offline cache. The EML library itself can still run synchronous code internally; these changes remove identified main-process archive bottlenecks but cannot promise that all third-party launch operations will never block on every PC.

On Windows, run `npm ci`, `npm run test:release`, `npm run typecheck` and `npm run build`, then test an initial Fabric/protected-client launch and a mod-heavy profile with the console open before publishing.
