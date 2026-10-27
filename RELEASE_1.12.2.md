# MegaClient Launcher 1.12.2 — TypeScript release build fix

This patch fixes the 17 TypeScript `number | undefined` errors in `src/renderer/src/App.tsx` reported by the 1.12.1 publication attempt. The pixel-art coordinate groups now use explicitly checked tuple types, without changing any coordinates, colours, shapes, layout, styling or behaviour.

Launcher version and publishing metadata are updated to **1.12.2** in the package manifest, lockfile, renderer fallback version, HTTP User-Agent, README and release integrity test. The separate protected client remains **0.14.2**. The Discord Application ID matches the successfully verified application ID supplied in the Windows build log.

Before publishing, run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck` and `npm run build`, and check the launcher on Windows. Then run `publish-megaclient-update.cmd` and use **1.12.2** as the version. Publishing requires your own Git checkout, credentials and Windows build environment.
