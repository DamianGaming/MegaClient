import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'src/main/services/hostedServers.ts'), 'utf8')
const renderer = readFileSync(path.join(root, 'src/renderer/src/App.tsx'), 'utf8')
const preload = readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8')
const main = readFileSync(path.join(root, 'src/main/index.ts'), 'utf8')

// Also catches regressions in the boundary between UI, IPC, backend, and the unmodified relay v0.13.1.
test('local host is wired as a separate navigation tab with a restricted IPC bridge', () => {
  assert.match(renderer, /id: 'hosting', label: 'Host Servers'/)
  assert.match(renderer, /function HostedServersView/)
  assert.match(renderer, /window\.mega\.hosting\.acceptEula/)
  assert.match(preload, /'hosting:start'/)
  assert.match(preload, /'hosting:stop'/)
  assert.match(main, /initHostedServers\(\)/)
  assert.match(main, /shutdownHostedServers\(\)/)
  assert.doesNotMatch(source, /0\.0\.0\.0[^\w]|server-ip': '(?!127\.0\.0\.1)/)
  assert.match(source, /wss:\/\/relay\.megastudios\.org\.uk\/tunnel/)
})

test('real local profile persistence, EULA gate, console and v0.13.1 relay frames', async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'megaclient-hosted-test-'))
  t.after(async () => { await fs.rm(temporary, { recursive: true, force: true }) })
  // TypeScript is a dev dependency in the launcher; use the machine-wide compiler when running
  // this focused test in the standalone archive environment before npm ci is possible.
  const require = createRequire(import.meta.url)
  let ts
  try { ts = require('typescript') }
  catch { ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') }
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const events = []
  const sockets = []
  const server = net.createServer(socket => { sockets.push(socket); socket.on('data', bytes => socket.write(bytes)) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close() })
  const port = server.address().port
  const jar = readFileSync(path.join(root, 'resources/client/launch-verifier.jar'))
  const sha = createHash('sha1').update(jar).digest('hex')
  const oldFetch = globalThis.fetch
  const oldWebSocket = globalThis.WebSocket
  let ws
  const wsFrames = []
  class MockWebSocket extends EventEmitter {
    static OPEN = 1
    static CONNECTING = 0
    readyState = 0
    bufferedAmount = 0
    binaryType = ''
    constructor(url) {
      super(); assert.equal(url, 'wss://relay.megastudios.org.uk/tunnel')
      ws = this
      queueMicrotask(() => { this.readyState = 1; this.emit('open', {}) })
    }
    addEventListener(name, fn) { this.on(name, fn) }
    send(payload) {
      if (typeof payload === 'string') {
        const message = JSON.parse(payload)
        if (message.type === 'hello') {
          assert.equal(message.protocol, 1)
          assert.equal(message.requestedSlug, 'local-testing')
          assert.match(message.hostInstanceId, /^[a-f0-9-]{36}$/)
          queueMicrotask(() => {
            this.emit('message', { data: JSON.stringify({ type: 'ready', address: 'local-testing.worlds.megastudios.org.uk' }) })
            this.emit('message', { data: JSON.stringify({ type: 'stats', activePlayers: 0 }) })
          })
        } else if (message.type === 'ping') this.emit('message', { data: JSON.stringify({ type: 'pong' }) })
      } else wsFrames.push(Buffer.from(payload))
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close', { reason: '' }) }
  }
  globalThis.WebSocket = MockWebSocket
  globalThis.fetch = async url => {
    if (url.includes('/healthz')) return Response.json({ ok: true, release: '0.13.1', tcpListening: true })
    if (url.includes('version_manifest_v2')) return Response.json({ versions: [{ id: '26.3', url: 'https://piston-meta.mojang.com/26.3.json' }] })
    if (url.endsWith('26.3.json')) return Response.json({ downloads: { server: { url: 'https://piston-data.mojang.com/files/server.jar', sha1: sha } } })
    if (url.endsWith('server.jar')) return new Response(jar, { headers: { 'content-length': String(jar.length) } })
    throw Error('Unexpected download: ' + url)
  }
  t.after(() => { globalThis.fetch = oldFetch; globalThis.WebSocket = oldWebSocket })
  const fakeChild = {
    execFile(_command, _args, _opts, callback) { callback(null, { stdout: '', stderr: 'openjdk version "25.0.1" 2025-01-01' }) },
    spawn() {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.exitCode = null
      proc.stdin = { write(command) { if (command === 'stop\n') queueMicrotask(() => { proc.exitCode = 0; proc.emit('exit', 0, null) }) } }
      proc.kill = () => { proc.exitCode = 0; proc.emit('exit', 0, null) }
      queueMicrotask(() => proc.stdout.emit('data', Buffer.from('[Server thread/INFO]: Done (0.04s)! For help, type "help"\n')))
      return proc
    }
  }
  const exported = { exports: {} }
  const replacement = specifier => specifier === './paths' ? { dataDirectory: () => temporary } : specifier === 'node:child_process' ? fakeChild : require(specifier)
  new Function('require', 'module', 'exports', 'process', compiled)(replacement, exported, exported.exports, process)
  const host = exported.exports
  host.hostedServerEvents(event => events.push(event))
  await host.initHostedServers()
  const created = await host.createHostedServer({ name: 'Testing', slug: 'local-testing', port, minecraftVersion: '26.3', software: 'vanilla' })
  assert.equal(created.status, 'stopped')
  assert.equal(created.eulaAccepted, false)
  await assert.rejects(host.startHostedServer(created.id), /accept.*EULA/i)
  assert.equal(host.hostedServerAddress(created.id), 'local-testing.worlds.megastudios.org.uk')
  await host.acceptHostedEula(created.id)
  await host.startHostedServer(created.id)
  for (let i = 0; i < 50 && host.listHostedServers()[0].relayStatus !== 'online'; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(host.listHostedServers()[0].relayStatus, 'online')
  assert.equal(host.listHostedServers()[0].status, 'running')
  assert.match(await fs.readFile(path.join(temporary, 'hosted-servers', created.id, 'server.properties'), 'utf8'), /server-ip=127\.0\.0\.1/)
  const id = 17
  const hello = Buffer.alloc(9)
  hello[0] = 1; hello.writeUInt32BE(id, 1); Buffer.from('PING').copy(hello, 5)
  ws.emit('message', { data: hello.buffer.slice(hello.byteOffset, hello.byteOffset + hello.byteLength) })
  for (let i = 0; i < 50 && !wsFrames.some(frame => frame[0] === 3); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(wsFrames.some(frame => frame[0] === 2 && frame.readUInt32BE(1) === id), 'sends OPEN_ACK')
  assert.ok(wsFrames.some(frame => frame[0] === 3 && frame.readUInt32BE(1) === id && frame.subarray(5).toString() === 'PING'), 'forwards Minecraft TCP bytes in DATA frames')
  host.commandHostedServer(created.id, 'say hello')
  assert.match(host.listHostedServers()[0].logs.at(-1), /say hello/)
  await host.stopHostedServer(created.id)
  for (let i = 0; i < 25 && host.listHostedServers()[0].status !== 'stopped'; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(host.listHostedServers()[0].status, 'stopped')
  await host.removeHostedServer(created.id, false)
  assert.deepEqual(host.listHostedServers(), [])
  await fs.access(path.join(temporary, 'hosted-servers', created.id, 'server.jar')) // world/data folder preserved by default
  assert.ok(events.some(event => event.type === 'log'))
})
