# MegaClient Launcher 1.12.15

MegaClient is a Windows Minecraft Java Edition launcher with Microsoft sign-in, isolated game instances, mod and modpack management, third-party profile imports, server shortcuts, skins and capes, Discord activity and automatic updates.

## Versions and compatibility

- Launcher: **1.12.15**
- Protected in-game MegaClient: **0.14.3** (refreshed JARs for both supported Minecraft versions)
- Minecraft: **26.2 and 26.3**, each with separate protected client resources and verifier
- Minimum Fabric Loader: **0.19.3 (26.2)** / **0.19.5 (26.3)**
- Minimum Fabric API: **0.152.2+26.2 (26.2)** / **0.162.0+26.3 (26.3)**
- Minecraft Java runtime: **25**

Other Minecraft instances can use Vanilla, Fabric, Forge or NeoForge. Fabric Loader versions come from Fabric's live metadata with stable releases preferred; existing instance selections are not overwritten.

## This release

- A reworked workspace: minimal left rail, single Play control, current-instance status, command list, consistent controls and focused sign-in screen. Reduced shadows, gradients, blur and decorative animations; short functional transitions remain.
- Fixed protected-client files being removed immediately when the launch library finished spawning Java, before the Minecraft process actually exited.
- Launch monitoring, background update throttling and runtime cleanup now follow the actual game session instead of the initial launch promise.
- Imported Fabric instances can reuse an existing compatible Fabric API JAR, preventing a second installation of the same mod ID. Outdated or cross-version Fabric API is reported clearly.
- Reuses metadata for unchanged unrelated mod JARs during protected-client conflict scanning, reducing repeated disk reads across launches.
- Retains legacy accounts, saves, launcher settings, world imports, content installs and automated GitHub release packaging.

## Build / verification

On Windows with Node.js 22 and Git:

```bat
npm ci
npm run client:verify
npm run test:release
npm run typecheck
npm run build
```

After testing the Windows installer and a real authenticated launch, double-click `publish-megaclient-update.cmd` and enter `1.12.15`.

## Security and import safety

The protected 26.2 client is stored under `resources/client/megaclient.bundle` with verifier `launch-verifier.jar`; the 26.3 client is stored under `megaclient-26.3.bundle` with verifier `launch-verifier-26.3.jar`. The private JARs are written only to the selected isolated instance during launch and must remain available until Minecraft exits. The supplied client JAR is not a separately distributed loose resource.

The profile importer never copies account credentials, tokens or third-party launcher sessions; it constrains destination paths to the chosen instance, skips symbolic links, limits archive sizes and preserves existing files when conflicts occur.

**Important:** The source and integrity tests do not prove that an installed launcher can authenticate and run every combination of Minecraft, Fabric, Java and mods on Windows. Test a clean and an existing instance before release.
