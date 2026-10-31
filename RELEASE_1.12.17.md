# MegaClient Launcher 1.12.17

- Updated the protected MegaClient **0.14.3** runtime for Minecraft **26.2** from `megaclient-0.14.3(20261031-112955).jar`.
- Updated the protected MegaClient **0.14.3** runtime for Minecraft **26.3** from `megaclient-0.14.3-26.3(20261031-113025).jar`.
- Rebuilt both encrypted AES-256-GCM bundles and synchronised the corresponding SHA-256 verification hashes.
- Retained each version-specific Fabric verifier and existing Java 25 / Fabric compatibility requirements.
- Bumped launcher version, release-test expectation, visible version and network user agent from **1.12.16** to **1.12.17**.
- Kept WillowSMP (`play.willowsmp.co.uk`), current instance behaviour, theme, logo, icons and layout unchanged.

## Client integrity

| Minecraft | MegaClient | SHA-256 of supplied original JAR |
| --- | --- | --- |
| 26.2 | 0.14.3 | `0bc3cda46ccb2dd4ac615c5e2c671b9b43f3f74d3c253dc22aecc5f72cc7ebcd` |
| 26.3 | 0.14.3 | `baa9614639ec6c2450c70cc4d9bc35708162894b0680beeff7b43cfb322bd009` |

## Release checks before publishing

On Windows run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck` and `npm run build`. Test both Minecraft 26.2 and 26.3 with an actual authenticated launch. Source tests alone do not prove successful gameplay.
