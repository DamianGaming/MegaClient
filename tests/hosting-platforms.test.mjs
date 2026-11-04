import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = (() => { try { return require('typescript') } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') } })()
const source = readFileSync(path.join(root, 'src/main/services/hostedServers.ts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText

test('server platform discovery, stable Paper jar verification, Java guidance and custom imports', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'megaclient-platforms-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const sample = readFileSync(path.join(root, 'resources/client/launch-verifier.jar'))
  const sha256 = createHash('sha256').update(sample).digest('hex')
  const events = []
  const proc = () => {
    const value = new EventEmitter()
    value.stdout = new EventEmitter(); value.stderr = new EventEmitter()
    value.exitCode = null
    value.stdin = { write(cmd) { if (cmd === 'stop\n') queueMicrotask(() => { value.exitCode = 0; value.emit('exit', 0, null) }) } }
    value.kill = () => { value.exitCode = 0; value.emit('exit', 0, null) }
    return value
  }
  const mod = { exports: {} }
  const fakeChild = {
    execFile(_java, _args, _options, callback) { callback(null, { stdout: '', stderr: 'openjdk version "25.0.1"' }) },
    spawn: () => proc()
  }
  new Function('require', 'module', 'exports', 'process', js)(specifier => specifier === './paths' ? { dataDirectory: () => folder } : specifier === 'node:child_process' ? fakeChild : require(specifier), mod, mod.exports, process)
  const hosted = mod.exports
  hosted.hostedServerEvents(event => events.push(event))
  assert.equal(hosted.minimumServerJava('1.16.5'), 8)
  assert.equal(hosted.minimumServerJava('1.17.1'), 16)
  assert.equal(hosted.minimumServerJava('1.20.4'), 17)
  assert.equal(hosted.minimumServerJava('1.21.11'), 21)
  assert.equal(hosted.minimumServerJava('26.3'), 25)
  await hosted.initHostedServers()

  const previousFetch = globalThis.fetch
  let downloaded = 0
  globalThis.fetch = async url => {
    if (url === 'https://fill.papermc.io/v3/projects/paper') return Response.json({ versions: { '1.21': ['1.21.11','1.21.10'], '26.3': ['26.3'] } })
    if (url === 'https://fill.papermc.io/v3/projects/folia') return Response.json({ versions: { '26.3': ['26.3'] } })
    if (url === 'https://api.purpurmc.org/v2/purpur') return Response.json({ versions: ['26.3','1.21.11'] })
    if (url === 'https://meta.fabricmc.net/v2/versions/game') return Response.json([{ version: '26.3' }, { version: '1.21.11' }])
    if (url.includes('version_manifest_v2.json')) return Response.json({ versions: [{ id: '26.3', type: 'release', url: 'https://piston-meta.mojang.com/26.3.json' }, { id: '1.21.11', type: 'release', url: 'https://piston-meta.mojang.com/1.21.11.json' }] })
    if (url === 'https://fill.papermc.io/v3/projects/paper/versions/1.21.11/builds') return Response.json([
      { id: 2, channel: 'BETA', downloads: { 'server:default': { url: 'https://fill-data.papermc.io/beta.jar' } } },
      { id: 1, channel: 'STABLE', downloads: { 'server:default': { url: 'https://fill-data.papermc.io/stable.jar', checksums: { sha256 } } } }
    ])
    if (url === 'https://api.purpurmc.org/v2/purpur/26.3') return Response.json({ builds: { latest: 3001, all: [3000, 3001] } })
    if (url === 'https://api.purpurmc.org/v2/purpur/26.3/3001/download') return new Response(sample, { headers: { 'content-length': String(sample.length) } })
    if (url === 'https://meta.fabricmc.net/v2/versions/loader/26.3') return Response.json([{ loader: { version: '0.19.5', stable: true } }])
    if (url === 'https://meta.fabricmc.net/v2/versions/installer') return Response.json([{ version: '1.1.2', stable: true }])
    if (url === 'https://meta.fabricmc.net/v2/versions/loader/26.3/0.19.5/1.1.2/server/jar') return new Response(sample, { headers: { 'content-length': String(sample.length) } })
    if (url === 'https://fill.papermc.io/v3/projects/folia/versions/26.3/builds') return Response.json([{ id: 1, channel: 'BETA', downloads: { 'server:default': { url: 'https://fill-data.papermc.io/beta.jar' } } }])
    if (url === 'https://fill-data.papermc.io/stable.jar') { downloaded++; return new Response(sample, { headers: { 'content-length': String(sample.length) } }) }
    throw Error('Unexpected external request: ' + url)
  }
  t.after(() => { globalThis.fetch = previousFetch })

  assert.deepEqual(await hosted.listHostedServerVersions('paper'), ['1.21.11','1.21.10','26.3'])
  assert.deepEqual(await hosted.listHostedServerVersions('purpur'), ['26.3','1.21.11'])
  assert.deepEqual(await hosted.listHostedServerVersions('fabric'), ['26.3','1.21.11'])
  assert.deepEqual(await hosted.listHostedServerVersions('custom'), [])
  assert.deepEqual(await hosted.listHostedServerVersions('vanilla'), ['26.3','1.21.11'])
  const profile = await hosted.createHostedServer({ name: 'Paper test', slug: 'paper-test', software: 'paper', minecraftVersion: '1.21.11', port: 25577, javaPath: 'java' })
  assert.equal(profile.minecraftVersion, '1.21.11')
  assert.equal(profile.software, 'paper')
  await hosted.acceptHostedEula(profile.id)
  await hosted.startHostedServer(profile.id)
  const destination = path.join(folder, 'hosted-servers', profile.id, 'server.jar')
  assert.equal(createHash('sha256').update(await fs.readFile(destination)).digest('hex'), sha256)
  assert.equal(downloaded, 1)
  await hosted.stopHostedServer(profile.id)
  await hosted.startHostedServer(profile.id)
  assert.equal(downloaded, 1, 'pinned server jar must be reused, not auto-updated')
  await hosted.stopHostedServer(profile.id)

  for (const [software, portNumber] of [['purpur', 25580], ['fabric', 25581]]) {
    const srv = await hosted.createHostedServer({ name: `${software} test`, slug: `${software}-test`, software, minecraftVersion: '26.3', port: portNumber })
    await hosted.acceptHostedEula(srv.id)
    await hosted.startHostedServer(srv.id)
    assert.equal(createHash('sha256').update(await fs.readFile(path.join(folder, 'hosted-servers', srv.id, 'server.jar'))).digest('hex'), sha256)
    await hosted.stopHostedServer(srv.id)
  }
  const unstable = await hosted.createHostedServer({ name: 'Folia test', slug: 'folia-test', software: 'folia', minecraftVersion: '26.3', port: 25579 })
  await hosted.acceptHostedEula(unstable.id)
  await assert.rejects(hosted.startHostedServer(unstable.id), /No stable folia/i)

  const custom = await hosted.createHostedServer({ name: 'Custom server', slug: 'custom-test', software: 'custom', minecraftVersion: '1.12.2', port: 25578, javaPath: 'java' })
  await hosted.acceptHostedEula(custom.id)
  await assert.rejects(hosted.startHostedServer(custom.id), /Place your runnable server file/i)
  const customDir = path.join(folder, 'hosted-servers', custom.id)
  await fs.writeFile(path.join(customDir, 'server.jar'), sample)
  await hosted.startHostedServer(custom.id)
  await hosted.stopHostedServer(custom.id)
  assert.ok(events.some(e => e.type === 'progress'), 'download progress visible')
})
