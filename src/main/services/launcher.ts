import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
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
import { installMod, setModEnabled } from './modrinth'
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
  if (!consolePending.length || !consoleWindow || consoleWindow.isDestroyed()) return
  const batch = consolePending.splice(0, consolePending.length)
  const script = `(() => { const log=document.getElementById('log'); const rows=${JSON.stringify(batch)}; const frag=document.createDocumentFragment(); for(const entry of rows){const row=document.createElement('div');row.className='line '+entry.kind;row.textContent=entry.line;frag.appendChild(row)} log.appendChild(frag); log.scrollTop=log.scrollHeight; })()`
  void consoleWindow.webContents.executeJavaScript(script).catch(() => undefined)
}

function queueConsole(entries: typeof consolePending): void {
  consolePending.push(...entries)
  if (!consoleFlushTimer) consoleFlushTimer = setTimeout(flushConsole, 45)
}

function replayConsole(): void {
  queueConsole(consoleLines)
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
  consoleWindow.once('ready-to-show', () => {
    consoleWindow?.show()
    replayConsole()
  })
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
  if (consoleLines.length > 3000) consoleLines = consoleLines.slice(-2400)
  queueConsole([entry])
}

function setConsoleState(state: string): void {
  if (!consoleWindow || consoleWindow.isDestroyed()) return
  void consoleWindow.webContents.executeJavaScript(`document.getElementById('state').textContent=${JSON.stringify(state)}`).catch(() => undefined)
}

async function resolveLoader(instance: LauncherInstance): Promise<LauncherInstance> {
  if (instance.loader === 'vanilla') return instance
  const versions = await getLoaderVersions(instance.loader, instance.minecraftVersion)
  if (!versions.length) throw new Error(`${instance.loader} does not support Minecraft ${instance.minecraftVersion}.`)

  if (instance.customClient) {
    const compatible = versions.find((version) => {
      const parsed = semver.valid(version) ?? semver.coerce(version)?.version
      return parsed ? semver.gte(parsed, MINIMUM_CLIENT_LOADER) : false
    })
    if (!compatible) {
      throw new Error(`MegaClient ${CLIENT_VERSION} requires Fabric Loader ${MINIMUM_CLIENT_LOADER} or newer for Minecraft ${CLIENT_MINECRAFT_VERSION}.`)
    }
    if (instance.loaderVersion !== compatible || instance.loader !== 'fabric') {
      return updateInstance(instance.id, { loader: 'fabric', loaderVersion: compatible, minecraftVersion: CLIENT_MINECRAFT_VERSION })
    }
    return instance
  }

  if (instance.loaderVersion && versions.includes(instance.loaderVersion)) return instance
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
    const fabricApi = await installMod(instance.id, 'P7dR8mSH', (message, progress) => {
      emit(mainWindow, 'launch:progress', { phase: 'client', message, progress } satisfies LaunchProgress)
    })
    if (!fabricApi.enabled) {
      await setModEnabled(instance.id, fabricApi.fileName, true)
    }
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
  if (securityTimer) clearInterval(securityTimer)
  securityTimer = null
  securityCheckRunning = false
}

function stopClientVerification(): void {
  if (clientVerificationTimer) clearTimeout(clientVerificationTimer)
  clientVerificationTimer = null
}

function startSecurityMonitor(mainWindow: BrowserWindow, instance: LauncherInstance): void {
  stopSecurityMonitor()
  securityTimer = setInterval(() => {
    if (securityCheckRunning) return
    securityCheckRunning = true
    void (async () => {
      const gameProcesses = await findGameJavaProcesses(instance)
      if (!gameProcesses.length) return
      const processIds = gameProcesses.map((item) => item.ProcessId ?? 0)
      const [toolFindings, moduleFindings] = await Promise.all([
        scanRunningTools(),
        scanLoadedModules(processIds, instance)
      ])
      const finding = [
        ...scanGameJvmArguments(gameProcesses),
        ...toolFindings,
        ...moduleFindings
      ][0]
      if (!finding) return

      const message = `${finding.title}: ${finding.detail}`
      appendConsole(`[Security] ${message}`, 'error')
      setConsoleState('Launch protection stopped the game')
      emit(mainWindow, 'launch:error', { message })
      await terminateProcesses(processIds)
      stopSecurityMonitor()
    })().catch((error) => appendConsole(`[Security] Monitor warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')).finally(() => {
      securityCheckRunning = false
    })
  }, 8_000)
}

function clientLoadedInText(text: string): boolean {
  return /\[MegaClient verifier\] Protected client origin and SHA-256 verified/i.test(text)
    || CLIENT_VERSION_PATTERN.test(text)
    || /loaded\s+mod[^\r\n]*\bmegaclient\b/im.test(text)
    || CLIENT_MOD_PATTERN.test(text)
}

function clientFailureFromLog(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => /megaclient|fabric-api|incompatible mods|mod resolution|dependency/i.test(line))
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
  const deadline = verificationStartedAt + 120_000
  const logFallbackAt = verificationStartedAt + 12_000
  const latestLog = path.join(instanceDirectory(instance.slug), 'logs', 'latest.log')

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
    if (await readClientMarker(payload)) {
      finishSuccess('marker')
      return
    }

    const stat = await fs.stat(latestLog).catch(() => null)
    if (stat && stat.mtimeMs >= verificationStartedAt - 2_000) {
      const log = await fs.readFile(latestLog, 'utf8').catch(() => '')
      if (clientLoadedInText(log)) markClientSeen()
      const failure = clientFailureFromLog(log)
      if (failure) {
        await failClosed(`Fabric reported: ${failure}`)
        return
      }
    }

    // The bundled verifier is the primary proof. Exact Fabric mod-list output is
    // retained as a compatibility fallback in case a future Loader build changes
    // verifier reflection internals while still resolving MegaClient successfully.
    if (hasSeenClient() && Date.now() >= logFallbackAt) {
      finishSuccess('log')
      return
    }

    if (Date.now() >= deadline) {
      await failClosed('Neither the runtime verifier nor Fabric\'s active mod list confirmed the protected client. The game was stopped instead of silently starting plain Fabric.')
      return
    }

    clientVerificationTimer = setTimeout(() => void poll().catch((error) => {
      appendConsole(`[MegaClient] Verification warning: ${error instanceof Error ? error.message : String(error)}`, 'muted')
      clientVerificationTimer = setTimeout(() => void poll(), 2_000)
    }), 1_500)
  }

  clientVerificationTimer = setTimeout(() => void poll(), 1_500)
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

  emit(mainWindow, 'launch:progress', { phase: 'security', message: 'Running enforced launch protection' } satisfies LaunchProgress)
  appendConsole('[Security] Checking explicit blocked-client identities and active injection tools', 'muted')
  await runPreflightSecurity(instance)

  const account: Account = await getValidAccount(mainWindow)
  const clientPayload = await prepareCustomClient(instance, mainWindow)
  const javaArgs = [
    '-Dmegaclient.launcher=true',
    '-Dfabric.debug.disableModShuffle=true',
    '-Dfabric.debug.throwDirectly=true'
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

  let payloadCleaned = false
  let clientObserved = false
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
    if (clientPayload) {
      validatePreparedClientPayloadSync(clientPayload)
      appendConsole('[MegaClient] Fabric can read the verified runtime JARs', 'success')
    }
    progress('launch', serverAddress ? 'Joining partner server' : 'Minecraft is running', 1)
    setConsoleState('Minecraft running')
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
    if (clientLoadedInText(cleaned)) clientObserved = true
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
  launcher.on('launch_close', (code) => {
    stopSecurityMonitor()
    stopClientVerification()
    setConsoleState(code === 0 ? 'Finished' : `Exited (${code ?? 'unknown'})`)
    emit(mainWindow, 'launch:closed', { code })
    destroyGameTray()
    showMainWindow(mainWindow)
    void cleanupPayload()
  })

  const restoreEnvironment = secureChildEnvironment()
  try {
    await launcher.launch()
    await updateInstance(instance.id, { lastPlayedAt: new Date().toISOString() })
  } catch (error) {
    stopSecurityMonitor()
    stopClientVerification()
    destroyGameTray()
    showMainWindow(mainWindow)
    const message = error instanceof Error ? error.message : String(error)
    appendConsole(`[Error] ${message}`, 'error')
    setConsoleState('Launch failed')
    emit(mainWindow, 'launch:error', { message })
    throw error
  } finally {
    restoreEnvironment()
    await cleanupPayload()
    activeLauncher = null
  }
}

export function openLaunchConsole(): void {
  showConsole()
}
