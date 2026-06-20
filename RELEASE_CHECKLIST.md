# MegaClient release checklist

1. Run the one-time setup if it has not been completed:

   ```powershell
   npm run release:setup
   ```

2. Publish with a higher version:

   ```powershell
   npm run release -- 2.3.3
   ```

3. Open the GitHub **Actions** page and wait for **Publish MegaClient Windows Release** to turn green.

4. Confirm the GitHub Release contains a Windows setup executable, `latest.json`, and updater signature files.

See [RELEASING.md](RELEASING.md) for the few important updater-key rules.
