# Upgrade MegaClient 1.9.4 to 1.9.5

1. Back up the current source folder.
2. Extract `MegaClient-1.9.5-upgrade-patch.zip` over the MegaClient 1.9.4 source folder.
3. Replace all matching files.
4. The older `DISCORD_UPDATE_LOG_1.9.4.md` and `UPGRADE_1.9.4.md` files may be removed.
5. Run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

6. Double-click `publish-megaclient-update.cmd` and enter `1.9.5`.

The tag push starts the GitHub release workflow automatically. Do not create a second release manually for the same tag.
