# MegaClient Launcher 1.12.5 — Built-in Client 0.14.3

- Integrated the user-supplied `megaclient-0.14.3.jar` as the encrypted, authenticated launcher client payload.
- Updated the bundled Fabric launch verifier to depend on and confirm `megaclient 0.14.3`, retaining all original verification logic.
- Updated protected runtime hashes, client version labels and launcher version metadata.
- Kept the client targeted at Minecraft 26.2, Java 25, Fabric Loader >=0.19.3 and Fabric API >=0.152.2+26.2, matching the supplied JAR.
- Added a release-time check to detect client/verifier version mismatches before deployment.
- All existing logo, application styles, interface layouts, and instance functionality have been preserved.

Run `npm ci`, `npm run client:verify`, `npm run test:release`, `npm run typecheck`, `npm run build`, then check a real protected Minecraft launch on Windows before publishing `v1.12.5`.

The original user-supplied loose JAR is **not** included separately. The protected bundle stages the client temporarily when launching the built-in instance.
