# Upgrade MegaClient 1.9.3 to 1.9.4

1. Back up the current source folder.
2. Extract `MegaClient-1.9.4-upgrade-patch.zip` over the 1.9.3 source folder.
3. Replace all matching files.
4. Run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

5. Double-click `publish-megaclient-update.cmd` and enter `1.9.4`.

The tag push starts the release workflow automatically. Do not also use **Run workflow**, because the new workflow is intentionally tag-only.
