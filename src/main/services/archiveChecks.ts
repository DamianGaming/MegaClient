import { createRequire } from 'node:module'
import { Worker } from 'node:worker_threads'

// ZIP central-directory parsing and entry inflation are synchronous in adm-zip.
// They must not execute on Electron's UI/IPC thread, especially for modpacks.
const admZipPath = createRequire(import.meta.url).resolve('adm-zip')

interface ArchiveRequest {
  mode: 'identity' | 'validate'
  file: string
  verifier?: string
  clientHash?: string
  expectedClientHash?: string
  expectedVerifierHash?: string
  clientVersion?: string
  minecraftVersion?: string
  minLoader?: string
  classVersion?: number
}

interface ArchiveReply { id: number; identity?: string | null; error?: string }

const SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const AdmZip = require(workerData.admZipPath)
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function inspect(request) {
  const zip = new AdmZip(request.file)
  const metadataEntry = zip.getEntry('fabric.mod.json')
  if (request.mode === 'identity') {
    if (!metadataEntry) return null
    try { return JSON.parse(metadataEntry.getData().toString('utf8')).id || null }
    catch { return null }
  }
  if (!request.file.toLowerCase().endsWith('.jar') || !request.verifier.toLowerCase().endsWith('.jar')) {
    throw new Error('The protected runtime files no longer have valid Fabric JAR names.')
  }
  // All file I/O and ZIP entry decompression happen off the main process.
  const client = readFileSync(request.file)
  const verifier = readFileSync(request.verifier)
  try {
    const digest = sha256(client)
    if (digest !== request.expectedClientHash || digest !== request.clientHash) {
      throw new Error('The staged MegaClient runtime changed before Fabric could start.')
    }
    if (sha256(verifier) !== request.expectedVerifierHash) {
      throw new Error('The staged MegaClient verifier changed before Fabric could start.')
    }
    if (!metadataEntry) throw new Error('The protected MegaClient JAR is missing fabric.mod.json.')
    const metadata = JSON.parse(metadataEntry.getData().toString('utf8'))
    if (metadata.id !== 'megaclient' || metadata.version !== request.clientVersion) {
      throw new Error('The protected client metadata does not match the bundled MegaClient version.')
    }
    if (metadata.environment !== 'client' || !metadata.entrypoints?.client?.includes('dev.velora.client.VeloraClient')) {
      throw new Error('The protected MegaClient JAR has no valid client entrypoint.')
    }
    if (metadata.depends?.minecraft !== '~' + request.minecraftVersion || metadata.depends?.fabricloader !== '>=' + request.minLoader) {
      throw new Error('The protected MegaClient JAR has unexpected Minecraft or Fabric requirements.')
    }
    const entry = zip.getEntry('dev/velora/client/VeloraClient.class')?.getData()
    if (!entry || entry.length < 8 || entry.readUInt32BE(0) !== 0xcafebabe) {
      throw new Error('The protected MegaClient entrypoint class is missing or invalid.')
    }
    if (entry.readUInt16BE(6) !== request.classVersion) {
      throw new Error('The protected MegaClient JAR was not compiled for the expected Java runtime.')
    }
    if (!zip.getEntry('velora.client.mixins.json')) {
      throw new Error('The protected MegaClient JAR is missing its required mixin configuration.')
    }
    return null
  } finally {
    client.fill(0)
    verifier.fill(0)
  }
}
parentPort.on('message', ({ id, request }) => {
  try { parentPort.postMessage({ id, identity: inspect(request) }) }
  catch (error) { parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
})
`

let worker: Worker | null = null
let nextId = 0
let shutdownTimer: NodeJS.Timeout | undefined
const pending = new Map<number, { resolve: (value: string | null) => void; reject: (error: Error) => void }>()

function stopWorker(error: Error): void {
  const old = worker
  worker = null
  if (shutdownTimer) clearTimeout(shutdownTimer)
  shutdownTimer = undefined
  for (const task of pending.values()) task.reject(error)
  pending.clear()
  if (old) void old.terminate().catch(() => undefined)
}

function ensureWorker(): Worker {
  if (shutdownTimer) clearTimeout(shutdownTimer)
  shutdownTimer = undefined
  if (worker) return worker
  const created = new Worker(SOURCE, { eval: true, workerData: { admZipPath } })
  worker = created
  created.on('message', (reply: ArchiveReply) => {
    const task = pending.get(reply.id)
    if (!task) return
    pending.delete(reply.id)
    if (reply.error) task.reject(new Error(reply.error))
    else task.resolve(reply.identity ?? null)
    if (!pending.size && worker === created) {
      created.unref()
      shutdownTimer = setTimeout(() => stopWorker(new Error('Archive worker idle')), 12_000)
      shutdownTimer.unref()
    }
  })
  created.on('error', (error) => { if (worker === created) stopWorker(error) })
  created.on('exit', (code) => { if (worker === created) stopWorker(new Error(`Archive inspection worker exited (${code}).`)) })
  return created
}

function requestArchive(request: ArchiveRequest): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const running = ensureWorker()
    const id = ++nextId
    pending.set(id, { resolve, reject })
    running.ref()
    running.postMessage({ id, request })
  })
}

export async function readFabricModIdentity(file: string): Promise<string | null> {
  return requestArchive({ mode: 'identity', file })
}

export async function verifyStagedClient(
  file: string, verifier: string, clientHash: string,
  expectedClientHash: string, expectedVerifierHash: string,
  clientVersion: string, minecraftVersion: string, minLoader: string, classVersion: number
): Promise<void> {
  await requestArchive({
    mode: 'validate', file, verifier, clientHash, expectedClientHash, expectedVerifierHash,
    clientVersion, minecraftVersion, minLoader, classVersion
  })
}
