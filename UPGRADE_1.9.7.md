# Upgrade MegaClient 1.9.6 to 1.9.7

1. Close MegaClient and any development terminal using the project.
2. Extract `MegaClient-1.9.7-upgrade-patch.zip` over the MegaClient 1.9.6 source folder.
3. Replace all matching files.
4. Run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

5. Test a normal Fabric instance and the protected MegaClient 26.2 instance.
6. Double-click `publish-megaclient-update.cmd` and enter `1.9.7`.

The patch includes the encrypted MegaClient 0.14.2 bundle and updated launch verifier.
