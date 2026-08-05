# MegaClient 1.9.7 Build Report

## Included protected client

- Built-in client: MegaClient `0.14.2`
- Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer
- Required Java: `25` or newer
- Original client JAR SHA-256: `9a9dba93b606b2a204c54d528341686c8dfb17cd2abd5e08cbba4aef247d3989`
- Encrypted bundle SHA-256: `97f94e7ba2d2ee1a329fe8fb57d5ed9368d8a600e40f219751012963ba71ba25`
- Launch verifier SHA-256: `599bc1db44df88559f2997b49be4709c6ade47b5d9011db66a2e124a397b0d25`

## Launcher work completed

- Added a renderer event for the automatic game-performance state.
- Added focused/unfocused interface state handling.
- Automatically pauses decorative animations and removes costly shadows during gameplay.
- Automatically pauses non-essential visual animation while the launcher is unfocused.
- Rebuilt the home hero area into a cleaner live system/status panel.
- Improved title-bar status tones and gameplay state visibility.
- Reduced launch-console DOM history, pending batches and retained memory.
- Added asynchronous decoding and lazy loading to more remote artwork.
- Removed the duplicate `account:set-cape` IPC handler.
- Updated launcher fallback versions and network user agent to 1.9.7 / client 0.14.2.

## Protected-resource validation completed

- The uploaded JAR contains `fabric.mod.json`.
- Mod ID is `megaclient`.
- Client version is `0.14.2`.
- Minecraft requirement is `~26.2`.
- Fabric Loader requirement is `>=0.19.3`.
- Fabric API requirement is present.
- The client entrypoint is `dev.velora.client.VeloraClient`.
- The entrypoint class uses Java class version 69 (Java 25).
- The encrypted bundle was decrypted independently and matched the uploaded JAR byte-for-byte.
- The launch verifier metadata and embedded expected client version were updated to 0.14.2.
- TypeScript and TSX implementation files passed syntax/transpilation validation.
- Source and upgrade archives are checked after creation.

## Validation still required

The package registry available in this environment returned missing-package `404` responses during `npm ci`. Because the complete dependency tree could not be restored, the full strict TypeScript check and Electron/Vite production build could not be rerun here.

Before publishing, run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

The final NSIS installer and a real Microsoft-authenticated Fabric/MegaClient launch must also be confirmed on Windows.
