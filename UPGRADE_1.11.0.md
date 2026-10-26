# Upgrade to MegaClient 1.11.0

This update is based on launcher 1.10.0. The protected MegaClient build remains **0.14.2** for **Minecraft 26.2**, but its bundled JAR has been replaced with the newest 0.14.2 build supplied for this update.

## Apply the patch

1. Make a backup of your launcher source project. Keep user profiles in their existing data directory.
2. Extract `MegaClient-1.11.0-upgrade-patch.zip` over your **1.10.0 source folder** and overwrite matching files.
3. Open a command prompt in that folder and run:

```bat
npm ci
npm run client:verify
npm run test:release
npm run typecheck
npm run build
```

4. Test the launcher locally (`npm run dev`). Verify account restoration, custom-client Minecraft launch, a saved Fabric instance, modded-instance importing, the redesigned navigation and the skin/cape preview.
5. To publish from the source folder, run `publish-megaclient-update.cmd` and enter **1.11.0**. The tag will trigger the Windows installer workflow. Do not create a separate release with the same tag.

## Key decisions

- New Fabric instances use the Fabric metadata API to list **stable versions before previews, newest first**. Existing loader selections are preserved, and custom MegaClient profiles retain the minimum loader requirement declared by the supplied client JAR.
- Vanilla, Forge and NeoForge remain available. Their version selection continues to use the upstream version metadata; do not force Fabric settings onto other loaders.
- Existing instance files, saves, accounts and imported content are not reset or migrated.
- Cosmetic animations and heavy backdrop blur are replaced by short transitions. The canvas preview is loaded only when the cosmetics page is opened.
- The source ZIP contains the encrypted client bundle but not a loose client JAR. The data in the encrypted bundle has the hash recorded in `clientPayload.ts`.

## Important test limitations

The static/source-level checks supplied in `npm run test:release` do not replace Windows installer execution, TypeScript typechecking, a live authenticated Minecraft launch, or mod compatibility testing. Test those before publishing to users.
