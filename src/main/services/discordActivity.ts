import { app } from 'electron'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LauncherInstance } from '../types'

interface DiscordActivityPayload {
  details: string
  state?: string
  timestamps?: { start?: number }
  buttons?: Array<{ label: string; url: string }>
}

const RECONNECT_DELAY = 15_000
const WEBSITE = 'https://megaclient.co.uk'

let enabled = false
let configured = false
let applicationId = ''
let socket: net.Socket | null = null
let receiveBuffer = Buffer.alloc(0)
let reconnectTimer: NodeJS.Timeout | null = null
let ready = false
let connecting: Promise<void> | null = null
let currentActivity: DiscordActivityPayload = {
  details: 'Using the MegaClient launcher',
  state: 'Choosing what to play',
  buttons: [{ label: 'Download MegaClient', url: WEBSITE }]
}

function applicationIdCandidates(): string[] {
  return [
    path.join(process.resourcesPath, 'discord', 'application-id.txt'),
    path.join(process.resourcesPath, 'resources', 'discord', 'application-id.txt'),
    path.join(app.getAppPath(), 'resources', 'discord', 'application-id.txt')
  ]
}

async function readApplicationId(): Promise<string> {
  const fromEnvironment = process.env.MEGACLIENT_DISCORD_APP_ID?.trim()
  if (fromEnvironment && /^\d{17,20}$/.test(fromEnvironment)) return fromEnvironment
  for (const candidate of applicationIdCandidates()) {
    const value = await fs.readFile(candidate, 'utf8').catch(() => '')
    const trimmed = value.trim()
    if (/^\d{17,20}$/.test(trimmed)) return trimmed
  }
  return ''
}

function ipcPath(index: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir()
  return path.join(base, `discord-ipc-${index}`)
}

function frame(opcode: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.allocUnsafe(8)
  header.writeInt32LE(opcode, 0)
  header.writeInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

function write(opcode: number, payload: unknown): void {
  if (!socket || socket.destroyed || !socket.writable) return
  socket.write(frame(opcode, payload))
}

function setActivityNow(): void {
  if (!ready) return
  write(1, {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: process.pid,
      activity: currentActivity
    },
    nonce: randomUUID()
  })
}

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect(): void {
  if (!enabled || !configured || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void ensureConnected()
  }, RECONNECT_DELAY)
  reconnectTimer.unref()
}

function handleFrame(opcode: number, payload: any): void {
  if (opcode === 3) {
    write(4, payload)
    return
  }
  if (opcode === 2) {
    socket?.destroy()
    return
  }
  if (opcode !== 1) return
  if (payload?.evt === 'READY') {
    ready = true
    setActivityNow()
  }
}

function handleData(chunk: Buffer): void {
  receiveBuffer = Buffer.concat([receiveBuffer, chunk])
  while (receiveBuffer.length >= 8) {
    const opcode = receiveBuffer.readInt32LE(0)
    const length = receiveBuffer.readInt32LE(4)
    if (length < 0 || length > 4 * 1024 * 1024) {
      socket?.destroy()
      return
    }
    if (receiveBuffer.length < 8 + length) return
    const body = receiveBuffer.subarray(8, 8 + length)
    receiveBuffer = receiveBuffer.subarray(8 + length)
    try { handleFrame(opcode, JSON.parse(body.toString('utf8'))) } catch { /* Ignore malformed Discord frames. */ }
  }
}

async function connectOnce(): Promise<void> {
  if (!enabled || !configured || (socket && !socket.destroyed)) return
  clearReconnect()

  for (let index = 0; index < 10; index += 1) {
    if (!enabled || !configured) return
    const connected = await new Promise<net.Socket | null>((resolve) => {
      const candidate = net.createConnection(ipcPath(index))
      const timeout = setTimeout(() => candidate.destroy(), 350)
      candidate.once('connect', () => {
        clearTimeout(timeout)
        resolve(candidate)
      })
      candidate.once('error', () => {
        clearTimeout(timeout)
        candidate.destroy()
        resolve(null)
      })
    })
    if (!connected) continue

    socket = connected
    ready = false
    receiveBuffer = Buffer.alloc(0)
    socket.setNoDelay(true)
    socket.on('data', handleData)
    socket.on('error', () => undefined)
    socket.on('close', () => {
      socket = null
      ready = false
      receiveBuffer = Buffer.alloc(0)
      scheduleReconnect()
    })
    write(0, { v: 1, client_id: applicationId })
    return
  }
  scheduleReconnect()
}

function ensureConnected(): Promise<void> {
  if (connecting) return connecting
  connecting = connectOnce().finally(() => { connecting = null })
  return connecting
}

export async function configureDiscordActivity(value: boolean): Promise<boolean> {
  enabled = Boolean(value)
  if (!applicationId) applicationId = await readApplicationId()
  configured = Boolean(applicationId)

  if (!enabled || !configured) {
    clearReconnect()
    if (ready) {
      write(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: randomUUID() })
    }
    socket?.destroy()
    socket = null
    ready = false
    return configured
  }

  // Connecting to the local Discord desktop IPC must never hold up the launcher
  // startup path. It reconnects quietly in the background when Discord opens.
  void ensureConnected()
  return configured
}

function instanceState(instance?: LauncherInstance): string {
  if (!instance) return 'Choosing what to play'
  const loader = instance.loader === 'vanilla' ? 'Vanilla' : instance.loader === 'neoforge' ? 'NeoForge' : instance.loader[0]!.toUpperCase() + instance.loader.slice(1)
  return `${instance.name} · Minecraft ${instance.minecraftVersion} · ${loader}`.slice(0, 128)
}

export function showLauncherActivity(instance?: LauncherInstance): void {
  currentActivity = {
    details: 'Using the MegaClient launcher',
    state: instanceState(instance),
    buttons: [{ label: 'Download MegaClient', url: WEBSITE }],
  }
  setActivityNow()
}

export function showLaunchingActivity(instance: LauncherInstance, serverAddress?: string): void {
  currentActivity = {
    details: serverAddress ? 'Joining a Minecraft server' : 'Launching Minecraft',
    state: serverAddress ? `${instance.name} · ${serverAddress}`.slice(0, 128) : instanceState(instance),
    timestamps: { start: Date.now() },
    buttons: [{ label: 'Download MegaClient', url: WEBSITE }],
  }
  setActivityNow()
}

export function showPlayingActivity(instance: LauncherInstance, serverAddress?: string, startedAt = Date.now()): void {
  currentActivity = {
    details: serverAddress ? 'Playing multiplayer' : 'Playing Minecraft',
    state: serverAddress ? `${instance.name} · ${serverAddress}`.slice(0, 128) : instanceState(instance),
    timestamps: { start: startedAt },
    buttons: [{ label: 'Download MegaClient', url: WEBSITE }],
  }
  setActivityNow()
}

export function isDiscordActivityConfigured(): boolean {
  return configured
}

export function shutdownDiscordActivity(): void {
  enabled = false
  clearReconnect()
  socket?.destroy()
  socket = null
  ready = false
}
