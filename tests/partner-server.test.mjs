import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')

test('Servers view connects to WillowSMP using the configured address', () => {
  assert.match(app, /\{ id: 'willowsmp', name: 'WillowSMP', address: 'play\.willowsmp\.co\.uk' \}/)
  assert.doesNotMatch(app, /SkyLabs|play\.sky-labs\.co\.uk|id: 'skylabs'/)
  assert.match(app, /window\.mega\.servers\.status\(server\.address, force\)/)
  assert.match(app, /window\.mega\.servers\.copyAddress\(address\)/)
  assert.match(app, /window\.mega\.instances\.launchServer\(selected\.id, address\)/)
  assert.match(app, /onClick=\{\(\) => play\(server\.address\)\}/)
})
