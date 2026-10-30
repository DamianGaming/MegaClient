# MegaClient Launcher 1.12.13

- Updated the protected MegaClient 0.14.3 client for Minecraft 26.2 with the supplied `megaclient-0.14.3(8).jar` build.
- Updated the protected MegaClient 0.14.3 client for Minecraft 26.3 with the supplied `megaclient-0.14.3-26.3(7).jar` build.
- Retained separate encrypted bundles and their existing version-specific Fabric launch verifiers.
- Updated both SHA-256 checksums and the legacy 26.2 integrity constant.
- Bumped launcher, lockfile, displayed version, network user agent and release test to 1.12.13.
- Preserved WillowSMP (`play.willowsmp.co.uk`), existing functionality, layout, fonts, CSS, branding and icon assets.

Before publishing: `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, `npm run build`, and launch both Minecraft versions on Windows.
