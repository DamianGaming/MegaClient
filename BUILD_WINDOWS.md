# Building MegaClient (Windows)

## Prerequisites
- **Node.js 18+** (recommended: Node 20 LTS)
- **Rust (stable)** via rustup
- **Visual Studio Build Tools** → install **Desktop development with C++**

Optional:
- **WiX Toolset v3** (only needed if you want an MSI)

## Development
```bash
npm install
npm run tauri dev
```

## Release build (EXE + installer)
```bash
npm run tauri build
```

## Where the built files go
After building, look in:
- **src-tauri/target/release/** → the main `.exe`
- **src-tauri/target/release/bundle/nsis/** → NSIS installer `.exe`
- **src-tauri/target/release/bundle/msi/** → MSI (only if WiX is installed)

## Updating the app version
Update both:
- `src-tauri/tauri.conf.json` → `package.version`
- `src-tauri/Cargo.toml` → `version`

(Then rebuild.)
