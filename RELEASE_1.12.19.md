# MegaClient Launcher 1.12.19

## Local server hosting enhancements

- Dynamically discover Minecraft server versions from Mojang, Fabric, PaperMC Fill v3, and Purpur.
- Create and manage Vanilla, Paper, Purpur, Folia, Fabric, and Custom JAR servers.
- Accept an exact Minecraft version beyond 26.2 and 26.3, provided the selected project offers a runnable server build.
- Verify Paper/Folia downloads against official SHA-256 checksums. Use stable builds only.
- Preserve installed builds across restarts rather than silently updating server software.
- Select Java version requirements according to Minecraft version family.
- Allow manual runnable server JARs for unsupported software types.
- Existing worlds, WillowSMP, client bundles, v0.13.1 relay, and visual design are unchanged.

### Verification limits

Source-level tests cover metadata, integrity, Java version selection, custom JAR handling, relay and existing launcher tests. Full Windows/Electron builds and real public joins must still be tested on Windows.
