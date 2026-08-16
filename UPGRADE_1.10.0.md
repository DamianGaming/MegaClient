# Upgrade MegaClient 1.9.7 to 1.10.0

1. Back up your working source folder if you have local edits.
2. Extract `MegaClient-1.10.0-upgrade-patch.zip` over the existing launcher source and replace matching files.
3. Run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

4. Test a fresh instance, an existing-instance import, a Modrinth `.mrpack`, and one installed third-party launcher profile folder before public release.
5. Double-click `publish-megaclient-update.cmd` and enter `1.10.0`.
6. Let the tag-triggered GitHub Actions workflow create/update the release. Do not manually start a second release workflow for the same tag.
