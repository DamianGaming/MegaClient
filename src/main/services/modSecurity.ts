import fs from 'node:fs/promises'
import os from 'node:os'
import { createRequire } from 'node:module'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

export interface ModSecurityFinding {
  category: 'mod'
  title: string
  detail: string
}

interface WorkerReply {
  id: number
  finding: ModSecurityFinding | null
}

interface QueuedScan {
  id: number
  file: string
  resolve: (finding: ModSecurityFinding | null) => void
}

interface WorkerSlot {
  worker: Worker
  busy: boolean
  taskId?: number
  retired?: boolean
}

const nodeRequire = createRequire(import.meta.url)
const ADM_ZIP_MODULE = nodeRequire.resolve('adm-zip')

// Archive parsing and decompression are intentionally kept off Electron's main
// thread. Large mod folders can otherwise make the whole launcher appear frozen.
const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const path = require('node:path')
const AdmZip = require(workerData.admZipModule)

const BLOCKED = new Map([
  ['meteorclient', 'Meteor Client'],
  ['liquidbounce', 'LiquidBounce'],
  ['wurstclient', 'Wurst Client'],
  ['aristois', 'Aristois'],
  ['impactclient', 'Impact Client'],
  ['bleachhack', 'BleachHack'],
  ['inertiaclient', 'Inertia Client'],
  ['sigmaclient', 'Sigma Client'],
  ['futureclient', 'Future Client'],
  ['rusherhack', 'RusherHack'],
  ['vapeclient', 'Vape Client'],
  ['horionclient', 'Horion Client'],
  ['nursultanclient', 'Nursultan Client'],
  ['ghostclient', 'Ghost Client'],
  ['doomsdayclient', 'Doomsday Client'],
  ['prestigeclient', 'Prestige Client']
])

const FILE_ALIASES = new Map([
  ['meteorclient', 'Meteor Client'], ['meteor-client', 'Meteor Client'],
  ['liquidbounce', 'LiquidBounce'],
  ['wurstclient', 'Wurst Client'], ['wurst-client', 'Wurst Client'],
  ['aristois', 'Aristois'],
  ['impactclient', 'Impact Client'], ['impact-client', 'Impact Client'],
  ['bleachhack', 'BleachHack'], ['bleach-hack', 'BleachHack'],
  ['inertiaclient', 'Inertia Client'], ['inertia-client', 'Inertia Client'],
  ['sigmaclient', 'Sigma Client'], ['sigma-client', 'Sigma Client'],
  ['futureclient', 'Future Client'], ['future-client', 'Future Client'],
  ['rusherhack', 'RusherHack'], ['rusher-hack', 'RusherHack'],
  ['vapeclient', 'Vape Client'], ['vape-client', 'Vape Client'],
  ['horionclient', 'Horion Client'], ['horion-client', 'Horion Client'],
  ['nursultanclient', 'Nursultan Client'], ['nursultan-client', 'Nursultan Client'],
  ['ghostclient', 'Ghost Client'], ['ghost-client', 'Ghost Client'],
  ['doomsdayclient', 'Doomsday Client'], ['doomsday-client', 'Doomsday Client'],
  ['prestigeclient', 'Prestige Client'], ['prestige-client', 'Prestige Client']
])

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
function add(values, value) {
  if (typeof value !== 'string') return
  const identity = normalise(value)
  if (identity) values.add(identity)
}
function json(zip, name) {
  const entry = zip.getEntry(name)
  if (!entry || entry.isDirectory) return undefined
  try { return JSON.parse(entry.getData().toString('utf8')) } catch { return undefined }
}
function identities(zip) {
  const values = new Set()
  const fabric = json(zip, 'fabric.mod.json')
  add(values, fabric && fabric.id)
  add(values, fabric && fabric.name)

  const quilt = json(zip, 'quilt.mod.json')
  add(values, quilt && quilt.quilt_loader && quilt.quilt_loader.id)
  add(values, quilt && quilt.metadata && quilt.metadata.name)

  const legacy = json(zip, 'mcmod.info')
  const entries = Array.isArray(legacy) ? legacy : legacy && typeof legacy === 'object' ? [legacy] : []
  for (const entry of entries) {
    add(values, entry && (entry.modid || entry.modId))
    add(values, entry && entry.name)
  }

  for (const name of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
    const entry = zip.getEntry(name)
    if (!entry || entry.isDirectory) continue
    const text = entry.getData().toString('utf8').slice(0, 500000)
    for (const match of text.matchAll(/^\s*(?:modId|displayName)\s*=\s*["']([^"']+)["']/gim)) add(values, match[1])
  }

  const manifest = zip.getEntry('META-INF/MANIFEST.MF')
  if (manifest && !manifest.isDirectory) {
    const text = manifest.getData().toString('utf8').slice(0, 200000)
    for (const match of text.matchAll(/^(?:Implementation-Title|Specification-Title|Automatic-Module-Name):\s*(.+)$/gim)) add(values, match[1] && match[1].trim())
  }
  return values
}
function filenameFinding(file) {
  const base = path.basename(file).toLowerCase().replace(/\.jar(?:\.disabled)?$/i, '')
  for (const [alias, label] of FILE_ALIASES) {
    if (base === alias) return label
    if (!base.startsWith(alias + '-') && !base.startsWith(alias + '_') && !base.startsWith(alias + '.')) continue
    const remainder = base.slice(alias.length + 1)
    // Addons, compatibility bridges and integrations are legitimate. Only a
    // clear release/build suffix is considered high-confidence evidence.
    if (/^(?:v?\d|b\d|build[-_.]?\d|release[-_.]?\d)/i.test(remainder)) return label
  }
  return null
}
function inspect(file) {
  try {
    const zip = new AdmZip(file)
    let declared = null
    for (const identity of identities(zip)) {
      const label = BLOCKED.get(identity)
      if (label) { declared = label; break }
    }
    const filename = filenameFinding(file)
    const evidence = declared
      ? declared + " is declared as this mod's own ID or display name"
      : filename
        ? filename + " matches this JAR's versioned release filename"
        : null
    return evidence ? {
      category: 'mod',
      title: 'Blocked client modification detected',
      detail: path.basename(file) + ' was identified from high-confidence identity evidence: ' + evidence + '.'
    } : null
  } catch {
    // Broken archives are left to the loader's normal diagnostics. They are not
    // silently reclassified as cheats.
    return null
  }
}
parentPort.on('message', ({ id, file }) => {
  parentPort.postMessage({ id, finding: inspect(file) })
})
`

const scanCache = new Map<string, { stamp: string; finding: ModSecurityFinding | null }>()
const queue: QueuedScan[] = []
const pending = new Map<number, QueuedScan>()
const workers: WorkerSlot[] = []
const MAX_WORKERS = Math.max(1, Math.min(2, os.availableParallelism?.() ?? os.cpus().length ?? 1))
const IDLE_SHUTDOWN_DELAY = 8_000
let nextTaskId = 1
let idleShutdownTimer: NodeJS.Timeout | null = null

function clearIdleShutdown(): void {
  if (idleShutdownTimer) clearTimeout(idleShutdownTimer)
  idleShutdownTimer = null
}

function scheduleIdleShutdown(): void {
  clearIdleShutdown()
  if (queue.length || workers.some((slot) => slot.busy)) return
  idleShutdownTimer = setTimeout(() => {
    idleShutdownTimer = null
    for (const slot of workers.splice(0, workers.length)) {
      slot.retired = true
      void slot.worker.terminate().catch(() => undefined)
    }
  }, IDLE_SHUTDOWN_DELAY)
  idleShutdownTimer.unref()
}

function createWorkerSlot(): WorkerSlot {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { admZipModule: ADM_ZIP_MODULE }
  })
  const slot: WorkerSlot = { worker, busy: false }
  worker.on('message', (reply: WorkerReply) => {
    if (slot.retired) return
    const task = pending.get(reply.id)
    pending.delete(reply.id)
    slot.busy = false
    slot.taskId = undefined
    slot.worker.unref()
    task?.resolve(reply.finding)
    drainQueue()
  })
  worker.on('error', () => recoverWorker(slot))
  worker.on('exit', (code) => {
    if (code !== 0) recoverWorker(slot)
  })
  worker.unref()
  return slot
}

function recoverWorker(slot: WorkerSlot): void {
  if (slot.retired) return
  slot.retired = true
  if (slot.taskId != null) {
    const task = pending.get(slot.taskId)
    pending.delete(slot.taskId)
    task?.resolve(null)
  }
  const index = workers.indexOf(slot)
  if (index >= 0) workers.splice(index, 1)
  drainQueue()
}

function ensureWorkers(): void {
  const needed = Math.min(MAX_WORKERS, Math.max(1, queue.length))
  while (workers.length < needed) workers.push(createWorkerSlot())
}

function drainQueue(): void {
  clearIdleShutdown()
  if (queue.length) ensureWorkers()
  for (const slot of workers) {
    if (slot.busy || slot.retired) continue
    const task = queue.shift()
    if (!task) break
    slot.busy = true
    slot.taskId = task.id
    slot.worker.ref()
    pending.set(task.id, task)
    slot.worker.postMessage({ id: task.id, file: task.file })
  }
  scheduleIdleShutdown()
}

async function fileStamp(file: string): Promise<string> {
  const stat = await fs.stat(file)
  return `${stat.size}:${Math.floor(stat.mtimeMs)}`
}

function scanInWorker(file: string): Promise<ModSecurityFinding | null> {
  return new Promise((resolve) => {
    queue.push({ id: nextTaskId++, file, resolve })
    drainQueue()
  })
}

export async function inspectModJar(file: string): Promise<ModSecurityFinding | null> {
  try {
    const stamp = await fileStamp(file)
    const cached = scanCache.get(file)
    if (cached?.stamp === stamp) return cached.finding
    const finding = await scanInWorker(file)
    scanCache.set(file, { stamp, finding })
    if (scanCache.size > 1_000) {
      for (const key of scanCache.keys()) {
        scanCache.delete(key)
        if (scanCache.size <= 700) break
      }
    }
    return finding
  } catch {
    return null
  }
}
