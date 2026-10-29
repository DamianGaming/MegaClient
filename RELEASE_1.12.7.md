# MegaClient Launcher 1.12.7

- Updated bundled MegaClient **0.14.3 for Minecraft 26.2**, using the supplied `megaclient-0.14.3(2).jar`. Client SHA-256: `6ed407b66ebe268bcc2700b0e02f98ef6b5765c665e6e165cf42c86ea7b4edfe`.
- Updated bundled MegaClient **0.14.3 for Minecraft 26.3**, using the supplied `megaclient-0.14.3-26.3.jar`. Client SHA-256: `632c1e9a6e449849b5d1f1a7a5a53a3e51fdbee3ee3a293a982cec5832cd50fa`.
- Each client is packaged in its own authenticated encrypted bundle. Both version-specific launch verifier JARs remain unchanged because their version and loader requirements still match.
- Kept 26.2 and 26.3 profiles available without changing existing instance versions.
- Increased launcher release version to **1.12.7**. Existing UI, styling, logo, and icons are unchanged.

Before publishing, run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, and `npm run build`. Also perform real Windows launches for **both** Minecraft versions.
