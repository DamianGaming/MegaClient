# MegaClient — Local Server Hosting (Launcher 1.12.20)

This release introduces a separate **Host Servers** navigation tab. The existing partnered **Servers** page and WillowSMP are unchanged.

## How it works

1. Create a local server using **Host Servers → Create server**.
2. Choose from the available **Minecraft Java Edition versions** and **Vanilla, Paper, Purpur, Folia, Fabric or Custom JAR**. The version suggestions are loaded from official provider metadata, and you can type an exact version. Availability varies by platform.
3. Install a Java version compatible with the chosen Minecraft release (Java 8, 16, 17, 21 or 25 depending on version) on the host PC. MegaClient uses `java` in PATH or a java.exe path you enter in server settings.
4. Read and accept the Minecraft EULA in the start confirmation.
5. Select **Start server**. MegaClient downloads the official server software on first start (or uses an existing `server.jar` for Custom JAR). Stable Paper/Folia builds are selected and SHA-256 verified. An installed server build is pinned until you manually change its files or profile; no background auto-updates. The server and world are saved under the launcher's user-data directory, inside `hosted-servers/<server-id>/`.
6. After Java reports that the world is ready, the launcher opens an outbound encrypted WebSocket to your existing relay service. A valid registration will display `your-name.worlds.megastudios.org.uk` and the public connection status.
7. Friends can join from normal Minecraft Java Edition Multiplayer using this address. They do **not** need to install MegaClient. **No home-router port forwarding is needed.**

## Your existing relay

Your uploaded `relay-server.zip` is **not edited, reinstalled, repackaged or deployed**. The launcher implements its v0.13.1 host protocol:

- `wss://relay.megastudios.org.uk/tunnel` for outbound control and traffic.
- `https://relay.megastudios.org.uk/healthz` for readiness (`release: 0.13.1`, `tcpListening: true`).
- Protocol 1: `hello` with a persistent random host identity and requested name, `ready`/`stats` responses, and binary OPEN (1), OPEN_ACK (2), DATA (3), CLOSE (4) packets with a 5-byte header.
- Local guest traffic only connects to `127.0.0.1:<configured-port>`. Minecraft data travels through the existing relay, without exposing a direct inbound port on the host computer.

**Important:** Your VPS relay deployment must already be running v0.13.1, TCP port 25565 and HTTPS 443 must be reachable, and wildcard DNS `*.worlds.megastudios.org.uk` must point to the VPS. If your relay is configured with the optional `HOST_ACCESS_TOKEN`, this launcher version cannot authenticate to it yet; the default unauthenticated relay setup is supported. No credentials are included in this source ZIP.

## Local management

- **Start / Stop**: start Java asynchronously; `stop` is issued through the process stdin so Minecraft can save the world. A safety timeout is used for unresponsive processes.
- **Console**: latest 350 log lines and a command entry field when running. Be careful with privileged commands.
- **Settings**: change RAM, max players, description, difficulty, game mode, view distance, local port and Java executable while stopped. The launcher prevents an existing default world from being switched to another game version/server type without first creating a new profile.
- **Files**: open the server directory to manage worlds, whitelist.json, ops.json, plugins/mods where appropriate, server.properties and backups.
- **Remove**: removes the launcher profile without deleting the world folder by default. There is a separate, explicit destructive checkbox if you want to delete files too.
- **Fabric mods**: place matching server-side mods and Fabric API into that server's `mods` folder yourself. Client-only mods should not be copied to the dedicated server.

Each hosted server is local and remains active only while the host PC and launcher are running. The relay transports traffic, not world computation. Do not advertise the public address as online until the UI actually says the relay is online. Max player capacity may also be limited by your relay's `MAX_PLAYERS_PER_SESSION` configuration.

## Security, limits and verification

Minecraft authentication remains enabled (`online-mode=true`); the server listens on loopback and RCON/query are disabled in generated server.properties. Use vanilla whitelist commands (`whitelist on`, `whitelist add <name>`) if you want a private world. Back up world folders before major Minecraft version updates. Local world saves do not leave your PC as files.

The source-level release test exercises relay frame forwarding against a simulated WebSocket relay and loopback TCP game server. It is **not** a real Windows/Electron/Minecraft integration test. Test on Windows with Java 25, real Fabric/Vanilla server jars, deployed relay DNS/firewall and an external joining player before publishing.

## Server type compatibility (1.12.19)

| Type | Source | Notes |
| --- | --- | --- |
| Vanilla | Mojang official version manifest | Release/snapshot server JAR must actually exist |
| Paper | PaperMC Fill API v3 | Only STABLE builds, verified with the provided SHA-256 |
| Purpur | Purpur downloads API | Latest listed build for that exact Minecraft version |
| Folia | PaperMC Fill API v3 | Only STABLE builds; Folia is not interchangeable with Bukkit plugins requiring traditional threading |
| Fabric | Fabric Meta API | Stable loader and stable installer for the exact Minecraft version |
| Custom JAR | User-provided `server.jar` | For other software, including builds manually prepared with Forge/NeoForge installers |

When using **Custom JAR**, first create the profile, select **Open files** and place an executable server JAR at `server.jar`. Installer-only JARs (such as Forge and NeoForge installers) are **not** runnable servers; prepare the server according to their own official instructions first. Server types that launch through scripts or Java argument files are not fully automated through Custom JAR. This is not a claim that every Minecraft version is available from every software provider. For unusual versions, enter the exact version and expect a clear error if the provider has no compatible server download.

For modded servers, install matching server-side mods and their required APIs into the appropriate `mods` folder; Paper/Purpur/Folia use supported plugins in `plugins`. Keep worlds backed up and create a separate server profile before switching software type or game version.
