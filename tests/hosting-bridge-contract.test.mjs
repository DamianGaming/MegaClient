import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(path.join(root, file), 'utf8')

test('Host Servers version discovery has a matching typed renderer bridge, preload and IPC handler', () => {
  const declaration = read('src/renderer/src/global.d.ts')
  const preload = read('src/preload/index.ts')
  const main = read('src/main/index.ts')
  const renderer = read('src/renderer/src/App.tsx')
  assert.match(declaration, /hosting:\s*\{[\s\S]*?versions\(software: string\): Promise<string\[\]>/)
  assert.match(preload, /versions:\s*\(software: string\)\s*=>\s*ipcRenderer\.invoke\('hosting:versions',\s*software\)/)
  assert.match(main, /ipcMain\.handle\('hosting:versions',\s*\(_event, software\)\s*=>\s*listHostedServerVersions\(software\)\)/)
  assert.match(renderer, /window\.mega\.hosting\.versions\(String\(form\.software\)\)/)
})
