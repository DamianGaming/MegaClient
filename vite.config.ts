import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Bind explicitly so Tauri can always reach the dev server.
  server: {
    strictPort: true,
    port: 5173,
    host: "localhost",
    // Make HMR explicit for the Tauri webview.
    hmr: { protocol: "ws", host: "localhost", port: 5173 },
  },
});
