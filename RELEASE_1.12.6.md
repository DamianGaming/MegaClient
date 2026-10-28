# MegaClient Launcher 1.12.6

- Added MegaClient 0.14.3 for Minecraft 26.3 while keeping the protected Minecraft 26.2 client.
- Select 26.2 or 26.3 when creating a MegaClient profile. Existing profiles retain their version.
- Each game version has a separate encrypted client and game-version-specific launch verifier.
- Fabric Loader and Fabric API minimum versions are checked for the selected game version.
- Corrected launcher behavior that previously forced custom profiles back to 26.2.
- All existing UI styling, artwork, and logos remain unchanged.

Run npm ci, npm run test:release, npm run client:verify, npm run typecheck and npm run build before publishing.
