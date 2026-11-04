import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile as realExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'

const exec = promisify(realExecFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ts = (() => { try { return require('typescript') } catch { return require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript') } })()
const source = readFileSync(path.join(root, 'src/main/services/hostedServers.ts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText

test('server manager duplicates profiles, maintains world snapshots and provisions verified Java without installer prompts', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'megaclient-management-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const mockJdk = path.join(folder, 'fake-jdk')
  const fakeBin = path.join(mockJdk, 'jdk-25-test', 'bin')
  await fs.mkdir(fakeBin, { recursive: true })
  const javaName = process.platform === 'win32' ? 'java.exe' : 'java'
  await fs.writeFile(path.join(fakeBin, javaName), 'test-java-binary')
  const jdkArchive = path.join(folder, 'java.tar.gz')
  await exec('tar', ['-czf', jdkArchive, '-C', mockJdk, 'jdk-25-test'])
  const jdk = await fs.readFile(jdkArchive)
  const checksum = createHash('sha256').update(jdk).digest('hex')
  const oldFetch = globalThis.fetch
  let javaDownloads = 0
  const jdkLink = 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.1/test.tar.gz'
  globalThis.fetch = async url => {
    if (String(url).includes('api.adoptium.net/v3/assets/feature_releases/25/ga')) {
      return Response.json([{ binaries: [{ os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux', architecture: process.arch === 'arm64' ? 'aarch64' : 'x64', image_type: 'jdk', package: { link: jdkLink, checksum } }] }])
    }
    if (url === jdkLink) { javaDownloads++; return new Response(jdk, { headers: { 'content-length': String(jdk.length) } }) }
    throw Error('Unexpected network request ' + url)
  }
  t.after(() => { globalThis.fetch = oldFetch })
  const fakeChild = {
    execFile(command, args, opts, cb) {
      if (command === 'tar') return realExecFile(command, args, opts, cb)
      if (args[0] !== '-version') return cb(new Error('Unexpected command'))
      if (command === 'java') return cb(new Error('Java not installed'))
      if (String(command).includes('java-runtimes') && String(command).endsWith(javaName)) return cb(null, { stdout: '', stderr: 'openjdk version "25.0.1"' })
      return cb(new Error('Invalid Java executable'))
    },
    spawn(_java, _args) {
      const proc = new EventEmitter()
      proc.stdout = new EventEmitter(); proc.stderr = new EventEmitter(); proc.exitCode = null
      proc.stdin = { write(command) { if (command === 'stop\n') queueMicrotask(() => { proc.exitCode = 0; proc.emit('exit', 0, null) }) } }
      proc.kill = () => { proc.exitCode = 0; proc.emit('exit', 0, null) }
      return proc
    }
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'process', js)(specifier => specifier === './paths' ? { dataDirectory: () => folder } : specifier === 'node:child_process' ? fakeChild : require(specifier), module, module.exports, process)
  const hosting = module.exports
  await hosting.initHostedServers()
  const server = await hosting.createHostedServer({ name: 'Hosting test', slug: 'hosting-test', software: 'custom', minecraftVersion: '26.3' })
  assert.equal(server.requiredJava, 25)
  assert.equal(server.pvp, true)
  const duplicate = await hosting.duplicateHostedServer(server.id)
  assert.notEqual(duplicate.id, server.id)
  assert.notEqual(duplicate.slug, server.slug)
  assert.notEqual(duplicate.port, server.port)
  assert.equal(duplicate.eulaAccepted, false)
  const serverDir = hosting.hostedServerFolder(server.id)
  await fs.mkdir(path.join(serverDir, 'world'), { recursive: true })
  await fs.writeFile(path.join(serverDir, 'world', 'level.dat'), 'test world data')
  await fs.writeFile(path.join(serverDir, 'server.properties'), 'level-name=world\n')
  const backup = await hosting.createHostedBackup(server.id)
  assert.match(backup.name, /^world-\d{8}-\d{6}-[a-f0-9]{8}\.tar\.gz$/)
  const snapshots = await hosting.listHostedBackups(server.id)
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].name, backup.name)
  await exec('tar', ['-tzf', path.join(hosting.hostedBackupsFolder(server.id), backup.name)])
  await hosting.deleteHostedBackup(server.id, backup.name)
  assert.equal((await hosting.listHostedBackups(server.id)).length, 0)
  const verifier = readFileSync(path.join(root, 'resources/client/launch-verifier.jar'))
  await fs.writeFile(path.join(serverDir, 'server.jar'), verifier)
  await hosting.acceptHostedEula(server.id)
  const started = await hosting.startHostedServer(server.id)
  assert.equal(started.status, 'starting')
  assert.equal(javaDownloads, 1)
  await fs.access(path.join(folder, 'java-runtimes', `temurin-25-${process.platform}-${process.arch}`, 'jdk-25-test', 'bin', javaName))
  await hosting.stopHostedServer(server.id)
  await hosting.startHostedServer(server.id)
  assert.equal(javaDownloads, 1, 'cached runtime should be used for later starts')
  await hosting.stopHostedServer(server.id)
})
