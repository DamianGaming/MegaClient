# MegaClient 1.9.1 Build Report

## Included versions

- Launcher: `1.9.1`
- Protected MegaClient client: `0.12.1`
- Minecraft target: `26.2`

## Protected-client replacement

- Uploaded JAR metadata was read directly from `fabric.mod.json`.
- Mod ID: `megaclient`
- Version: `0.12.1`
- Client entrypoint: `dev.velora.client.VeloraClient`
- Java class version: `69` (Java 25)
- Client SHA-256: `815ab181b27381180aa355d88d78fc5ea5809bf9aa569c104fe882f5866a879a`
- Launch verifier dependency and runtime checks were updated to `0.12.1`.
- Launch verifier SHA-256: `5f1e940055e47f895e851f187665c7bf0a1eba8f3a3ce2031e27bd08130910e7`
- The encrypted bundle decrypts to the uploaded JAR and passes the launcher integrity check.

## Cape and skin preview fixes

- Corrected Minecraft cape UV orientation.
- Added a continuous curved cape surface with connected segments.
- Added proper outer, inner, side, top and bottom cape faces.
- Corrected slim-arm UV widths and offsets.
- Added proportional high-resolution texture support.
- Improved cape list thumbnails to display the visible 10×16 cape face.
- Added clearer loading and unavailable-texture states.

## Performance work

- Preview rendering pauses when hidden, off-screen or the document is not visible.
- Pointer rotation and wheel zoom update the canvas without rerendering React on every input event.
- Texture requests use a bounded shared cache.
- Canvas backing resolution uses a pixel budget while remaining sharp on high-DPI displays.
- Resize measurements are cached and redraws remain requestAnimationFrame-batched.
- Preview and cape cards use stricter paint/layout containment.

## Validation completed

- Protected MegaClient `0.12.1` bundle verification: passed.
- Launch verifier metadata and bytecode version references: passed.
- Encrypted bundle byte-for-byte payload check: passed.
- TypeScript strict type check: passed.
- Electron/Vite production build: passed.
- Source and patch archive integrity checks: passed after packaging.

## Environment limitation

The Linux validation environment could not download the Electron runtime during the normal post-install step, so a final Windows NSIS installer and live Microsoft-authenticated Minecraft launch were not executed here. Dependencies were installed without lifecycle scripts for TypeScript and Electron/Vite production validation. Test the GitHub Actions installer on Windows before announcing the release.
