import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LoaderType } from './types'
import { store } from './services/store'
import { login, logout, restore } from './services/account'
import { createInstance, deleteInstance, getInstance, openInstanceFolder, updateInstance, copyLocalMod } from './services/instances'
import { getLoaderVersions, getMinecraftVersions } from './services/versions'
import { installMod, installModpack, installPack, listMods, listPacks, removeMod, removePack, searchContent, setModEnabled, setPackEnabled, updateAllMods, updateMod } from './services/modrinth'
import { CLIENT_VERSION, launchInstance, openLaunchConsole } from './services/launcher'
import { getProfileData, switchCape, updateSkin } from './services/profile'
import { deleteWorld, downloadWorldZip, importWorldZip, listWorlds, worldFolder } from './services/worlds'
import { resourcePacksDirectory, shaderPacksDirectory } from './services/paths'
import { getPartnerServerStatus } from './services/servers'
import { checkForUpdates, configureAutomaticUpdates, installReadyUpdate, notifyWindowFocused, setupUpdater, updaterState } from './services/updater'
import { configureDiscordActivity, isDiscordActivityConfigured, showLauncherActivity, shutdownDiscordActivity } from './services/discordActivity'

const execFileAsync = promisify(execFile)

interface SplashProgress {
  value: number
  message: string
  detail?: string
  launcherVersion: string
  clientVersion: string
}

const MINIMUM_SPLASH_VISIBLE_MS = 1_850
const SPLASH_TRANSITION_MS = 520

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let splashProgress: SplashProgress = {
  value: 6,
  message: 'Starting MegaClient',
  detail: 'Preparing the secure launcher',
  launcherVersion: app.getVersion(),
  clientVersion: CLIENT_VERSION
}
let splashShownAt = 0
let splashReadyPromise: Promise<void> = Promise.resolve()
let mainWindowRevealed = false
let unresponsiveTimer: NodeJS.Timeout | null = null
let rendererRecoveryAttempts = 0


async function hideProtectedInstallationResources(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') return
  const directory = path.join(process.resourcesPath, 'resources', 'client')
  const targets = [
    directory,
    path.join(directory, 'megaclient.bundle'),
    path.join(directory, 'launch-verifier.jar')
  ]
  await Promise.all(targets.map((target) =>
    execFileAsync('attrib.exe', ['+H', target], { windowsHide: true, timeout: 5_000 }).catch(() => undefined)
  ))
}

function iconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icons', 'icon.png')
}

function rendererUrl(view: 'main' | 'splash'): string {
  const base = process.env.ELECTRON_RENDERER_URL
  if (!base) return ''
  const url = new URL(base)
  url.searchParams.set('view', view)
  return url.toString()
}

function loadRenderer(window: BrowserWindow, view: 'main' | 'splash'): void {
  const loading = process.env.ELECTRON_RENDERER_URL
    ? window.loadURL(rendererUrl(view))
    : window.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view } })

  void loading.catch((error) => {
    console.error(`[MegaClient] Failed to open the ${view} interface.`, error)
  })
}

function sendBootStatus(value: number, message: string, detail?: string): void {
  setSplashProgress(value, message, detail)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:boot-status', { value, message, detail })
  }
}

function clearUnresponsiveTimer(): void {
  if (unresponsiveTimer) clearTimeout(unresponsiveTimer)
  unresponsiveTimer = null
}

function scheduleUnresponsiveRecovery(window: BrowserWindow): void {
  if (window !== mainWindow || window.isDestroyed()) return
  clearUnresponsiveTimer()
  unresponsiveTimer = setTimeout(() => {
    if (window.isDestroyed()) return
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'MegaClient is taking longer than expected',
      message: 'The launcher interface has stopped responding.',
      detail: 'Minecraft and active downloads are kept separate. You can wait a little longer or safely reload only the launcher interface.',
      buttons: ['Reload interface', 'Keep waiting'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    }).then(({ response }) => {
      if (response === 0 && !window.isDestroyed()) window.webContents.reload()
    }).catch(() => undefined)
  }, 7_000)
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)))
}

function easeInOutCubic(value: number): number {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function setWindowOpacity(window: BrowserWindow, opacity: number): void {
  if (window.isDestroyed()) return
  try {
    window.setOpacity(Math.max(0, Math.min(1, opacity)))
  } catch {
    // Some Linux window managers do not support window opacity. The renderer
    // transition still provides a smooth handoff in that case.
  }
}

async function animateWindowHandoff(main: BrowserWindow, splash: BrowserWindow): Promise<void> {
  const startedAt = Date.now()
  while (true) {
    if (main.isDestroyed() || splash.isDestroyed()) return
    const elapsed = Date.now() - startedAt
    const progress = Math.min(1, elapsed / SPLASH_TRANSITION_MS)
    const eased = easeInOutCubic(progress)
    setWindowOpacity(main, eased)
    setWindowOpacity(splash, 1 - eased)
    if (progress >= 1) break
    await delay(16)
  }
}

function setSplashProgress(value: number, message: string, detail?: string): void {
  splashProgress = {
    value: Math.max(0, Math.min(100, value)),
    message,
    detail,
    launcherVersion: app.getVersion(),
    clientVersion: CLIENT_VERSION
  }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send('splash:progress', splashProgress)
}

function configureRendererWindow(window: BrowserWindow): void {
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[MegaClient] Preload failed: ${preloadPath}`, error)
  })
  window.webContents.on('did-fail-load', (_event, code, description, validatedUrl) => {
    console.error(`[MegaClient] Renderer failed to load (${code}): ${description} — ${validatedUrl}`)
  })
  window.on('unresponsive', () => {
    console.warn('[MegaClient] Renderer became unresponsive.')
    scheduleUnresponsiveRecovery(window)
  })
  window.on('responsive', () => {
    clearUnresponsiveTimer()
    console.info('[MegaClient] Renderer is responsive again.')
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[MegaClient] Renderer process ended unexpectedly.', details)
    if (window !== mainWindow || window.isDestroyed() || details.reason === 'clean-exit') return
    if (rendererRecoveryAttempts >= 2) {
      void dialog.showMessageBox({
        type: 'error',
        title: 'MegaClient interface closed unexpectedly',
        message: 'MegaClient could not automatically recover the launcher interface.',
        detail: 'Close the launcher and open it again. Minecraft files and instances are not removed.',
        buttons: ['Close MegaClient'],
        noLink: true
      }).finally(() => app.quit())
      return
    }
    rendererRecoveryAttempts += 1
    sendBootStatus(36, 'Recovering launcher interface')
    setTimeout(() => {
      if (!window.isDestroyed()) window.webContents.reload()
    }, 450)
  })
  if (!app.isPackaged) {
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const labels = ['verbose', 'info', 'warning', 'error']
      if (!message.includes('Download the React DevTools')) {
        console.log(`[MegaClient renderer:${labels[level] ?? level}] ${message} (${sourceId}:${line})`)
      }
    })
  }
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env.ELECTRON_RENDERER_URL ? url.startsWith(process.env.ELECTRON_RENDERER_URL) : url.startsWith('file:')
    if (!allowed) event.preventDefault()
  })
}

function createSplashWindow(): void {
  let resolveSplashReady: (() => void) | undefined
  splashReadyPromise = new Promise<void>((resolve) => { resolveSplashReady = resolve })
  splashWindow = new BrowserWindow({
    width: 460,
    height: 260,
    show: false,
    opacity: 0,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0d12',
    icon: iconPath(),
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  configureRendererWindow(splashWindow)
  splashWindow.webContents.once('did-finish-load', () => {
    const splash = splashWindow
    if (!splash || splash.isDestroyed()) return
    splash.webContents.send('splash:progress', splashProgress)
    splash.center()
    splash.show()
    splashShownAt = Date.now()
    resolveSplashReady?.()
    resolveSplashReady = undefined
    void (async () => {
      const startedAt = Date.now()
      while (!splash.isDestroyed()) {
        const progress = Math.min(1, (Date.now() - startedAt) / 260)
        setWindowOpacity(splash, 1 - Math.pow(1 - progress, 3))
        if (progress >= 1) break
        await delay(16)
      }
    })()
  })
  loadRenderer(splashWindow, 'splash')
  splashWindow.on('closed', () => {
    resolveSplashReady?.()
    resolveSplashReady = undefined
    splashWindow = null
  })
}

function createMainWindow(): void {
  const display = screen.getPrimaryDisplay()
  const width = Math.min(1280, Math.max(980, display.workArea.width - 80))
  const height = Math.min(800, Math.max(650, display.workArea.height - 80))
  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 980,
    minHeight: 650,
    show: false,
    opacity: 0,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d12',
    icon: iconPath(),
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: true
    }
  })
  configureRendererWindow(mainWindow)
  mainWindow.webContents.once('did-finish-load', () => setSplashProgress(58, 'Loading your launcher'))
  mainWindow.on('focus', () => notifyWindowFocused())
  loadRenderer(mainWindow, 'main')
  mainWindow.on('closed', () => {
    mainWindow = null
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  })
}

function createWindows(): void {
  mainWindowRevealed = false
  splashShownAt = 0
  setSplashProgress(6, 'Starting MegaClient', 'Preparing the secure launcher')
  createSplashWindow()
  setSplashProgress(22, 'Preparing launcher', 'Opening the interface and local services')
  createMainWindow()
}

async function revealMainWindow(): Promise<void> {
  const window = requireWindow()
  if (mainWindowRevealed) return
  mainWindowRevealed = true
  if (window.isMinimized()) window.restore()
  window.center()
  setSplashProgress(100, 'MegaClient is ready', 'Finishing the launcher transition')

  const splash = splashWindow
  if (!splash || splash.isDestroyed()) {
    setWindowOpacity(window, 1)
    window.show()
    window.focus()
    return
  }

  const visibleFor = splashShownAt ? Date.now() - splashShownAt : MINIMUM_SPLASH_VISIBLE_MS
  await delay(Math.max(0, MINIMUM_SPLASH_VISIBLE_MS - visibleFor))
  if (splash.isDestroyed()) {
    setWindowOpacity(window, 1)
    window.show()
    window.focus()
    return
  }

  splash.webContents.send('splash:leaving')
  setWindowOpacity(window, 0)
  window.showInactive()
  await delay(90)
  await animateWindowHandoff(window, splash)
  setWindowOpacity(window, 1)
  window.show()
  window.focus()
  if (!splash.isDestroyed()) {
    splash.setAlwaysOnTop(false)
    splash.close()
  }
}

function requireWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The MegaClient window is not available.')
  return mainWindow
}

function sendUpdate(payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:event', payload)
}

function registerIpc(): void {
  ipcMain.handle('window:minimize', () => requireWindow().minimize())
  ipcMain.handle('window:maximize', () => requireWindow().isMaximized() ? requireWindow().unmaximize() : requireWindow().maximize())
  ipcMain.handle('window:close', () => requireWindow().close())
  ipcMain.handle('console-window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
  ipcMain.handle('console-window:maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    window.isMaximized() ? window.unmaximize() : window.maximize()
  })
  ipcMain.handle('console-window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())

  ipcMain.handle('app:renderer-ready', async () => {
    sendUpdate(updaterState())
    await revealMainWindow()
  })
  ipcMain.handle('app:reload', () => requireWindow().webContents.reload())
  ipcMain.handle('app:quit', () => app.quit())
  ipcMain.handle('app:bootstrap', async () => {
    sendBootStatus(64, 'Loading launcher settings', 'Reading your instances and preferences')
    await yieldToEventLoop()
    const snapshot = store.getData()
    sendBootStatus(78, 'Restoring your Microsoft account', 'This can take a moment when Microsoft services are busy')
    const account = await restore(requireWindow())
    sendBootStatus(92, 'Preparing your instance library', 'Checking your selected Minecraft setup')
    await yieldToEventLoop()
    rendererRecoveryAttempts = 0
    sendBootStatus(100, 'MegaClient is ready')
    return {
      ...snapshot,
      account,
      version: app.getVersion(),
      clientVersion: CLIENT_VERSION,
      update: updaterState(),
      discordConfigured: isDiscordActivityConfigured(),
      packaged: app.isPackaged
    }
  })
  ipcMain.handle('versions:minecraft', (_event, snapshots: boolean) => getMinecraftVersions(Boolean(snapshots)))
  ipcMain.handle('versions:loader', (_event, loader: LoaderType, version: string) => getLoaderVersions(loader, version))
  ipcMain.handle('settings:update', async (_event, patch) => {
    const before = store.getData().settings
    const next = await store.updateSettings(patch)
    if (next.checkUpdates !== before.checkUpdates) configureAutomaticUpdates(next.checkUpdates)
    if (next.discordActivity !== before.discordActivity) {
      await configureDiscordActivity(next.discordActivity)
      if (next.discordActivity) {
        const data = store.getData()
        showLauncherActivity(data.instances.find((instance) => instance.id === data.selectedInstanceId) ?? data.instances[0])
      }
    }
    return next
  })

  ipcMain.handle('account:login', () => login(requireWindow()))
  ipcMain.handle('account:logout', () => logout())
  ipcMain.handle('account:profile', (_event, force = false) => getProfileData(requireWindow(), Boolean(force)))
  ipcMain.handle('account:choose-skin', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      title: 'Choose a Minecraft skin',
      buttonLabel: 'Use this skin',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Minecraft PNG skin', extensions: ['png'] }]
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle('account:set-skin', (_event, file: string, variant: 'classic' | 'slim') => updateSkin(requireWindow(), file, variant))
  ipcMain.handle('account:set-cape', (_event, capeId?: string) => switchCape(requireWindow(), capeId))

  ipcMain.handle('instances:create', (_event, input) => createInstance(input))
  ipcMain.handle('instances:update', (_event, id: string, patch) => updateInstance(id, patch))
  ipcMain.handle('instances:delete', (_event, id: string) => deleteInstance(id))
  ipcMain.handle('instances:select', async (_event, id: string) => {
    await store.selectInstance(id)
    showLauncherActivity(getInstance(id))
  })
  ipcMain.handle('instances:open-folder', async (_event, id: string) => shell.openPath(await openInstanceFolder(id)))
  ipcMain.handle('instances:add-local-mod', async (_event, id: string) => {
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft mods', extensions: ['jar'] }] })
    if (result.canceled) return 0
    for (const file of result.filePaths) await copyLocalMod(id, file)
    return result.filePaths.length
  })
  ipcMain.handle('instances:launch', async (_event, id: string) => {
    const window = requireWindow()
    void launchInstance(window, id).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!window.isDestroyed()) window.webContents.send('launch:error', { message })
    })
    return true
  })
  ipcMain.handle('instances:launch-server', async (_event, id: string, address: string) => {
    const window = requireWindow()
    void launchInstance(window, id, address).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!window.isDestroyed()) window.webContents.send('launch:error', { message })
    })
    return true
  })
  ipcMain.handle('instances:open-console', () => openLaunchConsole())

  const progress = (message: string, value?: number): void => requireWindow().webContents.send('mods:progress', { message, progress: value })
  ipcMain.handle('mods:search', (_event, input) => searchContent(input))
  ipcMain.handle('mods:install', (_event, instanceId: string, projectId: string) => installMod(instanceId, projectId, progress))
  ipcMain.handle('mods:install-modpack', (_event, instanceId: string, projectId: string) => installModpack(instanceId, projectId, progress))
  ipcMain.handle('mods:list', (_event, instanceId: string) => listMods(instanceId))
  ipcMain.handle('mods:set-enabled', (_event, instanceId: string, fileName: string, enabled: boolean) => setModEnabled(instanceId, fileName, enabled))
  ipcMain.handle('mods:remove', (_event, instanceId: string, fileName: string) => removeMod(instanceId, fileName))
  ipcMain.handle('mods:update', (_event, instanceId: string, projectId: string) => updateMod(instanceId, projectId, progress))
  ipcMain.handle('mods:update-all', (_event, instanceId: string) => updateAllMods(instanceId, progress))

  ipcMain.handle('packs:install', (_event, instanceId: string, projectId: string, type: 'resourcepack' | 'shader') => installPack(instanceId, projectId, type, progress))
  ipcMain.handle('packs:list', (_event, instanceId: string, type?: 'resourcepack' | 'shader') => listPacks(instanceId, type))
  ipcMain.handle('packs:set-enabled', (_event, instanceId: string, fileName: string, type: 'resourcepack' | 'shader', enabled: boolean) => setPackEnabled(instanceId, fileName, type, enabled))
  ipcMain.handle('packs:remove', (_event, instanceId: string, fileName: string, type: 'resourcepack' | 'shader') => removePack(instanceId, fileName, type))
  ipcMain.handle('packs:open-folder', async (_event, instanceId: string, type: 'resourcepack' | 'shader') => {
    const instance = getInstance(instanceId)
    const directory = type === 'resourcepack' ? resourcePacksDirectory(instance.slug) : shaderPacksDirectory(instance.slug)
    return shell.openPath(directory)
  })

  ipcMain.handle('worlds:list', (_event, instanceId: string) => listWorlds(instanceId))
  ipcMain.handle('worlds:import', async (_event, instanceId: string) => {
    const result = await dialog.showOpenDialog(requireWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Minecraft world archive', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    return importWorldZip(instanceId, result.filePaths[0])
  })
  ipcMain.handle('worlds:download', (_event, instanceId: string, url: string) => downloadWorldZip(instanceId, url, progress))
  ipcMain.handle('worlds:delete', (_event, instanceId: string, worldId: string) => deleteWorld(instanceId, worldId))
  ipcMain.handle('worlds:open-folder', async (_event, instanceId: string, worldId?: string) => shell.openPath(await worldFolder(instanceId, worldId)))

  ipcMain.handle('servers:copy-address', (_event, address: string) => clipboard.writeText(address))
  ipcMain.handle('servers:status', (_event, address: string, force = false) => getPartnerServerStatus(address, Boolean(force)))

  ipcMain.handle('updates:check', () => checkForUpdates('manual'))
  ipcMain.handle('updates:install', () => installReadyUpdate())
}

const singleInstanceLock = app.requestSingleInstanceLock()
if (!singleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

async function startApplication(): Promise<void> {
  app.setAppUserModelId('studio.megastudios.megaclient')
  mainWindowRevealed = false
  splashShownAt = 0
  setSplashProgress(8, 'Opening MegaClient', 'Starting the secure desktop process')
  createSplashWindow()

  setSplashProgress(18, 'Loading your launcher', 'Reading local settings and protecting installed resources')
  await Promise.all([
    store.initialize(),
    hideProtectedInstallationResources()
  ])
  // Let the lightweight splash renderer paint before the heavier main renderer
  // starts, while never holding startup indefinitely if that window cannot load.
  await Promise.race([splashReadyPromise, delay(900)])

  const data = store.getData()
  setSplashProgress(34, 'Preparing the interface', 'Starting your library, updates and account services')
  registerIpc()
  createMainWindow()
  setupUpdater(sendUpdate, data.settings.checkUpdates)

  // Discord RPC is optional and must never delay the visible launcher startup.
  void configureDiscordActivity(data.settings.discordActivity)
    .then(() => {
      if (!data.settings.discordActivity) return
      showLauncherActivity(data.instances.find((instance) => instance.id === data.selectedInstanceId) ?? data.instances[0])
    })
    .catch((error) => console.warn('[MegaClient] Discord activity could not start.', error))

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
}

app.whenReady().then(() => {
  void startApplication().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[MegaClient] Startup failed:', error)
    setSplashProgress(100, 'MegaClient could not start', message)
    await delay(500)
    dialog.showErrorBox('MegaClient could not start', `${message}

Your Minecraft instances and files were not removed.`)
    app.quit()
  })
})

process.on('unhandledRejection', (reason) => console.error('[MegaClient] Unhandled promise rejection:', reason))
process.on('uncaughtException', (error) => console.error('[MegaClient] Uncaught main-process error:', error))

app.on('before-quit', () => shutdownDiscordActivity())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
