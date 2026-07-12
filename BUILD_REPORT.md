# MegaClient 1.7.1 Build Report

## Protected client

- Mod ID: `megaclient`
- Version: `0.9.6`
- SHA-256: `21f4d5c2a8db99ef7a50b6e72d6a4cbc4348e6169a19a3cf1a23b889ce5f9f15`
- Fabric Loader: `>=0.19.3`
- Minecraft: `~26.2`
- Java: `>=25`

## Launch verifier

- Version: `1.7.1`
- SHA-256: `1c1b1d0152b5f483cc6e96bcd4f51c9c46c908aad579eb5462809c5ca0b79197`
- Required client: `megaclient =0.9.6`

## Source changes

- Launcher version updated to `1.7.1`.
- Branding changed to `MegaStudios`.
- Version number added to the login and signed-in interface.

## Validation

- `npm run client:verify`: PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- Encrypted payload matches the supplied MegaClient 0.9.6 JAR byte-for-byte.
- Launch verifier constants and Fabric dependency require MegaClient 0.9.6.
