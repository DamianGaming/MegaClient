# Upgrade to MegaClient 1.7.1

This update replaces the protected MegaClient client with version `0.9.6`, updates the launch verifier for that version, standardises all launcher branding as `MegaStudios`, and displays the launcher version in the interface.

## Upgrade

Extract the upgrade patch over the root of MegaClient 1.7.0 and replace the existing files, then run:

```bat
npm run client:verify
npm run typecheck
npm run dev
```

No dependency changes were made, so `npm ci` is not required when upgrading an existing 1.7.0 source folder.
