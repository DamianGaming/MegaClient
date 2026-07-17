import { app, net, powerMonitor } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }

export interface LauncherUpdateState {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'offline' | 'error' | 'development'
  version?: string
  percent?: number
  message?: string
  checkedAt?: string
  nextCheckAt?: string
  automatic: boolean
}

const CHECK_INTERVAL = 20 * 60_000
const MINIMUM_CHECK_GAP = 4 * 60_000
const RETRY_INTERVAL = 8 * 60_000

let sendState: (state: LauncherUpdateState) => void = () => undefined
let automaticEnabled = true
let updateReady = false
let checkInFlight: Promise<unknown> | null = null
let scheduledCheck: NodeJS.Timeout | null = null
let lastCheckAt = 0
let nextCheckAt = 0
let lastProgressSentAt = 0
let state: LauncherUpdateState = { state: app.isPackaged ? 'idle' : 'development', automatic: true }
let listenersInstalled = false

function publish(patch: Partial<LauncherUpdateState> & Pick<LauncherUpdateState, 'state'>): LauncherUpdateState {
  state = {
    ...state,
    ...patch,
    automatic: automaticEnabled,
    nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : undefined
  }
  sendState(state)
  return state
}

function clearSchedule(): void {
  if (scheduledCheck) clearTimeout(scheduledCheck)
  scheduledCheck = null
  nextCheckAt = 0
}

function schedule(delay: number): void {
  clearSchedule()
  if (!automaticEnabled || !app.isPackaged || updateReady) return
  nextCheckAt = Date.now() + Math.max(2_000, delay)
  state = { ...state, automatic: automaticEnabled, nextCheckAt: new Date(nextCheckAt).toISOString() }
  sendState(state)
  scheduledCheck = setTimeout(() => {
    scheduledCheck = null
    nextCheckAt = 0
    void checkForUpdates('scheduled')
  }, Math.max(2_000, delay))
  scheduledCheck.unref()
}

function installListeners(): void {
  if (listenersInstalled) return
  listenersInstalled = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.fullChangelog = true

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    lastCheckAt = Date.now()
    clearSchedule()
    publish({ state: 'available', version: info.version, checkedAt: new Date(lastCheckAt).toISOString() })
  })
  autoUpdater.on('update-not-available', () => {
    lastCheckAt = Date.now()
    publish({ state: 'current', checkedAt: new Date(lastCheckAt).toISOString() })
    schedule(CHECK_INTERVAL)
  })
  autoUpdater.on('download-progress', (progress) => {
    const now = Date.now()
    if (now - lastProgressSentAt < 300 && progress.percent < 100) return
    lastProgressSentAt = now
    publish({ state: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true
    clearSchedule()
    publish({ state: 'ready', version: info.version, percent: 100, checkedAt: new Date().toISOString() })
  })
  autoUpdater.on('error', (error) => {
    publish({ state: 'error', message: error.message, checkedAt: new Date().toISOString() })
    schedule(RETRY_INTERVAL)
  })

  powerMonitor.on('resume', () => void checkForUpdates('resume'))
}

export function setupUpdater(sender: (state: LauncherUpdateState) => void, enabled: boolean): void {
  sendState = sender
  automaticEnabled = Boolean(enabled)
  state = { ...state, automatic: automaticEnabled }
  installListeners()
  sendState(state)
  if (automaticEnabled && app.isPackaged) schedule(4_000)
}

export function configureAutomaticUpdates(enabled: boolean): void {
  automaticEnabled = Boolean(enabled)
  publish({ state: state.state })
  if (automaticEnabled) schedule(1_500)
  else clearSchedule()
}

export async function checkForUpdates(reason: 'manual' | 'startup' | 'scheduled' | 'resume' | 'focus' = 'manual'): Promise<unknown> {
  if (!app.isPackaged) return publish({ state: 'development' })
  if (reason !== 'manual' && !automaticEnabled) return state
  if (updateReady) return state
  if (checkInFlight) return checkInFlight

  const now = Date.now()
  if (reason !== 'manual' && lastCheckAt && now - lastCheckAt < MINIMUM_CHECK_GAP) {
    schedule(Math.max(2_000, CHECK_INTERVAL - (now - lastCheckAt)))
    return state
  }

  if (!net.isOnline()) {
    publish({ state: 'offline', message: 'Waiting for an internet connection', checkedAt: new Date().toISOString() })
    schedule(RETRY_INTERVAL)
    return state
  }

  lastCheckAt = now
  publish({ state: 'checking', checkedAt: new Date(now).toISOString() })
  checkInFlight = autoUpdater.checkForUpdates()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      publish({ state: 'error', message, checkedAt: new Date().toISOString() })
      schedule(RETRY_INTERVAL)
      return state
    })
    .finally(() => { checkInFlight = null })
  return checkInFlight
}

export function updaterState(): LauncherUpdateState {
  return { ...state, automatic: automaticEnabled, nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : undefined }
}

export function installReadyUpdate(): void {
  if (updateReady) autoUpdater.quitAndInstall(false, true)
}

export function notifyWindowFocused(): void {
  void checkForUpdates('focus')
}
