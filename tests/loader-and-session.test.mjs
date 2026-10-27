import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const file = (name) => readFileSync(new URL(`../src/main/services/${name}.ts`, import.meta.url), 'utf8')
const launcher = file('launcher')
const versions = file('versions')
const instances = file('instances')
const modrinth = file('modrinth')

test('Maven version recommendations use all numeric components and prefer stable builds', () => {
  // Evaluate the actual dependency-free comparator, not a duplicated test implementation.
  const ts = versions.match(/^function compareMavenVersions\([\s\S]*?^\}/m)?.[0]
  assert.ok(ts, 'version comparator must exist')
  const js = ts.replace('a: string, b: string): number', 'a, b)')
    .replace('(value: string): boolean', '(value)')
  const compare = runInNewContext(`${js}; compareMavenVersions`)
  assert.deepEqual(['26.2.0.9', '26.2.0.12', '26.2.0.3'].sort(compare), ['26.2.0.12', '26.2.0.9', '26.2.0.3'])
  assert.deepEqual(['26.2.0.13-beta', '26.2.0.12', '26.2.0.10'].sort(compare), ['26.2.0.12', '26.2.0.10', '26.2.0.13-beta'])
  assert.deepEqual(['52.0.9', '52.0.48', '52.0.5'].sort(compare), ['52.0.48', '52.0.9', '52.0.5'])
})

test('launcher reserves the session before asynchronous setup and releases it after cleanup', () => {
  assert.match(launcher, /if \(activeLauncher \|\| launchReserved\) throw/)
  assert.ok(launcher.indexOf('launchReserved = true', launcher.indexOf('export async function launchInstance')) < launcher.indexOf('await resolveLoader(instance)', launcher.indexOf('export async function launchInstance')))
  assert.match(launcher, /if \(stagedPayload\) \{[\s\S]*?await stagedPayload\.cleanup\(\)/)
  assert.match(launcher, /if \(!gameSpawned\) await finishGameSession\(\)/)
  assert.match(launcher, /launcher\.on\('launch_close',[\s\S]*?finishGameSession\(code\)/)
  assert.match(launcher, /launchReserved = false[\s\S]*?activeInstanceId = null/)
})

test('loader auto-updates do not replace deliberately pinned modpack versions', () => {
  assert.match(instances, /autoUpdateLoader: loader !== 'vanilla'/)
  assert.match(launcher, /instance\.customClient \|\| instance\.autoUpdateLoader === true \|\| !instance\.loaderVersion/)
  assert.match(launcher, /if \(!refresh\) return instance/)
  assert.match(launcher, /if \(canUseOffline\) return instance/)
  assert.match(modrinth, /loaderVersion: loader\.loaderVersion, autoUpdateLoader: false/)
})

test('launcher profile still supplies version and selected loader to EML', () => {
  assert.match(launcher, /profile: \{\s*slug: instance\.slug,\s*minecraft: \{\s*version: instance\.minecraftVersion/)
  assert.match(launcher, /\{ loader: instance\.loader, version: instance\.loaderVersion \}/)
  assert.match(launcher, /storage: 'isolated'/)
  assert.match(launcher, /cleaning: \{ enabled: false \}/)
})
