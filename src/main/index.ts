import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, shell } from 'electron'
import path from 'node:path'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }
import type { LoaderType } from './types'
import { store } from './services/store'
import { login, logout, restore } from './services/account'
import { createInstance, deleteInstance, getInstance, openInstanceFolder, updateInstance, copyLocalMod } from './services/instances'
import { getLoaderVersions, getMinecraftVersions } from './services/versions'
import { installMod, installModpack, installPack, listMods, listPacks, removeMod, removePack, searchContent, setModEnabled, setPackEnabled, updateAllMods, updateMod } from './services/modrinth'
import { launchInstance, openLaunchConsole } from './services/launcher'
import { getProfileData, switchCape, updateSkin } from './services/profile'
import { deleteWorld, downloadWorldZip, importWorldZip, listWorlds, worldFolder } from './services/worlds'
import { resourcePacksDirectory, shaderPacksDirectory } from './services/paths'
import { getPartnerServerStatus } from './services/servers'

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let updateReady = false
let splashProgress = { value: 6, message: 'Starting MegaClient' }

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
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(rendererUrl(view))
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

function setSplashProgress(value: number, message: string): void {
  splashProgress = { value: Math.max(0, Math.min(100, value)), message }
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
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[MegaClient] Renderer process ended unexpectedly.', details)
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
  splashWindow = new BrowserWindow({
    width: 430,
    height: 230,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0b0d12',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  configureRendererWindow(splashWindow)
  splashWindow.webContents.once('did-finish-load', () => {
    if (!splashWindow || splashWindow.isDestroyed()) return
    splashWindow.webContents.send('splash:progress', splashProgress)
    splashWindow.center()
    splashWindow.show()
  })
  loadRenderer(splashWindow, 'splash')
  splashWindow.on('closed', () => { splashWindow = null })
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
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0b0d12',
    icon: iconPath(),
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
  loadRenderer(mainWindow, 'main')
  mainWindow.on('closed', () => {
    mainWindow = null
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  })
}

function createWindows(): void {
  splashProgress = { value: 6, message: 'Starting MegaClient' }
  createSplashWindow()
  setSplashProgress(22, 'Preparing launcher')
  createMainWindow()
}

async function revealMainWindow(): Promise<void> {
  const window = requireWindow()
  if (window.isMinimized()) window.restore()
  window.center()
  window.show()
  window.focus()
  setSplashProgress(100, 'Ready')

  const splash = splashWindow
  if (!splash || splash.isDestroyed()) return
  await new Promise((resolve) => setTimeout(resolve, 180))
  for (let opacity = 1; opacity >= 0; opacity -= 0.12) {
    if (splash.isDestroyed()) return
    splash.setOpacity(Math.max(0, opacity))
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  if (!splash.isDestroyed()) splash.close()
}

function requireWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The MegaClient window is not available.')
  return mainWindow
}

function sendUpdate(payload: unknown): void {
  mainWindow?.webContents.send('updates:event', payload)
}

function setupUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'current' }))
  autoUpdater.on('download-progress', (progress) => sendUpdate({ state: 'downloading', percent: progress.percent }))
  autoUpdater.on('update-downloaded', (info) => { updateReady = true; sendUpdate({ state: 'ready', version: info.version }) })
  autoUpdater.on('error', (error) => sendUpdate({ state: 'error', message: error.message }))
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

  ipcMain.handle('app:renderer-ready', () => revealMainWindow())
  ipcMain.handle('app:bootstrap', async () => {
    setSplashProgress(72, 'Restoring your launcher')
    const account = await restore(requireWindow())
    setSplashProgress(90, 'Finishing setup')
    return {
      ...store.getData(),
      account,
      version: app.getVersion(),
      packaged: app.isPackaged
    }
  })
  ipcMain.handle('versions:minecraft', (_event, snapshots: boolean) => getMinecraftVersions(Boolean(snapshots)))
  ipcMain.handle('versions:loader', (_event, loader: LoaderType, version: string) => getLoaderVersions(loader, version))
  ipcMain.handle('settings:update', (_event, patch) => store.updateSettings(patch))

  ipcMain.handle('account:login', () => login(requireWindow()))
  ipcMain.handle('account:logout', () => logout())
  ipcMain.handle('account:profile', (_event, force = false) => getProfileData(requireWindow(), Boolean(force)))
  ipcMain.handle('account:choose-skin', async () => {
    const result = await dialog.showOpenDialog(requireWindow(), { properties: ['openFile'], filters: [{ name: 'Minecraft skin', extensions: ['png'] }] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('account:set-skin', (_event, file: string, variant: 'classic' | 'slim') => updateSkin(requireWindow(), file, variant))
  ipcMain.handle('account:set-cape', (_event, capeId?: string) => switchCape(requireWindow(), capeId))

  ipcMain.handle('instances:create', (_event, input) => createInstance(input))
  ipcMain.handle('instances:update', (_event, id: string, patch) => updateInstance(id, patch))
  ipcMain.handle('instances:delete', (_event, id: string) => deleteInstance(id))
  ipcMain.handle('instances:select', (_event, id: string) => store.selectInstance(id))
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

  ipcMain.handle('updates:check', async () => {
    if (!app.isPackaged) return { state: 'development' }
    return autoUpdater.checkForUpdates()
  })
  ipcMain.handle('updates:install', () => {
    if (updateReady) autoUpdater.quitAndInstall(false, true)
  })
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

app.whenReady().then(async () => {
  app.setAppUserModelId('studio.megastudios.megaclient')
  await store.initialize()
  registerIpc()
  setupUpdater()
  createWindows()
  if (app.isPackaged && store.getData().settings.checkUpdates) {
    setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 3000)
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
