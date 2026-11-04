# MegaClient v1.12.22 — GitHub release-tag recovery

## What failed

The source commit was successfully pushed to `main`, but GitHub rejected the
separate push of the `v1.12.22` tag with an `Internal Server Error`.

At the time of inspection, the remote `main` branch pointed to:

`a4387fa63e98f59e7c90011919d4b88e0f03da51` (`Release v1.12.22`).

The remote tag was absent, so GitHub Actions had not been triggered by a tag.

## Fastest safe recovery (no new version or rebuild required)

1. Keep the existing `%USERPROFILE%\Downloads\MegaClient-Publisher` folder
   created by `publish-megaclient-update.cmd`.
2. Double-click `retry-v1.12.22-release.cmd` in this extracted folder.
3. The helper checks that GitHub `main` still points to the known release commit,
   then pushes **only the missing `v1.12.22` tag**. It retries transient errors,
   checks whether GitHub accepted the tag even if push printed an error, and
   never force-pushes or overwrites a remote tag.
4. When successful, check https://github.com/DamianGaming/MegaClient/actions
   for the Windows installer build and subsequent GitHub Release.

If the retry reports that `main` has changed, stop and inspect the newer commit.
Do not force-update the tag. If GitHub continues returning HTTP 500, check
https://www.githubstatus.com/ and retry later.

## Improvements for subsequent releases

- Both local publishing flows use `scripts/push-release-tag.mjs` for retry and
  remote verification after the release commit is pushed.
- Publishing reports success only after the remote tag resolves to the exact
  expected commit.
- The regression suite includes a local Git test with an initially rejected
  tag push, an idempotent retry, and detection of a moved `main` branch.

No Minecraft client bundles, appearance, logo, Host Servers functionality, or
WillowSMP settings were changed. Launcher version remains `1.12.22`.

This recovery package cannot itself trigger a release on a Windows machine
without Git credentials and connectivity; the retry script uses the user's
existing Git for Windows login and publisher repository.
