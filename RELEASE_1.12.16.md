# MegaClient Launcher 1.12.16

- Updated the protected MegaClient **0.14.3** runtime for Minecraft **26.2** from `megaclient-0.14.3(20261031-105146).jar`.
- Updated the protected MegaClient **0.14.3** runtime for Minecraft **26.3** from `megaclient-0.14.3-26.3(10).jar`.
- Regenerated both encrypted AES-256-GCM bundles and synchronised the corresponding SHA-256 verification hashes.
- Retained each version-specific Fabric verifier, Java 25 support and existing Fabric requirements.
- Bumped launcher release metadata, the visible version and network user agent from **1.12.15** to **1.12.16**.
- Preserved WillowSMP (`play.willowsmp.co.uk`), existing instance behaviour, UI styling, fonts, branding, icons and layout.

## Client integrity

| Minecraft | MegaClient | SHA-256 of original uploaded JAR |
| --- | --- | --- |
| 26.2 | 0.14.3 | `5aba6f9b5b3d41d7a53325a87076b0d036d280fe3777bd54144035e3ec299629` |
| 26.3 | 0.14.3 | `52162a15bd31e634ea865f16ac2705dfc01147a5dc0cda33373cea124a9acabc` |

## Verification before publishing

On Windows, run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck` and `npm run build`, then test an actual launch of both versions. The source/release tests alone cannot validate a real Windows Minecraft launch.
