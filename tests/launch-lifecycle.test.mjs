import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/main/services/launcher.ts', import.meta.url), 'utf8')
const cosmetic = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const modrinth = readFileSync(new URL('../src/main/services/modrinth.ts', import.meta.url), 'utf8')

test('protected client remains staged until the actual game close event', () => {
  assert.match(source, /let gameSpawned = false/)
  assert.match(source, /launcher\.on\('launch_launch',[\s\S]*?gameSpawned = true/)
  assert.match(source, /launcher\.on\('launch_close',[\s\S]*?finishGameSession\(code\)/)
  assert.match(source, /if \(!gameSpawned\) await finishGameSession\(\)/)
  assert.match(source, /if \(sessionFinalized\) return/)
  assert.doesNotMatch(source, /finally \{\s*setGamePerformanceMode\(mainWindow, false\)\s*restoreEnvironment\(\)\s*await cleanupPayload\(\)/)
})

test('compatible locally installed Fabric API is reused before downloading', () => {
  assert.match(modrinth, /findLocalFabricApi\(instance, minimumVersion/)
  assert.match(modrinth, /metadata\.id !== 'fabric-api'/)
  assert.match(modrinth, /meetsMinimumVersion\(metadata\.version, minimumVersion\)/)
  assert.match(source, /24 \* 60 \* 60_000, '0\.152\.2'/)
})

test('navigation and home use the new workspace and play-first layout', () => {
  assert.match(cosmetic, /className="workspace-topline"/)
  assert.match(cosmetic, /className="play-workspace"/)
  assert.match(cosmetic, /className="home-command-list"/)
  assert.match(cosmetic, /className="login-shell clean-login"/)
})
