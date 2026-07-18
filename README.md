# MegaClient Launcher 1.9.3

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated instances, automatic Java handling, Modrinth content management, automatic launcher updates, Discord activity and the protected MegaClient profile.

## Included versions

- Launcher: `1.9.3`
- Built-in MegaClient client: `0.12.4`
- MegaClient Minecraft target: `26.2`
- Required Fabric Loader: `0.19.3` or newer

## What changed in 1.9.3

- Fixed skin uploads so opening the file picker immediately locks the action and cannot create duplicate upload dialogs.
- Improved PNG validation and clearer errors for unreadable, empty, oversized or incorrectly sized skin files.
- Skin uploads now retry once with a refreshed Microsoft session when Minecraft Services rejects an expired token.
- Successful skin uploads no longer remove cached capes when Minecraft Services returns a partial profile response.
- Improved handling for successful uploads that return no profile body by refreshing the profile with short bounded retries.
- Fixed cape selection so a successful equip or hide action is reflected immediately even when the service returns no body or delayed profile data.
- Cape updates preserve the complete owned skin and cape list instead of replacing it with incomplete response data.
- Added owned-cape validation and prevented unnecessary requests when the selected cape is already equipped.
- Added clearer live status text while choosing, uploading, equipping or hiding cosmetics.
- Improved Minecraft Services error messages and added safe account refresh handling for expired access tokens.

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

Enter `1.9.3`. The publisher validates the protected client, Discord activity configuration, TypeScript and production build before creating and pushing the GitHub release tag.

A packaged release still needs a final Windows installer test with a real Microsoft account before public distribution.
