# Validation — MegaClient 2.3.2

Completed in the packaging environment:

- `npm ci` completed successfully against `https://registry.npmjs.org/`.
- `npm audit --audit-level=high` reported zero vulnerabilities.
- `npm run release:verify` passed.
- `npm run check` passed with no TypeScript errors.
- `npm run build` completed successfully.
- A second production build with `VITE_UPDATER_ENABLED=true` completed successfully, validating the signed-release updater frontend path.
- All 21 Rust source files passed Tree-sitter Rust syntax parsing.
- All project JSON files parsed successfully.
- `.github/workflows/release.yml` passed YAML parsing.
- Signed updater configuration generation produced the expected HTTPS endpoint, public-key field and updater-artifact flag.
- Package versions are synchronized at `2.3.2` in npm, Cargo and Tauri metadata.
- The package lock contains no internal OpenAI registry URLs.
- The final ZIP passed an archive integrity test.

Native `cargo check` could not be run in this packaging environment because Rust/Cargo was unavailable and the Rust installer host could not be resolved. Run the following on the Windows release machine before publishing:

```powershell
npm ci
npm run release:verify
npm run check
npm run build
cargo check --manifest-path ".\src-tauri\Cargo.toml"
npm run tauri:dev
```

The release workflow repeats source validation and will fail early when updater signing secrets are missing. A real signed in-app update must still be tested from the previous public installer before publishing the draft release.
