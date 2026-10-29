# MegaClient Launcher 1.12.8

- Refreshed the encrypted **Minecraft 26.2** MegaClient **0.14.3** bundle from the supplied `megaclient-0.14.3(3).jar`.
  - Original JAR SHA-256: `1a75a7d075c73a0edb6d41ac7e6639ae6b9907d19f029bdefa7083cd883962ea`.
- Refreshed the encrypted **Minecraft 26.3** MegaClient **0.14.3** bundle from the supplied `megaclient-0.14.3-26.3(2).jar`.
  - Original JAR SHA-256: `5f3db0b2bbf9922a762eb1745e9f6ea1c970f86cdada65d580d65fc1970f1b5d`.
- Both versions have separate protected bundles and retain their pre-existing version-specific verifiers, Minecraft/Fabric loader/Fabric API compatibility requirements, and Java 25 requirements.
- Updated the launcher release version from **1.12.7** to **1.12.8** across package, lockfile, renderer version labels, network user agent, tests and README.
- No changes to the app's layout, CSS, icons, logo or other visual design. Existing instance versions remain selectable.

## Verification before release

Run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, and `npm run build` on Windows before publishing. Test an authenticated Minecraft launch for **26.2** and **26.3**, then run `publish-megaclient-update.cmd` to publish launcher **v1.12.8**. Full Electron/Windows launch testing was not performed when this source archive was created.
