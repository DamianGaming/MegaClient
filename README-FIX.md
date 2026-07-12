# MegaClient packaged-resource fix

This fixes both packaged-release issues:

- `megaclient.bundle` and `launch-verifier.jar` are copied as real unpacked installer resources.
- Launcher, splash, title bar, login and sidebar logos use packaged-file-safe relative paths.

## Apply

Extract this ZIP into the root of your MegaClient source folder and replace the existing files.

Then run:

```bat
npm run client:verify
npm run typecheck
npm run build
```

Publish it as a new version because the existing v1.7.1 installer is already broken:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\release.ps1" -Version 1.7.2
```

After GitHub Actions finishes, uninstall the old 1.7.1 build and install 1.7.2 for a clean test.
