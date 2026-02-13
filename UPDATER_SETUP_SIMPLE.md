# MegaClient Auto-Update (Simple)

MegaClient uses Tauri's built-in updater with **GitHub Releases**.

Tauri updates are **signed**:
- **Public key** goes inside `src-tauri/tauri.conf.json` (safe to commit)
- **Private key** is an environment variable on the PC that builds the release (keep secret)

That error:
> A public key has been found, but no private key. Make sure to set `TAURI_PRIVATE_KEY` environment variable.

…means you put the public key in `tauri.conf.json`, but you didn't set the private key on the build machine.

## One-time setup (Windows)

### 1) Generate a keypair
In PowerShell:

```powershell
npm install -g @tauri-apps/cli

# Generates a new keypair and prints them
tauri signer generate
```

Copy both values:
- `PUBLIC KEY:`
- `PRIVATE KEY:`

### 2) Put the **public key** into the app
Open `src-tauri/tauri.conf.json` and set:

```json
"updater": {
  "active": true,
  "endpoints": [
    "https://github.com/DamianGaming/MegaClient/releases/latest/download/latest.json"
  ],
  "dialog": true,
  "pubkey": "PASTE_PUBLIC_KEY_HERE"
}
```

### 3) Set the **private key** (so builds can sign)
In PowerShell (temporary for this terminal):

```powershell
$env:TAURI_PRIVATE_KEY = "PASTE_PRIVATE_KEY_HERE"
```

(Recommended) Also set it permanently in **Windows Environment Variables**:
- Start Menu → search **Environment Variables**
- Add a new *User variable*:
  - Name: `TAURI_PRIVATE_KEY`
  - Value: your private key

### 4) Build a release
From the project root:

```powershell
npm install
npm run tauri build
```

Tauri will produce:
- the installer/exe (in `src-tauri/target/release/bundle/...`)
- update artifacts that `latest.json` points to (depends on your bundler)

## Publishing the update on GitHub
Each time you want an update:
1. Bump version in `src-tauri/tauri.conf.json` (and package.json if you want)
2. Run `npm run tauri build`
3. Create a GitHub Release for that version
4. Upload the generated updater files + `latest.json` to the release

If you want this to be *fully automatic*, set `TAURI_PRIVATE_KEY` as a **GitHub Secret** and build releases with GitHub Actions (so your PC never needs to keep the private key).
