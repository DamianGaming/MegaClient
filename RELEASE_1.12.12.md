# MegaClient Launcher 1.12.12

- Updated both encrypted MegaClient 0.14.3 bundles with the newly supplied builds for Minecraft 26.2 and 26.3, respectively.
- Updated independent SHA-256 checksums and verified the packaged bundles decrypt byte-for-byte to the new supplied JARs.
- Preserved both original version-specific Fabric launch verifier files: both remain compatible with the new JAR metadata and Java 25.
- Updated launcher, package and lockfile version metadata to 1.12.12.
- Kept WillowSMP (`play.willowsmp.co.uk`), existing instance support, all UI design files, icons, logos and functionality unchanged.

Before publishing on Windows: `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, `npm run build`; then launch both Minecraft versions to verify actual runtime behaviour.
