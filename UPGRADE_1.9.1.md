# Upgrading MegaClient to 1.9.1

1. Back up the current MegaClient 1.9.0 source folder.
2. Extract `MegaClient-1.9.1-upgrade-patch.zip` into the 1.9.0 project and replace existing files.
3. Keep the existing Discord Application ID in `resources/discord/application-id.txt`.
4. Validate the project:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

5. Publish with:

```text
publish-megaclient-update.cmd
```

Enter:

```text
1.9.1
```

The publisher copies the update into the proper Git repository, validates it, commits it and pushes `v1.9.1` for GitHub Actions to build.
