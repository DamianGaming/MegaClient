# MegaClient Launcher 1.10.0

MegaClient is a clean, lightweight Minecraft launcher with isolated instances, Microsoft sign-in, content management, automatic updates, Discord activity and the protected MegaClient client.

## Versions

- Launcher: `1.10.0`
- Built-in MegaClient client: `0.14.2` (refreshed build)
- Protected Minecraft version: `26.2`
- Minimum Fabric Loader for MegaClient: `0.19.3`
- Java: `25`

## 1.10.0 highlights

- New profile importer for Modrinth, CurseForge, Lunar Client, Prism / MultiMC and normal Minecraft profile folders.
- Import into a new MegaClient instance or merge compatible content into an existing instance.
- Imports compatible mods, configs, resource packs, shaders, worlds and common profile settings.
- Refreshed protected MegaClient 0.14.2 payload and launch verifier.
- Calmer launcher design with fewer continuous animations, reduced blur/shadow work and shorter transitions.
- New installs default to reduced motion, while essential progress indicators still remain clear.
- Game performance mode also tells the renderer to avoid non-essential animation work while Minecraft is running.
- Long content lists continue to use deferred rendering to reduce UI work.

## Import safety

MegaClient only imports profile content into the chosen instance. Account credentials, launcher sessions and launcher-specific cosmetics are never copied. Existing configuration files are preserved rather than overwritten. File paths are constrained to the instance directory, symbolic links are ignored for folder imports, large archives are capped, and Modrinth downloads require HTTPS plus a declared integrity hash.

CurseForge exported ZIPs can reference hosted mod files that are not physically included in the archive. MegaClient imports bundled files from such exports; importing the already-installed CurseForge profile folder provides the most complete local copy without requiring a CurseForge API key.

## Development

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

## Publish

Double-click `publish-megaclient-update.cmd` and enter `1.10.0`.
