import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { sourcemap: true }
  },
  preload: {
    // Sandboxed Electron preload scripts cannot execute native ESM imports.
    // Force one CommonJS preload bundle so contextBridge remains available.
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
          inlineDynamicImports: true
        }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    base: './',
    plugins: [react()],
    build: {
      sourcemap: true,
      assetsDir: 'assets'
    }
  }
})
