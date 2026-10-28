import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

const root = new URL('../src/main/services/', import.meta.url)
const source = await readFile(new URL('archiveChecks.ts', root), 'utf8')
const clientSource = await readFile(new URL('clientPayload.ts', root), 'utf8')
const launcherSource = await readFile(new URL('launcher.ts', root), 'utf8')
const securitySource = await readFile(new URL('security.ts', root), 'utf8')
const appSource = await readFile(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')

test('archive parsing and verification do not block Electron main process', async () => {
  assert.match(clientSource, /await readFabricModIdentity\(file\)/)
  assert.match(clientSource, /await verifyStagedClient\(jarPath, verifierPath/)
  assert.match(launcherSource, /await validatePreparedClientPayload\(payload, instance\.minecraftVersion\)/)
  assert.doesNotMatch(clientSource, /readFileSync|new AdmZip\(/)
  assert.match(source, /new Worker\(SOURCE, \{ eval: true/)
  assert.match(securitySource, /scanInstanceMods\(instance, onProgress\)/)
  assert.match(launcherSource, /consoleFlushInFlight/)
  assert.match(appSource, /highestLaunchProgress\.current/)
})

test('archive worker validates metadata and detects tampered client without UI-thread work', async () => {
  // Execute the exact embedded worker source, with a small test ZIP adapter.
  // The production worker supplies the actual adm-zip module in its place.
  // Git may check out TypeScript sources using Windows CRLF line endings.
  // Match whitespace around the template boundary independently of newline style.
  const workerPattern = /const SOURCE = String\.raw`([\s\S]*?)`\s*let worker:/
  const match = source.match(workerPattern)
  const windowsMatch = source.replace(/\r?\n/g, '\r\n').match(workerPattern)
  assert.ok(windowsMatch, 'worker source must be available after Windows CRLF checkout')
  assert.equal(windowsMatch[1].replace(/\r\n/g, '\n'), match?.[1]?.replace(/\r\n/g, '\n'))
  assert.ok(match, 'worker source must be available')
  const directory = await mkdtemp(path.join(tmpdir(), 'megaclient-archive-'))
  const mock = path.join(directory, 'zip.cjs')
  const jar = path.join(directory, 'client.jar')
  const verifier = path.join(directory, 'verifier.jar')
  let worker
  try {
    await writeFile(mock, `const fs=require('node:fs');module.exports=class Zip{constructor(file){this.file=file}getEntry(name){const entries=JSON.parse(fs.readFileSync(this.file+'.entries','utf8'));return entries[name]?{getData(){return Buffer.from(entries[name],'base64')}}:null}}`)
    const classBytes = Buffer.alloc(8)
    classBytes.writeUInt32BE(0xcafebabe, 0)
    classBytes.writeUInt16BE(69, 6)
    const metadata = {
      id: 'megaclient', version: '0.14.3', environment: 'client',
      entrypoints: { client: ['dev.velora.client.VeloraClient'] },
      depends: { minecraft: '~26.2', fabricloader: '>=0.19.3' }
    }
    const entries = {
      'fabric.mod.json': Buffer.from(JSON.stringify(metadata)).toString('base64'),
      'dev/velora/client/VeloraClient.class': classBytes.toString('base64'),
      'velora.client.mixins.json': Buffer.from('{}').toString('base64')
    }
    await writeFile(jar + '.entries', JSON.stringify(entries))
    await writeFile(jar, 'client payload test bytes')
    await writeFile(verifier, 'verifier bytes')
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    const clientHash = hash(await readFile(jar))
    const verifierHash = hash(await readFile(verifier))
    worker = new Worker(match[1], { eval: true, workerData: { admZipPath: mock } })
    const inbox = new Map()
    worker.on('message', (message) => {
      const resolve = inbox.get(message.id)
      inbox.delete(message.id)
      resolve?.(message)
    })
    const ask = (id, request) => new Promise((resolve) => { inbox.set(id, resolve); worker.postMessage({ id, request }) })
    const identity = await ask(1, { mode: 'identity', file: jar })
    assert.equal(identity.identity, 'megaclient')
    const validRequest = {
      mode: 'validate', file: jar, verifier, clientHash, expectedClientHash: clientHash,
      expectedVerifierHash: verifierHash, clientVersion: '0.14.3', minecraftVersion: '26.2',
      minLoader: '0.19.3', classVersion: 69
    }
    assert.equal((await ask(2, validRequest)).error, undefined)
    await writeFile(verifier, 'tampered verifier')
    assert.match((await ask(3, validRequest)).error, /verifier changed/)
  } finally {
    if (worker) await worker.terminate()
    await rm(directory, { force: true, recursive: true })
  }
})
