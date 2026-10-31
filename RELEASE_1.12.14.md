# MegaClient Launcher 1.12.14

- Updated the protected MegaClient 0.14.3 client for Minecraft 26.2 using `megaclient-0.14.3(9).jar`.
- Updated the protected MegaClient 0.14.3 client for Minecraft 26.3 using `megaclient-0.14.3-26.3(8).jar`.
- Regenerated each version-specific encrypted payload and updated its SHA-256 in the catalogue.
- Retained both matching Fabric launch verifier JARs and existing Minecraft 26.2 / 26.3 support.
- Synchronized the launcher version across its package, lockfile, network user agent, version display, README and release test.
- Preserved WillowSMP (`play.willowsmp.co.uk`) and all existing UI, styles, branding, icons and unrelated functionality.

Before publishing on Windows: `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, `npm run build`; then test launching both Minecraft versions.
