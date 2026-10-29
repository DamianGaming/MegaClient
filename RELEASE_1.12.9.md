# MegaClient Launcher 1.12.9

This release refreshes both **MegaClient 0.14.3** builds without changing the application design, gameplay launch logic, or either version-specific launch verifier.

- **Minecraft 26.2**: replaced the encrypted client with `megaclient-0.14.3(4).jar` (SHA-256 `ea31eeb31668829c4ee48afaf337f65477eb3005a15f88e74a0a004c0459f5cc`). Minimum Fabric Loader 0.19.3 and Fabric API 0.152.2+26.2.
- **Minecraft 26.3**: replaced the encrypted client with `megaclient-0.14.3-26.3(3).jar` (SHA-256 `3cfc43e6f40b9a3bc6d9ffe20fe66dd256e11ee7b2e84fcaf66bfc5a2f2ed81e`). Minimum Fabric Loader 0.19.5 and Fabric API 0.162.0+26.3.
- Updated SHA-256 metadata for both encrypted bundles and legacy Minecraft 26.2 compatibility constant.
- Bumped launcher version 1.12.8 → 1.12.9 in package metadata, lockfile, UI version labels, user-agent string, version tests and README.
- No changes to CSS, layout, logos, icons, fonts, animations, or other user interface design.

## Verification before publishing

Run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, and `npm run build` on Windows. Test launching authenticated Minecraft 26.2 and 26.3 profiles before `publish-megaclient-update.cmd`.
