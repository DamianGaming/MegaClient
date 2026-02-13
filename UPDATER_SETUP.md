# Auto-updater (GitHub Releases)

MegaClient is already pointed at your GitHub repo for updates:
- `https://github.com/DamianGaming/MegaClient/releases/latest/download/latest.json`

To make the updater *actually install updates* you must publish **signed** releases.

## 1) Generate an updater keypair
From `src-tauri/`:
```bash
cargo install tauri-cli --locked
cargo tauri signer generate
```

This prints a **pubkey** and creates a private key file on your machine.

- Copy the **pubkey** into:
  - `src-tauri/tauri.conf.json` → `tauri.updater.pubkey`

- Keep the **private key** secret. You'll use it in CI to sign releases.

## 2) Publish releases with `latest.json`
The updater downloads `latest.json` from your release assets. That json must match the version you built.

The easiest way is to use the official Tauri GitHub Action which generates + signs the update artifacts.

### Example GitHub Actions workflow
Create: `.github/workflows/release.yml`

```yml
name: release

on:
  push:
    tags:
      - "v*"

jobs:
  build:
    permissions:
      contents: write
    strategy:
      matrix:
        platform: [windows-latest]
    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - uses: dtolnay/rust-toolchain@stable

      - name: Install frontend deps
        run: npm ci

      - name: Build + publish (with updater)
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
        with:
          tagName: v__VERSION__
          releaseName: MegaClient v__VERSION__
          releaseBody: "Auto release"
          releaseDraft: false
          prerelease: false
```

## 3) Add secrets to your repo
In GitHub → **Settings → Secrets and variables → Actions** add:
- `TAURI_PRIVATE_KEY` (the private key content)
- `TAURI_KEY_PASSWORD` (if you protected the key)

## Notes
- The app version must match the tag version (e.g. `v0.1.0`).
- Users will be prompted to update when a new signed release is available.
