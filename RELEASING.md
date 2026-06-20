# Releasing MegaClient

The release flow uses two commands.

## First-time setup

From the project folder:

```powershell
npm ci
npm run release:setup
```

The setup assistant:

- connects the folder to your public GitHub repository;
- saves the updater signing keys as GitHub Actions secrets;
- asks whether the updater key has a password and saves it when required;
- prepares local Git identity information.

When an older MegaClient release already supports automatic updates, reuse the same original updater key. A replacement key makes existing installations reject future updates.

## Publish a release

Use a version higher than the current public version:

```powershell
npm run release -- 2.3.3
```

The command updates versions, checks the project, commits it, connects safely to an existing repository history, pushes the source and tag, then starts GitHub Actions.

GitHub Actions builds the Windows installer, signs the updater package, creates `latest.json`, uploads signatures and publishes the GitHub Release.

Track progress on the repository's **Actions** page. A green **Publish MegaClient Windows Release** run means the release is live.

## Required GitHub secrets

The setup assistant manages:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_UPDATER_PUBLIC_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is encrypted

## Rules that must not change

- Keep the original updater private key forever.
- Increase the version for every published update.
- Keep the application identifier `studio.megastudios.megaclient`.
- Keep the GitHub repository public unless authenticated updater downloads are implemented later.
