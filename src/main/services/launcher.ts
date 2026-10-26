import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import semver from 'semver'
import { Launcher, type Account } from 'eml-lib'
import type { LaunchProgress, LauncherInstance } from '../types'
import { getValidAccount } from './account'
import {
  MINIMUM_PROTECTED_CLIENT_LOADER,
  PROTECTED_CLIENT_VERSION,
  PROTECTED_MINECRAFT_VERSION,
  prepareClientPayload,
  validatePreparedClientPayloadSync,
  type PreparedClientPayload
} from './clientPayload'
import { getInstance, updateInstance } from './instances'
import { instanceDirectory, modsDirectory } from './paths'
import { store } from './store'
import { getLoaderVersions } from './versions'
import { ensureRequiredMod } from './modrinth'
import { showLauncherActivity, showLaunchingActivity, showPlayingActivity } from './discordActivity'
import { setGameplayUpdatePause } from './updater'
import { setServerStatusPaused } from './servers'
import {
  findGameJavaProcesses,
  runPreflightSecurity,
  scanGameJvmArguments,
  scanLoadedModules,
  scanRunningTools,
  secureChildEnvironment,
  terminateProcesses
} from './security'

const MINIMUM_CLIENT_LOADER = MINIMUM_PROTECTED_CLIENT_LOADER
export const CLIENT_VERSION = PROTECTED_CLIENT_VERSION
const CLIENT_MINECRAFT_VERSION = PROTECTED_MINECRAFT_VERSION
const ESCAPED_CLIENT_VERSION = CLIENT_VERSION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const CLIENT_VERSION_PATTERN = new RegExp(`(?:^|[\\s\\-:])megaclient(?:[\\s\\-:@]|$)[^\\r\\n]{0,80}\\b${ESCAPED_CLIENT_VERSION}\\b`, 'im')
const CLIENT_MOD_PATTERN = new RegExp(`mod\\s+megaclient\\s+${ESCAPED_CLIENT_VERSION}`, 'im')

let activeLauncher: Launcher | null = null
let consoleWindow: BrowserWindow | null = null
let gameTray: Tray | null = null
let securityTimer: NodeJS.Timeout | null = null
let clientVerificationTimer: NodeJS.Timeout | null = null
let securityCheckRunning = false
let consoleLines: Array<{ line: string; kind: 'info' | 'error' | 'game' | 'muted' | 'success' }> = []
let consolePending: Array<{ line: string; kind: 'info' | 'error' | 'game' | 'muted' | 'success' }> = []
let consoleFlushTimer: NodeJS.Timeout | null = null
let gamePerformanceActive = false
let securityMonitorGeneration = 0
let clientVerificationGeneration = 0

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
}

function emit(mainWindow: BrowserWindow, event: string, payload: unknown): void {
  if (!mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload)
}

function showMainWindow(mainWindow: BrowserWindow): void {
  if (mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createGameTray(mainWindow: BrowserWindow): void {
  if (gameTray) return
  const icon = nativeImage.createFromPath(appIconPath()).resize({ width: 32, height: 32, quality: 'best' })
  gameTray = new Tray(icon)
  gameTray.setToolTip('MegaClient · Minecraft is running')
  gameTray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open MegaClient', click: () => showMainWindow(mainWindow) },
    { label: 'Open launch console', click: () => showConsole() },
    { type: 'separator' },
    { label: 'Quit launcher', click: () => app.quit() }
  ]))
  gameTray.on('click', () => showMainWindow(mainWindow))
  gameTray.on('double-click', () => showMainWindow(mainWindow))
}

function destroyGameTray(): void {
  gameTray?.destroy()
  gameTray = null
}

function consoleHtml(iconDataUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MegaClient Console</title><style>
  :root{color-scheme:dark}*{box-sizing:border-box}html,body{width:100%;height:100%}body{margin:0;background:#090a0f;color:#d8dbe4;font:12px/1.58 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;border:1px solid #272b36;border-radius:12px}.bar{-webkit-app-region:drag;height:50px;display:flex;align-items:center;padding:0 6px 0 14px;border-bottom:1px solid #232631;background:linear-gradient(180deg,#141620,#0f1118)}.brand{display:flex;align-items:center;gap:9px}.brand img{width:26px;height:26px;object-fit:contain}.title{font:650 12px Inter,Segoe UI,sans-serif;color:#f5f6f8}.subtitle{display:block;color:#747b8b;font:9px Inter,Segoe UI,sans-serif;margin-top:1px}.state{margin-left:auto;color:#9ca3b2;font:10px Inter,Segoe UI,sans-serif;padding-right:10px}.controls{-webkit-app-region:no-drag;display:flex;align-self:stretch}.controls button{width:42px;border:0;background:transparent;color:#aeb4c1;cursor:pointer;font:15px Segoe UI,sans-serif}.controls button:hover{background:#20232d;color:#fff}.controls button.close:hover{background:#d83b52}#log{height:calc(100vh - 51px);padding:14px 16px 18px;overflow:auto;white-space:pre-wrap;word-break:break-word;scrollbar-width:thin;scrollbar-color:#343947 transparent}.line{padding:1px 0}.info{color:#cfd3dc}.error{color:#ff6c83}.success{color:#73d99a}.game{color:#b8c2ff}.muted{color:#737b8d}</style></head><body><div class="bar"><div class="brand"><img src="${iconDataUrl}"/><span><span class="title">MegaClient Console</span><span class="subtitle">Minecraft launch and game output</span></span></div><span id="state" class="state">Preparing</span><div class="controls"><button aria-label="Minimise" onclick="window.mega.consoleWindow.minimize()">−</button><button aria-label="Maximise" onclick="window.mega.consoleWindow.maximize()">□</button><button class="close" aria-label="Close" onclick="window.mega.consoleWindow.close()">×</button></div></div><div id="log"></div></body></html>`
}

function flushConsole(): void {
  consoleFlushTimer = null
  if (!consoleWindow || consoleWindow.isDestroyed() || !consoleWindow.isVisible() || consoleWindow.isMinimized()) {
    consolePending = []
    return
  }
  if (!consolePending.length) return
  const batch = consolePending.splice(0, consolePending.length)
  const script = `(() => { const log=document.getElementById('log'); const rows=${JSON.stringify(batch)}; const frag=document.createDocumentFragment(); for(const entry of rows){const row=document.createElement('div');row.className='line '+entry.kind;row.textContent=entry.line;frag.appendChild(row)} log.appendChild(frag); while(log.childElementCount>900)log.firstElementChild?.remove(); log.scrollTop=log.scrollHeight; })()`
  void consoleWindow.webContents.executeJavaScript(script).catch(() => undefined)
}

function queueConsole(entries: typeof consolePending): void {
  // Fabric can emit thousands of log lines. Keep history bounded and avoid DOM
  // work while the console is hidden or minimised so it cannot compete with the
  // game for CPU/GPU time.
  if (!consoleWindow || consoleWindow.isDestroyed() || !consoleWindow.isVisible() || consoleWindow.isMinimized()) return
  consolePending.push(...entries)
  if (consolePending.length > 400) consolePending = consolePending.slice(-300)
  if (!consoleFlushTimer) consoleFlushTimer = setTimeout(flushConsole, gamePerformanceActive ? 500 : 140)
}

function replayConsole(): void {
  if (!consoleWindow || consoleWindow.isDestroyed()) return
  consolePending = []
  void consoleWindow.webContents.executeJavaScript("document.getElementById('log')?.replaceChildren()").then(() => {
    queueConsole(consoleLines.slice(-900))
  }).catch(() => undefined)
}

function showConsole(): BrowserWindow {
  if (consoleWindow && !consoleWindow.isDestroyed()) {
    consoleWindow.show()
    consoleWindow.focus()
    return consoleWindow
  }
  const iconImage = nativeImage.createFromPath(appIconPath())
  consoleWindow = new BrowserWindow({
    width: 940,
    height: 580,
    minWidth: 680,
    minHeight: 400,
    show: false,
    frame: false,
    transparent: false,
    roundedCorners: true,
    title: 'MegaClient Console',
    backgroundColor: '#090a0f',
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  void consoleWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(consoleHtml(iconImage.toDataURL()))}`)
  consoleWindow.once('ready-to-show', () => consoleWindow?.show())
  consoleWindow.on('show', replayConsole)
  consoleWindow.on('restore', replayConsole)
  consoleWindow.on('closed', () => {
    consoleWindow = null
    consolePending = []
    if (consoleFlushTimer) clearTimeout(consoleFlushTimer)
    consoleFlushTimer = null
  })
  return consoleWindow
}

function appendConsole(line: string, kind: 'info' | 'error' | 'game' | 'muted' | 'success' = 'info'): void {
  const entry = { line, kind }
  consoleLines.push(entry)
  if (consoleLines.length > 1400) consoleLines = consoleLines.slice(-1000)
  queueConsole([entry])
}

function setConsoleState(state: string): void {
  if (!consoleWindow || consoleWindow.isDestroyed()) return
  void consoleWindow.webContents.executeJavaScript(`document.getElementById('state').textContent=${JSON.stringify(state)}`).catch(() => undefined)
}

async function resolveLoader(instance: LauncherInstance): Promise<LauncherInstance> {
  if (instance.loader === 'vanilla') return instance

  // A configured loader is already enough for normal instances. Re-querying
  // Fabric/Forge/NeoForge before every launch adds avoidable network latency and
  // makes offline starts less reliable.
  if (!instance.customClient && instance.loaderVersion) return instance

  if (instance.customClient) {
    const parsed = instance.loaderVersion
      ? semver.valid(instance.loaderVersion) ?? semver.coerce(instance.loaderVersion)?.version
      : null
    if (instance.loader === 'fabric' && parsed && semver.gte(parsed, MINIMUM_CLIENT_LOADER)) return instance

    const versions = await getLoaderVersions('fabric', CLIENT_MINECRAFT_VERSION)
    const compatible = versions.find((version) => {
      const value = semver.valid(version) ?? semver.coerce(version)?.version
      return value ? semver.gte(value, MINIMUM_CLIENT_LOADER) : false
    })
    if (!compatible) {
      throw new Error(`MegaClient ${CLIENT_VERSION} requires Fabric Loader ${MINIMUM_CLIENT_LOADER} or newer for Minecraft ${CLIENT_MINECRAFT_VERSION}.`)
    }
    return updateInstance(instance.id, {
      loader: 'fabric',
      loaderVersion: compatible,
      minecraftVersion: CLIENT_MINECRAFT_VERSION
    })
  }

  const versions = await getLoaderVersions(instance.loader, instance.minecraftVersion)
  if (!versions.length) throw new Error(`${instance.loader} does not support Minecraft ${instance.minecraftVersion}.`)
  return updateInstance(instance.id, { loaderVersion: versions[0] })
}

async function prepareCustomClient(instance: LauncherInstance, mainWindow: BrowserWindow): Promise<PreparedClientPayload | null> {
  if (!instance.customClient) return null

  const mods = modsDirectory(instance.slug)
  await fs.mkdir(mods, { recursive: true })
  const modNames = await fs.readdir(mods).catch(() => [] as string[])
  await Promise.all(modNames
    .filter((name) => /^megaclient(?:[-_.].*)?\.jar(?:\.disabled)?$/i.test(name))
    .map((name) => fs.rm(path.join(mods, name), { force: true }).catch(() => undefined)))

  // Resolve required Modrinth dependencies before staging the private runtime.
  // This keeps the decrypted client on disk for the shortest possible time.
  emit(mainWindow, 'launch:progress', { phase: 'client', message: 'Installing required client files' } satisfies LaunchProgress)
  appendConsole('[MegaClient] Resolving required Fabric dependencies', 'muted')
  try {
    const fabricApi = await ensureRequiredMod(instance.id, 'P7dR8mSH', (message, progress) => {
      emit(mainWindow, 'launch:progress', { phase: 'client', message, progress } satisfies LaunchProgress)
    }, 24 * 60 * 60_000, '0.152.2')
    appendConsole(`[MegaClient] Fabric API ${fabricApi.versionNumber ?? 'compatible build'} is ready`, 'success')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendConsole(`[MegaClient] Dependency setup failed: ${message}`, 'error')
    throw new Error(`MegaClient could not install its required Fabric API dependency. ${message}`)
  }

  emit(mainWindow, 'launch:progress', { phase: 'client', message: 'Preparing MegaClient' } satisfies LaunchProgress)
  appendConsole('[MegaClient] Decrypting and verifying the protected runtime', 'muted')
  const payload = await prepareClientPayload(instance.slug)
  try {
    validatePreparedClientPayloadSync(payload)
    appendConsole(`[MegaClient] Protected runtime prepared for Fabric Loader ${instance.loaderVersion}`, 'success')
    return payload
  } catch (error) {
    await payload.cleanup()
    throw error
  }
}

function stopSecurityMonitor(): void {
  securityMonitorGeneration++
  if (securityTimer) clearTimeout(securityTimer)
  securityTimer = null
  securityCheckRunning = false
}

function stopClientVerification(): void {
  clientVerificationGeneration++
  if (clientVerificationTimer) clearTimeout(clientVerificationTimer)
  clientVerificationTimer = null
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function setElectronPriority(active: boolean): void {
  const priority = active
    ? os.constants.priority.PRIORITY_BELOW_NORMAL
    : os.constants.priority.PRIORITY_NORMAL
  for (const metric of app.getAppMetrics()) {
    try { os.setPriority(metric.pid, priority) } catch { /* unsupported/protected process */ }
  }
}

export function isGamePerformanceModeActive(): boolean { return gamePerformanceActive }

function setGamePerformanceMode(mainWindow: BrowserWindow, active: boolean): void {
  if (gamePerformanceActive === active) return
  gamePerformanceActive = active
  setGameplayUpdatePause(active)
  setServerStatusPaused(active)
  setElectronPriority(active)

  // Background throttling remains enabled so hidden launcher windows do not
  // continuously render while Minecraft owns the foreground/GPU.
  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.setBackgroundThrottling(true)
    mainWindow.webContents.send('launcher:performance-mode', active)
  }
  if (consoleWindow && !consoleWindow.isDestroyed()) consoleWindow.webContents.setBackgroundThrottling(true)

  appendConsole(
    active
      ? '[Performance] Game mode active: launcher priority lowered and background network activity paused.'
      : '[Performance] Game mode ended: normal launcher activity restored.',
    'muted'
  )
}

function startSecurityMonitor(mainWindow: BrowserWindow, instance: LauncherInstance): void {
  stopSecurityMonitor()
  const generation = securityMonitorGeneration
  let gameProcesses: Awaited<ReturnType<typeof findGameJavaProcesses>> = []
  let jvmArgumentsChecked = false
  let nextToolScanAt = 0
  let nextModuleScanAt = Date.now() + 45_000
  let stopped = false

  const schedule = (delay: number): void => {
    if (stopped || generation !== securityMonitorGeneration) return
    securityTimer = setTimeout(() => void run(), delay)
    securityTimer.unref()
  }

  const run = async (): Promise<void> => {
    if (stopped || generation !== securityMonitorGeneration) return
    if (securityCheckRunning) {
      schedule(30_000)
      return
    }
    securityCheckRunning = true
    let foundViolation = false
    try {
      gameProcesses = gameProcesses.filter((item) => Boolean(item.ProcessId && processIsAlive(item.ProcessId)))
      if (!gameProcesses.length) gameProcesses = await findGameJavaProcesses(instance)

      const processIds = gameProcesses.map((item) => item.ProcessId ?? 0).filter((id) => id > 0)
      const jvmFindings = !jvmArgumentsChecked && gameProcesses.length
        ? scanGameJvmArguments(gameProcesses)
        : []
      if (gameProcesses.length) jvmArgumentsChecked = true

      // Exact process identities are checked infrequently with lightweight
      // Get-Process. Loaded module inspection is deliberately rare because
      // enumerating every native module can produce noticeable Windows spikes.
      const now = Date.now()
      let toolFindings: Awaited<ReturnType<typeof scanRunningTools>> = []
      if (now >= nextToolScanAt) {
        nextToolScanAt = now + 5 * 60_000
        toolFindings = await scanRunningTools('runtime')
      }
      let moduleFindings: Awaited<ReturnType<typeof scanLoadedModules>> = []
      if (processIds.length && now >= nextModuleScanAt) {
        nextModuleScanAt = now + 15 * 60_000
        moduleFindings = await scanLoadedModules(processIds)
      }

      const finding = [...jvmFindings, ...toolFindings, ...moduleFindings][0]
      if (finding) {
        foundViolation = true
        stopped = true
        const message = `${finding.title}: ${finding.detail}`
        appendConsole(`[Security] ${message}`, 'error')
        setConsoleState('Launch protection stopped the game')
        emit(mainWindow, 'launch:error', { message })
        await terminateProcesses(processIds)
        stopSecurityMonitor()
      }
    } catch (error) {
      appendConsole(`[Security] Monitor warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')
    } finally {
      securityCheckRunning = false
    }
    if (!foundViolation && !stopped && generation === securityMonitorGeneration) schedule(120_000)
  }

  schedule(10_000)
}

function clientLoadedInText(text: string): boolean {
  return /\[MegaClient verifier\] Protected client origin and SHA-256 verified/i.test(text)
    || CLIENT_VERSION_PATTERN.test(text)
    || /loaded\s+mod[^\r\n]*\bmegaclient\b/im.test(text)
    || CLIENT_MOD_PATTERN.test(text)
}

function clientFailureFromLog(text: string): string | null {
  // Do not reinterpret another legitimate mod's own compatibility error as a
  // protected-client failure. Only lines that explicitly identify MegaClient or
  // its verifier can fail the protected-client check.
  const lines = text.split(/\r?\n/).filter((line) => /megaclient(?:-launch-verifier)?/i.test(line))
  const failure = lines.find((line) => /error|failed|incompatible|requires|could not find|required mod|resolution failed/i.test(line))
  return failure?.trim().slice(0, 600) ?? null
}

interface ClientVerificationMarker {
  mod?: string
  version?: string
  nonce?: string
  sha256?: string
  originVerified?: boolean
  verified?: boolean
}

async function readTextTail(file: string, maximumBytes = 256 * 1024): Promise<string> {
  const stat = await fs.stat(file)
  const length = Math.min(stat.size, maximumBytes)
  if (length <= 0) return ''
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(length)
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, stat.size - length))
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readClientMarker(payload: PreparedClientPayload): Promise<boolean> {
  try {
    const marker = JSON.parse(await fs.readFile(payload.markerPath, 'utf8')) as ClientVerificationMarker
    return marker.mod === 'megaclient'
      && marker.version === CLIENT_VERSION
      && marker.nonce === payload.markerNonce
      && marker.sha256 === payload.sha256
      && marker.originVerified === true
      && marker.verified === true
  } catch {
    return false
  }
}

function startClientVerification(
  mainWindow: BrowserWindow,
  instance: LauncherInstance,
  payload: PreparedClientPayload,
  verificationStartedAt: number,
  hasSeenClient: () => boolean,
  markClientSeen: () => void
): void {
  stopClientVerification()
  const generation = clientVerificationGeneration
  const deadline = verificationStartedAt + 240_000
  const logFallbackAt = verificationStartedAt + 15_000
  const latestLog = path.join(instanceDirectory(instance.slug), 'logs', 'latest.log')
  let nextLogReadAt = verificationStartedAt + 8_000
  let lastLogStamp = ''

  const finishSuccess = (source: 'marker' | 'log'): void => {
    stopClientVerification()
    markClientSeen()
    appendConsole(
      source === 'marker'
        ? `[MegaClient] MegaClient ${CLIENT_VERSION} was verified inside the running Fabric client`
        : `[MegaClient] MegaClient ${CLIENT_VERSION} was confirmed in Fabric's active mod output`,
      'success'
    )
    emit(mainWindow, 'launch:progress', { phase: 'client', message: `MegaClient ${CLIENT_VERSION} loaded`, progress: 1 } satisfies LaunchProgress)
  }

  const failClosed = async (detail: string): Promise<void> => {
    stopClientVerification()
    const message = `MegaClient ${CLIENT_VERSION} did not load correctly. ${detail}`
    appendConsole(`[MegaClient] ${message}`, 'error')
    setConsoleState('MegaClient failed to load')
    emit(mainWindow, 'launch:error', { message })
    const processes = await findGameJavaProcesses(instance)
    await terminateProcesses(processes.map((item) => item.ProcessId ?? 0))
  }

  const poll = async (): Promise<void> => {
    if (generation !== clientVerificationGeneration) return
    if (await readClientMarker(payload)) {
      finishSuccess('marker')
      return
    }

    // Fabric logs can be very busy with large modpacks. Read only a small tail
    // and only when the file actually changed, rather than reading 256 KB every
    // 1.5 seconds for the entire protected-client verification window.
    if (Date.now() >= nextLogReadAt) {
      nextLogReadAt = Date.now() + 8_000
      const stat = await fs.stat(latestLog).catch(() => null)
      if (stat && stat.mtimeMs >= verificationStartedAt - 2_000) {
        const stamp = `${stat.size}:${Math.trunc(stat.mtimeMs)}`
        if (stamp !== lastLogStamp) {
          lastLogStamp = stamp
          const log = await readTextTail(latestLog, 64 * 1024).catch(() => '')
          if (clientLoadedInText(log)) markClientSeen()
          const failure = clientFailureFromLog(log)
          if (failure) {
            await failClosed(`Fabric reported: ${failure}`)
            return
          }
        }
      }
    }

    if (hasSeenClient() && Date.now() >= logFallbackAt) {
      finishSuccess('log')
      return
    }

    if (Date.now() >= deadline) {
      await failClosed("Neither the runtime verifier nor Fabric's active mod list confirmed the protected client. The game was stopped instead of silently starting plain Fabric.")
      return
    }

    clientVerificationTimer = setTimeout(() => void poll().catch((error) => {
      if (generation !== clientVerificationGeneration) return
      appendConsole(`[MegaClient] Verification warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')
      clientVerificationTimer = setTimeout(() => void poll(), 2_000)
    }), 2_000)
  }

  clientVerificationTimer = setTimeout(() => void poll(), 2_000)
}

function serverGameArgs(address?: string): string[] {
  const value = address?.trim()
  if (!value) return []
  const match = value.match(/^(.+?)(?::(\d{1,5}))?$/)
  if (!match) throw new Error('The partner server address is invalid.')
  const host = match[1]!
  const port = match[2] ? Number(match[2]) : undefined
  if (port != null && (port < 1 || port > 65535)) throw new Error('The partner server port is invalid.')
  return ['--server', host, ...(port ? ['--port', String(port)] : [])]
}

export async function launchInstance(mainWindow: BrowserWindow, instanceId: string, serverAddress?: string): Promise<void> {
  if (activeLauncher) throw new Error('Minecraft is already being launched by MegaClient.')
  const settings = store.getData().settings
  consoleLines = []
  consolePending = []
  if (settings.showConsole) showConsole()
  appendConsole(`[MegaClient] Starting ${new Date().toLocaleString()}`, 'muted')
  if (serverAddress) appendConsole(`[MegaClient] Direct connection: ${serverAddress}`, 'muted')
  setConsoleState('Preparing')

  let instance = getInstance(instanceId)
  if (instance.customClient && (instance.minecraftVersion !== CLIENT_MINECRAFT_VERSION || instance.loader !== 'fabric')) {
    instance = await updateInstance(instance.id, { minecraftVersion: CLIENT_MINECRAFT_VERSION, loader: 'fabric' })
  }
  instance = await resolveLoader(instance)
  showLaunchingActivity(instance, serverAddress)

  emit(mainWindow, 'launch:progress', { phase: 'security', message: 'Running enforced launch protection' } satisfies LaunchProgress)
  appendConsole('[Security] Checking high-confidence blocked identities without restricting legitimate native mods', 'muted')
  await runPreflightSecurity(instance)

  const account: Account = await getValidAccount(mainWindow)
  const clientPayload = await prepareCustomClient(instance, mainWindow)
  const javaArgs = [
    '-Dmegaclient.launcher=true',
    '-Dfabric.debug.disableModShuffle=true'
  ]
  if (clientPayload) {
    javaArgs.push(`-Dmegaclient.payload.sha256=${clientPayload.sha256}`)
    javaArgs.push(`-Dmegaclient.payload.path=${clientPayload.jarPath.replaceAll('\\', '/')}`)
    javaArgs.push(`-Dmegaclient.marker=${clientPayload.markerPath}`)
    javaArgs.push(`-Dmegaclient.marker.nonce=${clientPayload.markerNonce}`)
    appendConsole(`[MegaClient] Staged the protected client in this isolated instance (${clientPayload.sha256.slice(0, 12)}…)`, 'success')
  }

  if (instance.customClient) {
    await fs.rm(path.join(instanceDirectory(instance.slug), 'logs', 'latest.log'), { force: true }).catch(() => undefined)
  }

  const launcher = new Launcher({
    root: 'megaclient',
    storage: 'isolated',
    profile: {
      slug: instance.slug,
      minecraft: {
        version: instance.minecraftVersion,
        loader: instance.loader === 'vanilla'
          ? { loader: 'vanilla' }
          : { loader: instance.loader, version: instance.loaderVersion },
        args: serverGameArgs(serverAddress)
      }
    },
    cleaning: { enabled: false },
    account,
    memory: { min: settings.memoryMin, max: settings.memoryMax },
    window: { width: settings.width, height: settings.height, fullscreen: settings.fullscreen },
    java: settings.javaMode === 'manual'
      ? { install: 'manual', absolutePath: settings.javaPath, args: javaArgs }
      : { install: 'auto', args: javaArgs }
  })
  activeLauncher = launcher
  // Pause launcher-owned network/background work before Minecraft begins its
  // own downloads and connections, preventing an update scan from starting
  // during a long Fabric preparation phase.
  setGamePerformanceMode(mainWindow, true)

  let payloadCleaned = false
  let gameSpawned = false
  let sessionFinalized = false
  let clientObserved = false
  let gameStartedAt = Date.now()
  const cleanupPayload = async (): Promise<void> => {
    if (payloadCleaned) return
    payloadCleaned = true
    await clientPayload?.cleanup()
  }

  let lastProgressSent = 0
  const progress = (phase: string, message: string, value?: number): void => {
    const payload: LaunchProgress = { phase, message, progress: value }
    emit(mainWindow, 'launch:progress', payload)
    appendConsole(`[MegaClient] ${message}`, 'info')
    setConsoleState(message)
  }

  launcher.on('launch_compute_download', () => progress('prepare', 'Checking game files'))
  launcher.on('launch_download', ({ total }) => progress('download', `Preparing ${total.amount} downloads`))
  launcher.on('download_progress', ({ downloaded, total, speed }) => {
    const now = Date.now()
    if (now - lastProgressSent < 120 && downloaded.size < total.size) return
    lastProgressSent = now
    const value = total.size ? downloaded.size / total.size : undefined
    emit(mainWindow, 'launch:progress', {
      phase: 'download', message: 'Downloading game files', progress: value,
      downloaded: downloaded.size, total: total.size, speed
    } satisfies LaunchProgress)
    setConsoleState('Downloading')
  })
  launcher.on('download_error', ({ filename, message }) => appendConsole(`[Download] ${filename}: ${String(message)}`, 'error'))
  launcher.on('launch_install_loader', ({ type, minecraftVersion, loaderVersion }) => progress('loader', `Installing ${type === 'VANILLA' ? 'Minecraft' : `${type} ${loaderVersion}`} for ${minecraftVersion}`))
  launcher.on('launch_check_java', () => progress('java', 'Checking the required Java runtime'))
  launcher.on('java_info', ({ version, arch }) => appendConsole(`[Java] ${version} (${arch})`, 'muted'))
  launcher.on('launch_copy_assets', () => progress('assets', 'Preparing Minecraft assets'))
  launcher.on('launch_extract_natives', () => progress('natives', 'Extracting native libraries'))
  launcher.on('launch_patch_loader', () => progress('loader', 'Finalising the mod loader'))
  launcher.on('launch_launch', () => {
    gameSpawned = true
    if (clientPayload) {
      // Validated before spawn; do not synchronously re-read megabytes of JARs
      // inside EML's process-spawn event.
      appendConsole('[MegaClient] Fabric can read the verified runtime JARs', 'success')
    }
    gameStartedAt = Date.now()
    setGamePerformanceMode(mainWindow, true)
    progress('launch', serverAddress ? 'Joining partner server' : 'Minecraft is running', 1)
    setConsoleState('Minecraft running')
    showPlayingActivity(instance, serverAddress, gameStartedAt)
    startSecurityMonitor(mainWindow, instance)
    if (instance.customClient && clientPayload) {
      startClientVerification(mainWindow, instance, clientPayload, Date.now(), () => clientObserved, () => { clientObserved = true })
    }
    if (settings.minimizeToTrayOnLaunch) {
      createGameTray(mainWindow)
      mainWindow.hide()
    }
  })
  launcher.on('launch_data', (line) => {
    const cleaned = line.replace(/\r?\n$/, '')
    if (!cleaned) return
    if (!clientObserved && clientLoadedInText(cleaned)) clientObserved = true
    appendConsole(cleaned, 'game')
  })
  launcher.on('launch_debug', (line) => {
    const isFinalCommand = line.startsWith('Launching Minecraft with args:')
    if (isFinalCommand && instance.customClient && clientPayload) {
      const normalisedLine = line.replaceAll('\\', '/')
      const expectedClientPath = clientPayload.jarPath.replaceAll('\\', '/')
      const hasMarker = normalisedLine.includes('-Dmegaclient.marker=')
        && normalisedLine.includes('-Dmegaclient.marker.nonce=')
        && normalisedLine.includes('-Dmegaclient.payload.path=')
        && normalisedLine.includes(expectedClientPath)
      if (!hasMarker) {
        throw new Error('The final Java command did not contain the protected MegaClient verification arguments.')
      }
      appendConsole('[MegaClient] Confirmed protected runtime verification arguments in the final Java command', 'success')
      appendConsole('[Launcher] Final Java command prepared (protected paths hidden)', 'muted')
      return
    }
    appendConsole(line, 'muted')
  })
  launcher.on('launch_crash', (data) => {
    appendConsole(`[Crash] ${JSON.stringify(data)}`, 'error')
    emit(mainWindow, 'launch:crash', data)
  })
  // EML's launch() starts a separate Java process. Its Promise can settle while
  // Minecraft is still booting, so never delete the protected Fabric JARs or
  // re-enable background updater traffic from launch()'s finally block.
  const finishGameSession = async (code?: number): Promise<void> => {
    if (sessionFinalized) return
    sessionFinalized = true
    stopSecurityMonitor()
    stopClientVerification()
    setGamePerformanceMode(mainWindow, false)
    destroyGameTray()
    showMainWindow(mainWindow)
    showLauncherActivity(instance)
    if (code !== undefined) {
      setConsoleState(code === 0 ? 'Finished' : `Exited (${code})`)
      emit(mainWindow, 'launch:closed', { code })
    }
    // Windows can hold an open handle to a just-terminated Java process.
    // cleanupPayload() already retries locked files and remains idempotent.
    try { await cleanupPayload() } catch (error) {
      appendConsole(`[MegaClient] Could not remove a temporary runtime file: ${String(error)}`, 'muted')
    } finally {
      if (activeLauncher === launcher) activeLauncher = null
    }
  }

  launcher.on('launch_close', (code) => {
    void finishGameSession(code ?? undefined)
  })

  const restoreEnvironment = secureChildEnvironment()
  try {
    await launcher.launch()
    await updateInstance(instance.id, { lastPlayedAt: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendConsole(`[Error] ${message}`, 'error')
    setConsoleState('Launch failed')
    emit(mainWindow, 'launch:error', { message })
    await finishGameSession()
    throw error
  } finally {
    restoreEnvironment()
    // No Minecraft process was ever spawned, so there will be no close event.
    // Otherwise launch_close is the only owner of protected runtime cleanup.
    if (!gameSpawned) await finishGameSession()
  }
}

export function openLaunchConsole(): void {
  showConsole()
}
