# Upgrade to MegaClient 1.8.1

This update improves launch protection so legitimate mods are much less likely to be mistaken for blocked clients.

## Install the patch

Extract `MegaClient-1.8.1-upgrade-patch.zip` over the root of your MegaClient 1.8.0 source folder and replace existing files.

Then run:

```bat
npm ci
npm run client:verify
npm run typecheck
npm run build
```

Publish the update with:

```bat
publish-update.cmd
```

Enter `1.8.1` when asked.

## Behaviour change

Protection no longer blocks a normal mod because a description, dependency, compatibility layer or class path contains a blocked-client name. It now requires an exact declared identity or a clear versioned release filename before stopping launch.
