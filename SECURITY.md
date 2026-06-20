# Security notes

- Microsoft refresh tokens and Minecraft access tokens are stored through the operating system credential vault using the Rust `keyring` crate.
- The JSON account store contains profile metadata only; it does not intentionally contain refresh tokens.
- The Tauri renderer is restricted by a content security policy and receives a narrow command-based API rather than Node.js access.
- Modrinth downloads are verified with the SHA-1 hash supplied by Modrinth when available.
- `.mrpack` paths are normalized and traversal paths are rejected before extraction.
- Never commit a Microsoft client secret. Desktop device-code applications use a public client ID, not a bundled secret.
