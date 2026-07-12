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
    // Force one CommonJS preload bundle so contextBridge is available while
    // preserving contextIsolation and renderer sandboxing.
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
    plugins: [react()],
    build: { sourcemap: true }
  }
})
