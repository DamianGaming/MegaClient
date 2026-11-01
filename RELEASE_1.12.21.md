# MegaClient Launcher 1.12.21

## Updated protected clients

- Updated the protected MegaClient 0.14.3 build for Minecraft 26.2 using the supplied JAR.
- Updated the protected MegaClient 0.14.3 build for Minecraft 26.3 using the supplied JAR.
- Regenerated each version-specific AES-256-GCM bundle and synchronized its SHA-256 metadata.
- Kept both existing game-specific launch verifiers unchanged because the JAR mod IDs, client versions, Minecraft versions, Fabric dependencies, and Java class versions remain compatible.
- Bumped launcher, lockfile, source version strings, and release test expectation to 1.12.21.

## Preserved

WillowSMP (`play.willowsmp.co.uk`), hosted server management and outbound relay integration, instances, launcher UI, layout, logos, animations, styles and icons are unchanged. The updated release does not alter server-side relay files.

## Verification

The release suite and a separate byte-for-byte decrypt check validate both bundles. Complete Windows/Electron build and authenticated Minecraft launches still require testing on Windows.
