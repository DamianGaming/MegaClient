# MegaClient Launcher 1.12.18

- Updated protected MegaClient 0.14.3 JARs for Minecraft 26.2 and 26.3, with exact SHA-256 verification.
- Added **Host Servers** navigation and local Java Edition dedicated server management for Vanilla and Fabric on Minecraft 26.2/26.3.
- Added EULA confirmation, independent world folders, RAM and gameplay controls, Java executable selection, console commands, local server start/stop and optional profile removal without deleting saved worlds.
- Connected the local host to the supplied MegaClient World Relay 0.13.1 protocol over outbound WSS, allowing standard Minecraft clients to join on `name.worlds.megastudios.org.uk` when the relay is available.
- No modification to the user-supplied relay server. Partnered WillowSMP remains unchanged.
- Launcher appearance outside the new hosting tab remains unchanged.

**Requirements:** Java 25+ installed on the host computer and an online configured relay at `relay.megastudios.org.uk`; the relay's optional `HOST_ACCESS_TOKEN` authentication must be disabled unless the launcher is configured to send the same secret. The supplied relay ZIP is not installed or deployed by this release. This version uses the public hosting endpoint and does not yet support custom relay bearer-token authentication.

Server software is downloaded on first start (Vanilla: verified official Mojang SHA-1; Fabric: Fabric's official server launcher). Modded Fabric servers require appropriate server-side mods installed into that server's `mods` folder. Use the Files button to manage them.

**Before publishing:** Run `npm ci`, `npm run client:verify`, `npm run typecheck`, `npm run test:release`, `npm run build` and perform a real server + external guest connection on Windows.
