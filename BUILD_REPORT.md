# MegaClient 1.9.3 Build Report

## Included versions

- Launcher: `1.9.3`
- Protected MegaClient client: `0.12.4`
- Minecraft target: `26.2`

## Skin upload fixes

- The skin chooser is marked busy before the Windows file dialog opens, preventing duplicate dialogs and overlapping uploads.
- Selected files are checked for a valid PNG signature, readable content, a non-empty payload, the 2 MB service limit and supported 64×64 or legacy 64×32 dimensions.
- Multipart upload data is rebuilt for every request so a token-refresh retry never reuses a consumed request body.
- A rejected access token is refreshed once before the upload is reported as failed.
- Complete and partial profile responses are merged with the existing cached profile rather than deleting omitted skins or capes.
- Successful uploads that return an empty response use short bounded profile refresh attempts instead of leaving the preview stale.
- File names are sanitised before being included in the multipart upload.

## Cape equip fixes

- Cape IDs are checked against the account's owned cape list before an equip request is sent.
- Selecting the already active cape or hiding an already hidden cape no longer sends an unnecessary service request.
- Successful cape actions update the local profile immediately when the service returns an empty or delayed response.
- Partial cape responses preserve all owned skins and capes.
- The renderer shows clear choosing, uploading, equipping and hiding states and avoids overlapping cosmetic actions.

## Account and profile reliability

- Profile and cosmetic requests retry once after a safe Microsoft account refresh when an access token is rejected.
- Existing saved-account behaviour is retained for temporary Microsoft service failures.
- In-flight profile loads are allowed to finish before a cosmetic mutation begins, preventing stale profile data from overwriting a successful update.
- Profile cache revisions are updated consistently after every successful mutation.

## Validation completed

- Protected MegaClient `0.12.4` bundle verification: passed.
- TypeScript strict type check: passed.
- Electron/Vite production build: passed.
- Packaged source and upgrade-patch archive integrity: passed after packaging.

## Environment limitation

The service calls could not be completed with a real Microsoft-owned Minecraft account in this environment. The final GitHub Actions Windows installer should therefore be tested by uploading one valid skin, equipping a cape, hiding it and reopening the cosmetics page before public release.
