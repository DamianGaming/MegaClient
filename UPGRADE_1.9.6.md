# Upgrade MegaClient 1.9.5 to 1.9.6

1. Back up the current source folder.
2. Extract `MegaClient-1.9.6-upgrade-patch.zip` over the MegaClient 1.9.5 source folder.
3. Replace all matching files.
4. The older `DISCORD_UPDATE_LOG_1.9.5.md` and `UPGRADE_1.9.5.md` files may be removed.
5. Run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

6. Double-click `publish-megaclient-update.cmd` and enter `1.9.6`.

The tag push starts the GitHub release workflow automatically. Do not manually create or run a second release for the same tag.
