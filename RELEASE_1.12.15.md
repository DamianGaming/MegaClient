# MegaClient Launcher 1.12.15

- Updated the protected MegaClient 0.14.3 client for Minecraft 26.2 using `megaclient-0.14.3(10).jar`.
- Updated the protected MegaClient 0.14.3 client for Minecraft 26.3 using `megaclient-0.14.3-26.3(9).jar`.
- Regenerated both AES-GCM protected payloads and updated the matching SHA-256 catalogue entries.
- Preserved each version-specific Fabric launch verifier, its loader/API requirements and supported Minecraft version.
- Bumped the launcher version from 1.12.14 to 1.12.15 across package/lockfile, version display, network user agent, README, and release test.
- Preserved WillowSMP (`play.willowsmp.co.uk`), instance handling and all existing UI, logos, icons, and CSS.

## Verification on Windows before publishing

Run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck` and `npm run build`, then launch both Minecraft 26.2 and 26.3 in MegaClient.
