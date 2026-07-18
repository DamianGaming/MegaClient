# MegaClient 1.9.4 Build Report

## Completed validation

- Protected MegaClient 0.12.4 resource verification passed.
- Protected client SHA-256 remained `9989fc03ffbfacd828d84f33383fc8060c503a0efdbb0382b3220070b104eea3`.
- Launch verifier SHA-256 remained `6474a312c6e1842503407b894b0f2357c10bf986e95f4a05c6c2375b17632c22`.
- Strict TypeScript checking passed.
- Electron/Vite main-process build passed.
- Electron/Vite preload build passed.
- Electron/Vite renderer build passed.
- GitHub Actions workflow YAML was parsed successfully.
- Release workflow now has one tag-only trigger and per-tag concurrency.
- Release upload logic is idempotent and replaces matching assets on reruns.

## Account and profile changes

- Saved accounts are restored locally without a startup Microsoft validation request.
- Profile reads use the saved access token and refresh only after HTTP 401.
- Token refresh operations are single-flight.
- Transient network and service failures can use profile cache data for up to seven days.
- Automatic cosmetics loading reports one inline error rather than duplicate IPC and toast messages.

## Packaging limitation

The production Electron/Vite application build completed. A full Windows NSIS package was attempted but this environment could not download Electron packaging files from GitHub because outbound DNS access returned `EAI_AGAIN`. The GitHub Actions Windows build must therefore perform the final NSIS and updater-metadata validation.
