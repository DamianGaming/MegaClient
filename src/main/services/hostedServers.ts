/** Local Java Edition server management. All Minecraft computation and world data remain on the user's PC.
 * This is a client of the supplied MegaClient World Relay v0.13.1 protocol; it NEVER edits or deploys that relay.
 */
import { randomUUID, createHash } from 'node:crypto'
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { dataDirectory } from './paths'

const execFileAsync = promisify(execFile)
const RELAY_URL = 'wss://relay.megastudios.org.uk/tunnel'
const RELAY_DOMAIN = 'worlds.megastudios.org.uk'
const MAX_FRAME = 65536
const MAX_WS_BUFFER = 4 * 1024 * 1024
const MAX_SOCKET_BUFFER = 2 * 1024 * 1024
const MAX_DOWNLOAD = 180 * 1024 * 1024
const FRAME = { OPEN: 1, ACK: 2, DATA: 3, CLOSE: 4 } as const
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/
const RESERVED = new Set(['relay','www','api','admin','support','status','health','ready','metrics','minecraft','megaclient'])

export type ServerSoftware = 'vanilla' | 'paper' | 'purpur' | 'folia' | 'fabric' | 'custom'
type MinecraftVersion = string
type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard'
type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator'
export interface HostedServerConfig {
  id: string
  identity: string
  name: string
  slug: string
  minecraftVersion: MinecraftVersion
  software: ServerSoftware
  port: number
  memoryMb: number
  maxPlayers: number
  motd: string
  difficulty: Difficulty
  gamemode: GameMode
  viewDistance: number
  javaPath: string
  eulaAccepted: boolean
  createdAt: string
  updatedAt: string
}
export type HostedStatus = 'stopped' | 'installing' | 'starting' | 'running' | 'stopping' | 'error'
export interface HostedServerView extends Omit<HostedServerConfig, 'identity'> {
  status: HostedStatus
  relayStatus: 'offline' | 'connecting' | 'online'
  address?: string
  players: number
  error?: string
  logs: string[]
}
interface RunningServer {
  proc: ChildProcessWithoutNullStreams | null
  status: HostedStatus
  relayStatus: HostedServerView['relayStatus']
  address?: string
  players: number
  error?: string
  logs: string[]
  stopping: boolean
  relay?: RelayClient
  stopTimer?: NodeJS.Timeout
}

const configs = new Map<string, HostedServerConfig>()
const running = new Map<string, RunningServer>()
const tasks = new Set<string>()
let listener: ((event: { type: 'state' | 'log' | 'progress'; id: string; message?: string; percent?: number }) => void) | undefined
let initialised = false
const baseDir = () => path.join(dataDirectory(), 'hosted-servers')
const configFile = () => path.join(baseDir(), 'servers.json')
const dirFor = (id: string) => path.join(baseDir(), id)
const serverJar = (id: string) => path.join(dirFor(id), 'server.jar')

export function hostedServerEvents(callback: typeof listener): void { listener = callback }
function emit(id: string, type: 'state' | 'log' | 'progress' = 'state', message?: string, percent?: number): void { listener?.({ type, id, message, percent }) }
function log(id: string, message: string): void {
  const runtime = running.get(id)
  if (!runtime) return
  const cleaned = message.replace(/\x1b\[[0-9;]*m/g, '').replace(/[\x00-\x08\x0b-\x1f]/g, '').slice(0, 900)
  if (!cleaned) return
  runtime.logs.push(cleaned)
  if (runtime.logs.length > 350) runtime.logs.splice(0, runtime.logs.length - 350)
  emit(id, 'log', cleaned)
}
function getConfig(id: string): HostedServerConfig {
  const config = configs.get(id)
  if (!config) throw new Error('This server could not be found.')
  return config
}
function view(config: HostedServerConfig): HostedServerView {
  const active = running.get(config.id)
  const { identity: _identity, ...data } = config
  return { ...data, status: active?.status ?? 'stopped', relayStatus: active?.relayStatus ?? 'offline', address: active?.address,
    players: active?.players ?? 0, error: active?.error, logs: [...(active?.logs ?? [])] }
}
let saveQueue: Promise<void> = Promise.resolve()
function persist(): Promise<void> {
  const snapshot = JSON.stringify([...configs.values()], null, 2)
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(baseDir(), { recursive: true })
    const tmp = path.join(baseDir(), `servers.${process.pid}.${randomUUID()}.tmp`)
    try {
      await fs.writeFile(tmp, snapshot, { mode: 0o600 })
      await fs.rename(tmp, configFile())
    } finally { await fs.rm(tmp, { force: true }).catch(() => undefined) }
  })
  return saveQueue
}
const validSlug = (slug: string) => SLUG.test(slug) && !slug.includes('--') && !RESERVED.has(slug)
function sanitise(input: Partial<HostedServerConfig>, previous?: HostedServerConfig): HostedServerConfig {
  const name = String(input.name ?? previous?.name ?? '').trim()
  const slug = String(input.slug ?? previous?.slug ?? '').trim().toLowerCase()
  if (name.length < 2 || name.length > 48) throw new Error('Enter a server name between 2 and 48 characters.')
  if (!validSlug(slug)) throw new Error('Public address must be 3–32 letters, numbers or single hyphens.')
  const version = input.minecraftVersion ?? previous?.minecraftVersion ?? '26.3'
  if (typeof version !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,59}$/.test(version)) throw new Error('Enter a valid Minecraft version, for example 26.3 or 1.21.11.')
  const software = input.software ?? previous?.software ?? 'vanilla'
  if (!(['vanilla', 'paper', 'purpur', 'folia', 'fabric', 'custom'] as string[]).includes(software)) throw new Error('Choose a supported server type.')
  const port = Number(input.port ?? previous?.port ?? 25565)
  const memoryMb = Number(input.memoryMb ?? previous?.memoryMb ?? 3072)
  const maxPlayers = Number(input.maxPlayers ?? previous?.maxPlayers ?? 8)
  const viewDistance = Number(input.viewDistance ?? previous?.viewDistance ?? 8)
  if (![port, memoryMb, maxPlayers, viewDistance].every(Number.isInteger) || port < 1024 || port > 65535 || memoryMb < 1024 || memoryMb > 32768 || maxPlayers < 1 || maxPlayers > 100 || viewDistance < 2 || viewDistance > 32) {
    throw new Error('Port, RAM, player limit or view distance is outside the allowed range.')
  }
  const difficulty = input.difficulty ?? previous?.difficulty ?? 'normal'
  const gamemode = input.gamemode ?? previous?.gamemode ?? 'survival'
  if (!(['peaceful','easy','normal','hard'] as string[]).includes(difficulty) || !(['survival','creative','adventure','spectator'] as string[]).includes(gamemode)) throw new Error('Invalid game settings.')
  const motd = String(input.motd ?? previous?.motd ?? 'Hosted with MegaClient').trim().replace(/[\r\n]/g, ' ').slice(0, 100)
  const javaPath = String(input.javaPath ?? previous?.javaPath ?? '').trim()
  if (javaPath.length > 700 || /[\x00\r\n]/.test(javaPath)) throw new Error('Invalid Java executable path.')
  return {
    id: previous?.id ?? randomUUID(), identity: previous?.identity ?? randomUUID(), name, slug, minecraftVersion: version,
    software, port, memoryMb, maxPlayers, motd, difficulty, gamemode, viewDistance, javaPath,
    eulaAccepted: previous?.eulaAccepted ?? false, createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString()
  }
}
export async function initHostedServers(): Promise<void> {
  if (initialised) return
  initialised = true
  try {
    const saved = JSON.parse(await fs.readFile(configFile(), 'utf8')) as unknown
    if (!Array.isArray(saved)) return
    for (const value of saved.slice(0, 60)) {
      if (!value || typeof value !== 'object') continue
      const item = value as HostedServerConfig
      try {
        if (!/^[0-9a-f-]{36}$/.test(item.id) || !/^[0-9a-f-]{36}$/.test(item.identity)) continue
        const clean = sanitise(item, item)
        configs.set(clean.id, clean)
      } catch { /* ignore corrupt persisted entries */ }
    }
  } catch { /* first startup */ }
}
export function listHostedServers(): HostedServerView[] { return [...configs.values()].map(view) }
export async function createHostedServer(input: Partial<HostedServerConfig>): Promise<HostedServerView> {
  if (configs.size >= 32) throw new Error('The maximum of 32 local server profiles has been reached.')
  const config = sanitise(input)
  if ([...configs.values()].some(item => item.slug === config.slug)) throw new Error('You already have a server using this public address.')
  configs.set(config.id, config)
  try { await fs.mkdir(dirFor(config.id), { recursive: true }); await persist() }
  catch (error) { configs.delete(config.id); throw error }
  emit(config.id)
  return view(config)
}
export async function updateHostedServer(id: string, patch: Partial<HostedServerConfig>): Promise<HostedServerView> {
  const old = getConfig(id)
  if (tasks.has(id) || (running.get(id)?.status !== undefined && running.get(id)?.status !== 'stopped' && running.get(id)?.status !== 'error')) throw new Error('Stop the server before editing its settings.')
  const config = sanitise(patch, old)
  if ([...configs.values()].some(item => item.id !== id && item.slug === config.slug)) throw new Error('Another local server already uses this public address.')
  if (config.minecraftVersion !== old.minecraftVersion || config.software !== old.software) {
    // Also protect custom world names and existing server installations. Switching server
    // software can rewrite dimension directories and corrupt modded/plugin world data.
    const entries = await fs.readdir(dirFor(id)).catch(() => [] as string[])
    if (entries.some(item => !['.megaclient-server.json', 'server.jar', 'server.properties', 'eula.txt'].includes(item))) {
      throw new Error('Server files already exist. Create another profile for a different version or server type to protect existing worlds, plugins and mods.')
    }
  }
  // Never silently delete or convert an existing world when editing settings.
  configs.set(id, config)
  await persist()
  emit(id)
  return view(config)
}
export async function acceptHostedEula(id: string): Promise<HostedServerView> {
  const config = getConfig(id)
  config.eulaAccepted = true
  await persist()
  return view(config)
}
export async function removeHostedServer(id: string, deleteFiles = false): Promise<void> {
  getConfig(id)
  if (tasks.has(id) || (running.get(id)?.status !== undefined && !['stopped','error'].includes(running.get(id)!.status))) throw new Error('Stop the server before removing it.')
  configs.delete(id)
  running.delete(id)
  await persist()
  if (deleteFiles) await fs.rm(dirFor(id), { recursive: true, force: true })
  emit(id)
}
export function hostedServerFolder(id: string): string { getConfig(id); return dirFor(id) }
export function hostedServerAddress(id: string): string { return `${getConfig(id).slug}.${RELAY_DOMAIN}` }

const META_AGENT = 'MegaClient/1.12.20 (+https://megastudios.org.uk; local Minecraft server manager)'
const SUPPORTED = ['vanilla', 'paper', 'purpur', 'folia', 'fabric', 'custom'] as const
const validVersion = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,59}$/.test(v)
const validDownload = (url: string, hosts: readonly string[]): boolean => {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && hosts.includes(parsed.hostname) && !parsed.username && !parsed.password }
  catch { return false }
}
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': META_AGENT } })
  if (!response.ok) throw new Error(`Could not retrieve server metadata (HTTP ${response.status}).`)
  return response.json() as Promise<T>
}
const versionCache = new Map<ServerSoftware, { until: number; versions: string[] }>()
export async function listHostedServerVersions(software: ServerSoftware): Promise<string[]> {
  if (!SUPPORTED.includes(software)) throw new Error('Unknown server software.')
  if (software === 'custom') return [] // Any version is allowed for a user-supplied server.jar.
  const cached = versionCache.get(software)
  if (cached && cached.until > Date.now()) return [...cached.versions]
  let raw: unknown
  if (software === 'vanilla') {
    const manifest = await getJson<{ versions: Array<{ id: string; type: string }> }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    raw = manifest.versions?.filter(item => item.type === 'release' || item.type === 'snapshot').map(item => item.id)
  } else if (software === 'fabric') {
    const data = await getJson<Array<{ version: string }>>('https://meta.fabricmc.net/v2/versions/game')
    raw = data.map(item => item.version)
  } else if (software === 'purpur') {
    const data = await getJson<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur')
    raw = data.versions
  } else {
    const data = await getJson<{ versions: Record<string, string[]> }>(`https://fill.papermc.io/v3/projects/${software}`)
    raw = Object.values(data.versions ?? {}).flat()
  }
  if (!Array.isArray(raw)) throw new Error(`The ${software} version list was unavailable.`)
  const versions = [...new Set(raw.filter(validVersion))]
  if (!versions.length) throw new Error(`No ${software} Minecraft versions were listed by the official provider.`)
  versionCache.set(software, { until: Date.now() + 15 * 60_000, versions })
  return [...versions]
}

async function download(id: string, url: string, target: string, expectedSha1?: string, expectedSha256?: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'user-agent': META_AGENT } })
  if (!response.ok || !response.body) throw new Error(`Server download failed (HTTP ${response.status}).`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) throw new Error('Server download exceeds the size limit.')
  const temporary = `${target}.${randomUUID()}.part`
  let bytes = 0
  const sha1Hash = createHash('sha1')
  const sha256Hash = createHash('sha256')
  try {
    const chunks = Readable.fromWeb(response.body as never)
    chunks.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_DOWNLOAD) chunks.destroy(new Error('Server download exceeds the size limit.'))
      sha1Hash.update(chunk)
      sha256Hash.update(chunk)
      const length = Number(response.headers.get('content-length') ?? 0)
      if (length && bytes % (1024 * 1024) < chunk.length) emit(id, 'progress', 'Downloading server software', Math.min(99, Math.round(bytes / length * 100)))
    })
    await pipeline(chunks, createWriteStream(temporary, { flags: 'wx' }))
    if (bytes < 1024 || (expectedSha1 && sha1Hash.digest('hex') !== expectedSha1.toLowerCase()) || (expectedSha256 && sha256Hash.digest('hex') !== expectedSha256.toLowerCase())) throw new Error('Server download failed its integrity check.')
    const header = await fs.open(temporary, 'r')
    try { const buf = Buffer.alloc(4); await header.read(buf, 0, 4, 0); if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Downloaded server is not a JAR archive.') }
    finally { await header.close() }
    await fs.rename(temporary, target)
    emit(id, 'progress', 'Server software downloaded', 100)
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}
async function hashLocalJar(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
/** Resolve server software only from the exact game's official project; never silently
 * install a build for another Minecraft version or fall back to an unstable channel. */
async function resolveServerDownload(config: HostedServerConfig): Promise<{ url: string; stamp: string; sha1?: string; sha256?: string }> {
  const version = encodeURIComponent(config.minecraftVersion)
  let stamp = `${config.software}/${config.minecraftVersion}`
  if (config.software === 'vanilla') {
    const index = await getJson<{ versions: Array<{ id: string; url: string }> }>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    const item = index.versions?.find(entry => entry.id === config.minecraftVersion)
    if (!item || !validDownload(item.url, ['piston-meta.mojang.com', 'launchermeta.mojang.com'])) throw new Error(`Vanilla Minecraft ${config.minecraftVersion} is not available from Mojang.`)
    const metadata = await getJson<{ downloads?: { server?: { url: string; sha1: string } } }>(item.url)
    const file = metadata.downloads?.server
    if (!file || !validDownload(file.url, ['piston-data.mojang.com', 'launcher.mojang.com', 'files.minecraft.net']) || !/^[a-f0-9]{40}$/i.test(file.sha1)) throw new Error(`Minecraft ${config.minecraftVersion} has no verified official server download.`)
    return { url: file.url, stamp, sha1: file.sha1 }
  }
  if (config.software === 'fabric') {
    const loaders = await getJson<Array<{ loader: { version: string; stable?: boolean } }>>(`https://meta.fabricmc.net/v2/versions/loader/${version}`)
    const selected = loaders.find(item => item.loader.stable) // No unstable fallback.
    if (!selected || !validVersion(selected.loader.version)) throw new Error(`No stable Fabric Loader is available for Minecraft ${config.minecraftVersion}.`)
    const installers = await getJson<Array<{ version: string; stable?: boolean }>>('https://meta.fabricmc.net/v2/versions/installer')
    const installer = installers.find(item => item.stable)
    if (!installer || !validVersion(installer.version)) throw new Error('No stable Fabric server launcher is available.')
    stamp += `/${selected.loader.version}/${installer.version}`
    return { url: `https://meta.fabricmc.net/v2/versions/loader/${version}/${encodeURIComponent(selected.loader.version)}/${encodeURIComponent(installer.version)}/server/jar`, stamp }
  }
  if (config.software === 'purpur') {
    const info = await getJson<{ builds?: { latest?: string | number; all?: number[] } }>(`https://api.purpurmc.org/v2/purpur/${version}`)
    const latest = String(info.builds?.latest ?? '')
    if (!/^\d+$/.test(latest)) throw new Error(`No Purpur build is available for Minecraft ${config.minecraftVersion}.`)
    stamp += `/${latest}`
    return { url: `https://api.purpurmc.org/v2/purpur/${version}/${latest}/download`, stamp }
  }
  if (config.software === 'paper' || config.software === 'folia') {
    const builds = await getJson<Array<{ id: number; channel: string; downloads?: Record<string, { url: string; checksums?: { sha256?: string } }> }>>(`https://fill.papermc.io/v3/projects/${config.software}/versions/${version}/builds`)
    if (!Array.isArray(builds)) throw new Error(`No ${config.software} builds were found for Minecraft ${config.minecraftVersion}.`)
    const stable = builds.filter(item => item.channel?.toUpperCase() === 'STABLE' && Number.isInteger(item.id)).sort((a, b) => b.id - a.id)[0]
    const artifact = stable?.downloads?.['server:default']
    if (!artifact || !validDownload(artifact.url, ['fill-data.papermc.io'])) throw new Error(`No stable ${config.software} server build is available for Minecraft ${config.minecraftVersion}.`)
    const sha256 = artifact.checksums?.sha256
    if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) throw new Error('PaperMC did not provide a valid SHA-256 checksum for the server build.')
    stamp += `/${stable.id}`
    return { url: artifact.url, stamp, sha256 }
  }
  throw new Error('Custom server.jar must be supplied by the user.')
}
async function prepareServerJar(id: string, config: HostedServerConfig): Promise<void> {
  const jar = serverJar(id)
  const versionFile = path.join(dirFor(id), '.megaclient-server.json')
  if (config.software === 'custom') {
    // Do not overwrite third-party installers or attempt to execute an arbitrary URL.
    const fd = await fs.open(jar, 'r').catch(() => null)
    if (!fd) throw new Error('Place your runnable server file in this server folder named server.jar, then start it. Installer-only Forge/NeoForge files must be installed separately first.')
    try { const magic = Buffer.alloc(4); await fd.read(magic, 0, 4, 0); if (magic.readUInt32LE(0) !== 0x04034b50) throw new Error('The supplied server.jar is not a JAR archive.') }
    finally { await fd.close() }
    return
  }
  const installed = await fs.readFile(versionFile, 'utf8').then(raw => JSON.parse(raw) as { stamp: string; sha256: string }).catch(() => null)
  const installedValid = async (): Promise<boolean> => Boolean(installed?.sha256 && installed.sha256 === await hashLocalJar(jar).catch(() => ''))
  const baseStamp = `${config.software}/${config.minecraftVersion}`
  // Installed builds are pinned until the server owner explicitly changes their profile.
  // This avoids an unexpected upstream update breaking a world or plugins on every boot.
  if (installed?.stamp?.startsWith(baseStamp + '/') || installed?.stamp === baseStamp) {
    if (await installedValid()) return
  }
  log(id, `Finding a stable ${config.software} server build for Minecraft ${config.minecraftVersion}…`)
  const { url, stamp, sha1, sha256 } = await resolveServerDownload(config)
  await download(id, url, jar, sha1, sha256)
  const localSha256 = await hashLocalJar(jar)
  await fs.writeFile(versionFile, JSON.stringify({ stamp, sha1, sha256: localSha256, updatedAt: new Date().toISOString() }))
}
function escapeProperty(value: string): string { return value.replace(/[\r\n]/g, ' ').replace(/\\/g, '\\\\') }
async function writeProperties(config: HostedServerConfig): Promise<void> {
  const file = path.join(dirFor(config.id), 'server.properties')
  const existing = await fs.readFile(file, 'utf8').catch(() => '')
  const changes: Record<string, string> = {
    'server-ip': '127.0.0.1', 'server-port': String(config.port), 'online-mode': 'true', 'enable-rcon': 'false',
    'max-players': String(config.maxPlayers), 'motd': escapeProperty(config.motd), 'difficulty': config.difficulty,
    'gamemode': config.gamemode, 'view-distance': String(config.viewDistance), 'enable-query': 'false'
  }
  const lines = existing.split(/\r?\n/).filter(line => line && !Object.prototype.hasOwnProperty.call(changes, line.split('=')[0] ?? ''))
  for (const [key, value] of Object.entries(changes)) lines.push(`${key}=${value}`)
  await fs.writeFile(file, `${lines.join('\n')}\n`)
}
/** Minimum Java release for official game version families. Java requirements vary by
 * Minecraft release; do not force Java 25 on users hosting older servers. */
export function minimumServerJava(version: string): number {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version)
  if (!match) return 25 // snapshots without numerical versions: conservative default
  const major = Number(match[1]); const minor = Number(match[2]); const patch = Number(match[3] ?? 0)
  if (major >= 26) return 25
  if (major !== 1) return 25
  if (minor < 17) return 8
  if (minor === 17) return 16
  if (minor < 20 || (minor === 20 && patch <= 4)) return 17
  return 21
}
async function validateJava(config: HostedServerConfig): Promise<string> {
  const java = config.javaPath || 'java'
  let output: { stdout: string; stderr: string }
  const minimum = minimumServerJava(config.minecraftVersion)
  try { output = await execFileAsync(java, ['-version'], { timeout: 9000, windowsHide: true }) }
  catch { throw new Error(`Java ${minimum}+ was not found. Install a compatible JDK or choose its java.exe path in the server settings.`) }
  const match = `${output.stdout}\n${output.stderr}`.match(/version\s+"?(1\.)?(\d+)(?:[.\s"+]|$)/i)
  const installed = match ? Number(match[2]) : 0
  if (installed < minimum) throw new Error(`Minecraft ${config.minecraftVersion} requires Java ${minimum} or newer. Found Java ${installed || 'unknown'}. Configure a compatible Java executable.`)
  return java
}
function freshRuntime(): RunningServer { return { proc: null, status: 'stopped', relayStatus: 'offline', players: 0, logs: [], stopping: false } }
export async function startHostedServer(id: string): Promise<HostedServerView> {
  const config = getConfig(id)
  if (!config.eulaAccepted) throw new Error('Please accept the Minecraft server EULA before starting.')
  if (tasks.has(id) || (running.has(id) && !['stopped', 'error'].includes(running.get(id)!.status))) throw new Error('Server is already starting or running.')
  if ([...configs.values()].some(item => item.id !== id && item.port === config.port && running.get(item.id) && !['stopped','error'].includes(running.get(item.id)!.status))) throw new Error('Another hosted server is already using that local port.')
  tasks.add(id)
  const runtime = freshRuntime()
  runtime.status = 'installing'
  running.set(id, runtime)
  emit(id)
  try {
    const java = await validateJava(config)
    await fs.mkdir(dirFor(id), { recursive: true })
    await prepareServerJar(id, config)
    await writeProperties(config)
    await fs.writeFile(path.join(dirFor(id), 'eula.txt'), '# Accepted explicitly in MegaClient\neula=true\n')
    runtime.status = 'starting'
    emit(id)
    const proc = spawn(java, [`-Xms${Math.min(config.memoryMb, 1024)}M`, `-Xmx${config.memoryMb}M`, '-jar', 'server.jar', 'nogui'], {
      cwd: dirFor(id), stdio: ['pipe','pipe','pipe'], windowsHide: true, env: { ...process.env, JAVA_TOOL_OPTIONS: undefined }
    })
    runtime.proc = proc
    let output = ''
    const onData = (data: Buffer) => {
      output += data.toString('utf8')
      if (output.length > 30_000) output = output.slice(-30_000)
      let end = output.indexOf('\n')
      while (end >= 0) {
        const line = output.slice(0, end).trim()
        output = output.slice(end + 1)
        if (line) log(id, line)
        if (line.includes('Done (') && runtime.status === 'starting') {
          runtime.status = 'running'
          emit(id)
          runtime.relay = new RelayClient(config, (status, address, players, error) => {
            runtime.relayStatus = status; runtime.address = address; runtime.players = players ?? 0
            if (error) { log(id, `[Public access] ${error}`); runtime.error = error }
            else if (status === 'online') runtime.error = undefined
            emit(id)
          })
          runtime.relay.start()
        }
        end = output.indexOf('\n')
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)
    proc.on('error', error => { runtime.status = 'error'; runtime.error = error.message; log(id, `[Java] ${error.message}`); emit(id) })
    proc.once('exit', (code, signal) => {
      if (runtime.stopTimer) clearTimeout(runtime.stopTimer)
      runtime.relay?.stop()
      runtime.relay = undefined
      runtime.proc = null
      runtime.relayStatus = 'offline'; runtime.address = undefined; runtime.players = 0
      runtime.status = runtime.stopping || code === 0 ? 'stopped' : 'error'
      if (runtime.status === 'error') runtime.error = `Java server exited (code ${code ?? 'unknown'}, signal ${signal ?? 'none'}). Check server logs.`
      log(id, runtime.status === 'stopped' ? 'Server stopped.' : runtime.error ?? 'Server exited.')
      emit(id)
    })
    emit(id)
    return view(config)
  } catch (error) {
    runtime.status = 'error'; runtime.error = error instanceof Error ? error.message : String(error)
    log(id, runtime.error); emit(id)
    throw error
  } finally { tasks.delete(id) }
}
export async function stopHostedServer(id: string): Promise<HostedServerView> {
  const config = getConfig(id)
  const runtime = running.get(id)
  if (!runtime?.proc || runtime.stopping) return view(config)
  runtime.stopping = true
  runtime.status = 'stopping'
  runtime.relay?.stop()
  runtime.relayStatus = 'offline'; runtime.address = undefined; runtime.players = 0
  emit(id)
  try { runtime.proc.stdin.write('stop\n') } catch { runtime.proc.kill() }
  runtime.stopTimer = setTimeout(() => { if (runtime.proc) runtime.proc.kill() }, 60000)
  runtime.stopTimer.unref()
  return view(config)
}
export function commandHostedServer(id: string, text: string): void {
  getConfig(id)
  const runtime = running.get(id)
  if (!runtime?.proc || runtime.status !== 'running') throw new Error('Start the server before using its console.')
  const command = String(text).trim()
  if (!command || command.length > 300 || /[\r\n\x00-\x1f]/.test(command)) throw new Error('Enter a single-line server command (up to 300 characters).')
  runtime.proc.stdin.write(command + '\n')
  log(id, `> ${command}`)
}
export function hasRunningHostedServers(): boolean {
  return [...running.values()].some(runtime => Boolean(runtime.proc))
}
let shutdownTask: Promise<void> | undefined
export function shutdownHostedServers(): Promise<void> {
  if (shutdownTask) return shutdownTask
  const waiters: Array<Promise<void>> = []
  for (const runtime of running.values()) {
    runtime.relay?.stop()
    const proc = runtime.proc
    if (!proc) continue
    runtime.stopping = true
    waiters.push(new Promise(resolve => {
      const timer = setTimeout(() => { if (proc.exitCode === null) proc.kill() }, 30000)
      const deadline = setTimeout(() => { clearTimeout(timer); resolve() }, 33000)
      proc.once('exit', () => { clearTimeout(timer); clearTimeout(deadline); resolve() })
      try { proc.stdin.write('stop\n') } catch { proc.kill() }
    }))
  }
  shutdownTask = Promise.all(waiters).then(() => undefined)
  return shutdownTask
}

/** Implements the v0.13.1 relay's HELLO/READY and 5-byte binary OPEN/ACK/DATA/CLOSE frame protocol. */
class RelayClient {
  private ws: WebSocket | undefined
  private sockets = new Map<number, net.Socket>()
  private timers = new Map<number, NodeJS.Timeout>()
  private retryTimer?: NodeJS.Timeout
  private pingTimer?: NodeJS.Timeout
  private closed = false
  private reconnectDelay = 1500
  private lastPong = Date.now()
  constructor(private config: HostedServerConfig, private status: (state: HostedServerView['relayStatus'], address?: string, players?: number, error?: string) => void) {}
  start(): void { void this.connect() }
  stop(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
    this.closeSockets()
    this.status('offline', undefined, 0)
  }
  private closeSockets(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const socket of this.sockets.values()) socket.destroy()
    this.sockets.clear()
  }
  private async connect(): Promise<void> {
    if (this.closed) return
    this.status('connecting', undefined, 0)
    try {
      const response = await fetch('https://relay.megastudios.org.uk/healthz', { signal: AbortSignal.timeout(8000) })
      if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`)
      const health = await response.json() as { ok?: boolean; release?: string; tcpListening?: boolean }
      if (!health.ok || health.release !== '0.13.1' || health.tcpListening !== true) throw new Error('Relay must be online with v0.13.1 and Minecraft TCP enabled')
    } catch (error) { this.retry(`Public hosting unavailable: ${error instanceof Error ? error.message : String(error)}`); return }
    if (this.closed) return
    let ws: WebSocket
    try { ws = new WebSocket(RELAY_URL) }
    catch (error) { this.retry(String(error)); return }
    this.ws = ws
    ws.binaryType = 'arraybuffer'
    const timeout = setTimeout(() => { if (ws.readyState !== WebSocket.OPEN) ws.close() }, 12000)
    ws.addEventListener('open', () => {
      clearTimeout(timeout)
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, requestedSlug: this.config.slug,
        hostInstanceId: this.config.identity, maxPlayers: this.config.maxPlayers,
        policy: { version: 1, disabledModules: [], disabledFeatures: [] } }))
    })
    ws.addEventListener('message', event => {
      if (this.closed || this.ws !== ws) return
      if (typeof event.data === 'string') {
        let message: { type?: string; address?: string; message?: string; activePlayers?: number }
        try { message = JSON.parse(event.data) as typeof message } catch { return }
        if (message.type === 'ready' && message.address === `${this.config.slug}.${RELAY_DOMAIN}`) {
          this.reconnectDelay = 1500; this.lastPong = Date.now()
          this.status('online', message.address, 0)
          if (this.pingTimer) clearInterval(this.pingTimer)
          this.pingTimer = setInterval(() => {
            if (Date.now() - this.lastPong > 65000) ws.close()
            else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', sent: Date.now() }))
          }, 25000)
          this.pingTimer.unref()
        } else if (message.type === 'stats') this.status('online', `${this.config.slug}.${RELAY_DOMAIN}`, message.activePlayers ?? 0)
        else if (message.type === 'pong') this.lastPong = Date.now()
        else if (message.type === 'error') this.status('offline', undefined, 0, message.message || 'Relay refused the server name.')
        return
      }
      if (event.data instanceof ArrayBuffer) this.acceptFrame(Buffer.from(event.data))
    })
    ws.addEventListener('close', event => {
      clearTimeout(timeout)
      if (this.ws !== ws) return
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.ws = undefined
      this.closeSockets()
      if (!this.closed) this.retry(`Public connection closed${event.reason ? ': ' + event.reason : ''}. Retrying…`)
    })
    ws.addEventListener('error', () => { /* close handler owns retry */ })
  }
  private retry(message: string): void {
    if (this.closed) return
    this.status('offline', undefined, 0, message)
    this.retryTimer = setTimeout(() => { void this.connect() }, this.reconnectDelay)
    this.retryTimer.unref()
    this.reconnectDelay = Math.min(30000, this.reconnectDelay * 2)
  }
  private send(type: number, id: number, payload: Buffer = Buffer.alloc(0)): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN || payload.length > MAX_FRAME || ws.bufferedAmount > MAX_WS_BUFFER) return false
    const frame = Buffer.allocUnsafe(5 + payload.length)
    frame.writeUInt8(type, 0); frame.writeUInt32BE(id, 1); payload.copy(frame, 5)
    ws.send(frame)
    return true
  }
  private closeSocket(id: number, notify = true): void {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    const socket = this.sockets.get(id)
    if (!socket) return
    this.sockets.delete(id)
    socket.destroy()
    if (notify) this.send(FRAME.CLOSE, id)
  }
  private acceptFrame(message: Buffer): void {
    if (message.length < 5 || message.length > 5 + MAX_FRAME) { this.ws?.close(); return }
    const type = message.readUInt8(0)
    const id = message.readUInt32BE(1)
    const payload = message.subarray(5)
    if (type === FRAME.OPEN) {
      if (this.sockets.has(id) || this.sockets.size >= 48) { this.send(FRAME.CLOSE, id); return }
      const socket = net.createConnection({ host: '127.0.0.1', port: this.config.port })
      this.sockets.set(id, socket)
      const timeout = setTimeout(() => this.closeSocket(id), 6500)
      this.timers.set(id, timeout)
      socket.once('connect', () => {
        clearTimeout(timeout); this.timers.delete(id)
        if (!this.send(FRAME.ACK, id)) { this.closeSocket(id); return }
        if (payload.length) socket.write(payload)
      })
      socket.on('data', (bytes: Buffer) => {
        for (let i = 0; i < bytes.length; i += MAX_FRAME) {
          if (!this.send(FRAME.DATA, id, bytes.subarray(i, i + MAX_FRAME))) { this.closeSocket(id); return }
        }
        if (this.ws && this.ws.bufferedAmount > MAX_WS_BUFFER / 2) {
          socket.pause()
          const resume = () => {
            if (!this.sockets.has(id)) return
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.closeSocket(id); return }
            if (this.ws.bufferedAmount <= MAX_WS_BUFFER / 4) socket.resume()
            else setTimeout(resume, 20).unref()
          }
          setTimeout(resume, 20).unref()
        }
      })
      socket.once('error', () => this.closeSocket(id))
      socket.once('close', () => this.closeSocket(id))
    } else if (type === FRAME.DATA) {
      const socket = this.sockets.get(id)
      if (!socket || socket.destroyed || socket.writableLength > MAX_SOCKET_BUFFER) { this.closeSocket(id); return }
      if (payload.length) socket.write(payload)
    } else if (type === FRAME.CLOSE) this.closeSocket(id, false)
    else this.ws?.close()
  }
}
