# MegaClient 1.11.0 — source validation report

## Inputs

- Base: MegaClient launcher 1.10.0 source archive.
- Uploaded protected client: `megaclient-0.14.2(2).jar`.
- Declared protected client metadata: `megaclient` **0.14.2**, Minecraft **~26.2**, Fabric Loader **>=0.19.3**, Java **>=25**, Fabric API **>=0.152.2+26.2**.
- New uploaded JAR SHA-256: `95eaefa80ffb9ed70ce93b59c9a2dff05dbc6070f59141cb407f97af6d5a0e0a`.

## Implemented

- Encrypted client bundle replaced and expected SHA-256 updated.
- Original 0.14.2 launch verifier retained and checked against its expected hash (client version is unchanged).
- New Nova theme (`theme.css`) with redesigned sidebar, dashboard, navigation, cards, mod/content pages and restrained visual feedback.
- Removed per-card compositor transforms and continuously animated decorative elements; background blur disabled; shorter transitions.
- Lazy-loaded the 3D skin preview so it does not join the initial renderer bundle.
- Coalesced renderer launch events and throttled downloadable-file progress callbacks.
- Corrected full-chunk disk writes and support for externally cancelled HTTP requests.
- Disabled unnecessary production sourcemaps.
- Stable Fabric loader sorting from live metadata, preserving pinned profile loader versions.
- Stale-cache fallback for online Minecraft/loader lists when a previously fetched list is available.
- Added standalone release integrity tests and CI invocation.
- Left stored instance/account formats, existing migrations, security rules and importers unchanged.

## Performed in this environment

- Supplied JAR ZIP parsed and its Fabric metadata and entrypoint class checked.
- Confirmed Java class major version 69 (Java 25).
- AES-256-GCM bundle regenerated from supplied JAR and decrypted byte-for-byte.
- `node --test tests/*.test.mjs`: 4/4 passed.
- TypeScript / TSX source files checked for syntactic parse errors using the globally installed TypeScript compiler.
- `theme.css` parsed with tinycss2 without stylesheet-level syntax errors.
- Source and upgrade ZIP entry integrity tests.

## Not completed here

- A dependency-backed `npm ci`: the package download did not complete in the available environment.
- Full `tsc --noEmit`/`npm run typecheck`: types for `electron-vite/node` and `node` were unavailable because npm dependencies could not be installed.
- Full Electron/Vite/NSIS packaging and signed-in Windows launch.
- Direct FPS, launch-time and ping benchmarks on the user's PC or against their servers.

Performance improvements are targeted at identifiable overhead in the launcher. Exact FPS and network latency improvements cannot be guaranteed without representative benchmarks.
