# MegaClient automatic updates

## First setup only

```powershell
npm ci
npm run release:setup
```

Use the original updater key when any previous public MegaClient version already supports updates.

## Publish every new version

```powershell
npm run release -- 2.3.3
```

Replace `2.3.3` with a version higher than the latest public release.

The command pushes a version tag. GitHub Actions then publishes the Windows installer, updater signature files and `latest.json` automatically. There is no draft-release step and no manual asset upload.

The release is ready when **Publish MegaClient Windows Release** is green on the repository's Actions page.
