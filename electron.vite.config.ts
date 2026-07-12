import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { resolve } from 'node:path'

function relativeRendererAssets(): Plugin {
  return {
    name: 'megaclient-relative-renderer-assets',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (!/\.(?:[cm]?[jt]sx?)$/.test(id)) return null

      const transformed = code
        .replaceAll('"/logo.png"', '"./logo.png"')
        .replaceAll("'/logo.png'", "'./logo.png'")

      return transformed === code
        ? null
        : {
            code: transformed,
            map: null
          }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true
    }
  },
  preload: {
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
    plugins: [relativeRendererAssets(), react()],
    build: {
      sourcemap: true,
      assetsDir: 'assets'
    }
  }
})
