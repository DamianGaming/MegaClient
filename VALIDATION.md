# Validation — MegaClient 2.3.5

Completed in the packaging environment:

- `npm ci` completed successfully against `https://registry.npmjs.org/`.
- `npm run check` passed with no TypeScript errors.
- `npm run build` completed successfully and refreshed the prebuilt `dist/` assets.
- `npm run release:verify` passed for version `2.3.5`.
- The release verifier confirms Windows GUI-subsystem configuration, supported updater-action inputs and Modrinth filename/performance guards.
- The package lock contains no internal OpenAI registry URLs.
- Project JSON and workflow YAML parsing passed.
- The final ZIP passed archive-integrity testing.

Native `cargo check` could not be run in this packaging environment because Rust/Cargo is unavailable. Run this on the Windows release machine before publishing:

```powershell
npm ci
npm run release:verify
npm run check
npm run build
cargo check --manifest-path ".\src-tauri\Cargo.toml"
cargo test --manifest-path ".\src-tauri\Cargo.toml"
npm run tauri:dev
```

Important: the no-terminal behavior applies to installed/release builds. `npm run tauri:dev` intentionally keeps its terminal attached for development logs.
