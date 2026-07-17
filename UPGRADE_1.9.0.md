# Upgrading MegaClient to 1.9.0

1. Back up the current launcher source folder.
2. Extract `MegaClient-1.9.0-upgrade-patch.zip` into the MegaClient 1.8.1 project and replace existing files.
3. Run `configure-discord-activity.cmd` once and paste the Discord Application ID used for MegaClient Rich Presence.
4. Validate the project:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

5. Publish from the extracted folder with:

```text
publish-megaclient-update.cmd
```

Enter:

```text
1.9.0
```

The one-click publisher clones or refreshes `DamianGaming/MegaClient`, copies the updated source without replacing `.git`, validates everything, commits the changes and pushes `v1.9.0`.

After GitHub Actions finishes, test the new Windows installer with Simple Voice Chat, C2ME, automatic update detection, Discord desktop activity and the cape preview before announcing the release.
