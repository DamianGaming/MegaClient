# MegaClient Launcher 1.9.1

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.1`
- Built-in MegaClient client: `0.12.1`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer

## What changed in 1.9.1

- Replaced the protected in-game client with MegaClient `0.12.1`.
- Rebuilt the cape preview using Minecraft's correct visible cape texture region.
- Corrected front/rear cape orientation so the cape artwork faces outward rather than toward the player model.
- Replaced disconnected cape blocks with a continuous curved cape mesh.
- Added correct classic and slim-arm UV mapping.
- Added support for higher-resolution skin and cape textures that use normal Minecraft proportions.
- Improved cape thumbnails so they show the actual visible cape artwork instead of the complete texture template.
- Suspended preview rendering while the cosmetics page is hidden or off-screen.
- Removed React rerenders during preview rotation and zooming.
- Added a bounded texture cache and a canvas pixel budget to reduce GPU and memory use.
- Improved preview loading and failure states.

## Development

```bat
npm ci
npm run dev
```

Validate a release build:

```bat
npm run client:verify
npm run typecheck
npm run build
```

## Publishing

Double-click:

```text
publish-megaclient-update.cmd
```

Enter `1.9.1`. The publisher validates the protected client, Discord activity configuration, TypeScript and production build before creating and pushing the GitHub release tag.

A packaged release still needs a final Windows installer test with a real Microsoft account before public distribution.
