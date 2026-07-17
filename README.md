# MegaClient Launcher 1.8.1

MegaClient is a Windows Minecraft launcher with isolated Vanilla, Fabric, Forge and NeoForge instances, Microsoft sign-in, Modrinth content management, clear startup and launch progress, automatic updates and the protected MegaClient client.

## What changed in 1.8.1

- Launch protection now uses structured mod metadata instead of searching every filename, description, dependency and class path for loose keywords.
- Legitimate mods are no longer blocked simply because they mention a blocked client for compatibility, depend on it as an addon, or contain a similarly named class path.
- Addon-style filenames such as `meteor-client-addon.jar` and `wurst-client-addon.jar` are not treated as the original client.
- A mod is blocked only when its own declared mod ID/display name is an exact high-confidence match, or its JAR has a clear versioned release filename match.
- Fabric, Quilt, Forge, NeoForge and legacy metadata formats are checked directly.
- Protection messages now explain the exact evidence used for a block.
- The launcher security status text now makes the high-confidence policy clearer.
- MegaClient client version remains **0.11.11** for **Minecraft 26.2**.

## Setup

```bat
setup-windows.cmd
```

Development:

```bat
run-development.cmd
```

Validation:

```bat
npm run client:verify
npm run typecheck
npm run build
```

## Publishing 1.8.1

```bat
publish-update.cmd
```

Enter `1.8.1`, or run:

```powershell
powershell -ExecutionPolicy Bypass -File ".\scripts\release.ps1" -Version 1.8.1
```
