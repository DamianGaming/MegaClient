# MegaClient Launcher 1.12.11

- Refreshed the protected MegaClient 0.14.3 client bundle for Minecraft 26.2 using the latest supplied JAR and its exact SHA-256 hash.
- Refreshed the independently protected MegaClient 0.14.3 client bundle for Minecraft 26.3 using the latest supplied JAR and its exact SHA-256 hash.
- Confirmed the existing version-specific launch verifiers still match their respective Minecraft, Fabric Loader, and client versions; kept both verifier files unchanged.
- Updated launcher, package and lockfile version metadata to 1.12.11.
- Kept the partnered server WillowSMP (`play.willowsmp.co.uk`) and all existing design assets, styling, layouts, profile functionality and supported Minecraft versions unchanged.

Before publishing on Windows, run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, and `npm run build`, then test a real launch for both game versions.
