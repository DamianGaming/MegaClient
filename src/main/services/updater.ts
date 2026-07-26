import { app, net, powerMonitor } from 'electron'
import electronUpdater, { CancellationToken, type AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }

export interface LauncherUpdateState {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'current' | 'offline' | 'error' | 'development'
  version?: string
  percent?: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  message?: string
  checkedAt?: string
  nextCheckAt?: string
  automatic: boolean
  pausedForGame?: boolean
}

const CHECK_INTERVAL = 20 * 60_000
const MINIMUM_CHECK_GAP = 4 * 60_000
const RETRY_INTERVAL = 8 * 60_000
const POST_GAME_DELAY = 12_000

let sendState: (state: LauncherUpdateState) => void = () => undefined
let automaticEnabled = true
let updateReady = false
let gameplayActive = false
let pendingDownload = false
let checkInFlight: Promise<unknown> | null = null
let downloadInFlight: Promise<unknown> | null = null
let downloadCancellation: CancellationToken | null = null
let downloadCancelledForGame = false
let scheduledCheck: NodeJS.Timeout | null = null
let resumeDownloadTimer: NodeJS.Timeout | null = null
let lastCheckAt = 0
let nextCheckAt = 0
let lastProgressSentAt = 0
let state: LauncherUpdateState = { state: app.isPackaged ? 'idle' : 'development', automatic: true, pausedForGame: false }
let listenersInstalled = false


function isCancellationError(error: unknown): boolean {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /cancel(?:led|ed|lation)?/i.test(raw)
}

function clearResumeDownload(): void {
  if (resumeDownloadTimer) clearTimeout(resumeDownloadTimer)
  resumeDownloadTimer = null
}

function resumePendingDownload(delay = 2_000): void {
  clearResumeDownload()
  if (gameplayActive || updateReady || !pendingDownload) return
  resumeDownloadTimer = setTimeout(() => {
    resumeDownloadTimer = null
    if (gameplayActive || updateReady || !pendingDownload) return
    if (downloadInFlight) {
      resumePendingDownload(1_000)
      return
    }
    void beginDownload()
  }, delay)
  resumeDownloadTimer.unref()
}

function friendlyUpdateError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|network|offline|timed?\s*out/i.test(raw)) {
    return 'MegaClient could not reach the update service. It will try again automatically.'
  }
  if (/404|latest\.yml|no published versions/i.test(raw)) {
    return 'No compatible published update information is available yet.'
  }
  return 'The update scan could not finish. MegaClient will retry automatically.'
}

function publish(patch: Partial<LauncherUpdateState> & Pick<LauncherUpdateState, 'state'>): LauncherUpdateState {
  state = {
    ...state,
    ...patch,
    automatic: automaticEnabled,
    pausedForGame: gameplayActive,
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
  if (!automaticEnabled || !app.isPackaged || updateReady || gameplayActive) {
    publish({ state: state.state })
    return
  }
  nextCheckAt = Date.now() + Math.max(2_000, delay)
  state = { ...state, automatic: automaticEnabled, pausedForGame: false, nextCheckAt: new Date(nextCheckAt).toISOString() }
  sendState(state)
  scheduledCheck = setTimeout(() => {
    scheduledCheck = null
    nextCheckAt = 0
    void checkForUpdates('scheduled')
  }, Math.max(2_000, delay))
  scheduledCheck.unref()
}

async function beginDownload(): Promise<unknown> {
  if (gameplayActive || updateReady || !pendingDownload) return state
  if (downloadInFlight) return downloadInFlight

  const cancellation = new CancellationToken()
  downloadCancellation = cancellation
  downloadCancelledForGame = false
  downloadInFlight = autoUpdater.downloadUpdate(cancellation)
    .catch((error: unknown) => {
      if (cancellation.cancelled || downloadCancelledForGame) {
        publish({
          state: 'available',
          message: 'Update download paused until Minecraft closes.'
        })
        return state
      }
      console.warn('[MegaClient] Update download failed:', error)
      publish({ state: 'error', message: friendlyUpdateError(error), checkedAt: new Date().toISOString() })
      schedule(RETRY_INTERVAL)
      return state
    })
    .finally(() => {
      if (downloadCancellation === cancellation) downloadCancellation = null
      downloadInFlight = null
    })
  return downloadInFlight
}

function installListeners(): void {
  if (listenersInstalled) return
  listenersInstalled = true

  // Update discovery and download are separated so MegaClient never begins a
  // bandwidth-heavy installer download while Minecraft is running.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.fullChangelog = true

  autoUpdater.on('checking-for-update', () => publish({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => {
    lastCheckAt = Date.now()
    clearSchedule()
    pendingDownload = true
    publish({
      state: 'available',
      version: info.version,
      checkedAt: new Date(lastCheckAt).toISOString(),
      message: gameplayActive
        ? 'Update found. Its download will begin after Minecraft closes.'
        : 'Update found. Downloading automatically.'
    })
    if (!gameplayActive) void beginDownload()
  })
  autoUpdater.on('update-not-available', () => {
    lastCheckAt = Date.now()
    pendingDownload = false
    publish({
      state: 'current',
      percent: undefined,
      transferred: undefined,
      total: undefined,
      bytesPerSecond: undefined,
      checkedAt: new Date(lastCheckAt).toISOString(),
      message: gameplayActive ? 'Automatic update activity is paused while Minecraft is running.' : undefined
    })
    schedule(CHECK_INTERVAL)
  })
  autoUpdater.on('download-progress', (progress) => {
    if (gameplayActive) return
    const now = Date.now()
    if (now - lastProgressSentAt < 500 && progress.percent < 100) return
    lastProgressSentAt = now
    publish({
      state: 'downloading',
      percent: Math.max(0, Math.min(100, progress.percent)),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
      message: 'Downloading the launcher update.'
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true
    pendingDownload = false
    clearSchedule()
    publish({
      state: 'ready',
      version: info.version,
      percent: 100,
      transferred: state.total,
      checkedAt: new Date().toISOString(),
      message: 'The update is ready to install.'
    })
  })
  autoUpdater.on('error', (error) => {
    if (downloadCancelledForGame || (pendingDownload && isCancellationError(error))) {
      publish({
        state: pendingDownload ? 'available' : state.state,
        message: gameplayActive
          ? 'Update activity is paused while Minecraft is running.'
          : 'Update download will resume automatically.'
      })
      if (!gameplayActive) resumePendingDownload()
      return
    }
    console.warn('[MegaClient] Automatic update error:', error)
    publish({ state: 'error', message: friendlyUpdateError(error), checkedAt: new Date().toISOString() })
    schedule(RETRY_INTERVAL)
  })

  powerMonitor.on('resume', () => void checkForUpdates('resume'))
}

export function setupUpdater(sender: (state: LauncherUpdateState) => void, enabled: boolean): void {
  sendState = sender
  automaticEnabled = Boolean(enabled)
  state = { ...state, automatic: automaticEnabled, pausedForGame: gameplayActive }
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

export function setGameplayUpdatePause(active: boolean): void {
  if (gameplayActive === active) return
  gameplayActive = active
  if (active) {
    clearSchedule()
    clearResumeDownload()
    if (downloadCancellation && !downloadCancellation.cancelled) {
      downloadCancelledForGame = true
      pendingDownload = true
      downloadCancellation.cancel()
    }
    publish({
      state: pendingDownload ? 'available' : state.state,
      message: pendingDownload
        ? 'Update found. Its download will begin after Minecraft closes.'
        : 'Automatic update activity is paused while Minecraft is running.'
    })
    return
  }

  downloadCancelledForGame = false
  publish({ state: state.state, message: state.state === 'available' ? 'Update download is resuming.' : undefined })
  if (pendingDownload && !updateReady) {
    resumePendingDownload()
  } else if (automaticEnabled && !updateReady) {
    schedule(POST_GAME_DELAY)
  }
}

export async function checkForUpdates(reason: 'manual' | 'startup' | 'scheduled' | 'resume' | 'focus' = 'manual'): Promise<unknown> {
  if (!app.isPackaged) return publish({ state: 'development' })
  if (reason !== 'manual' && !automaticEnabled) return state
  if (updateReady) return state
  if (gameplayActive) {
    return publish({
      state: state.state,
      message: pendingDownload
        ? 'Update found. Its download will begin after Minecraft closes.'
        : 'Automatic update activity is paused while Minecraft is running.'
    })
  }
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
  publish({ state: 'checking', checkedAt: new Date(now).toISOString(), message: undefined })
  checkInFlight = autoUpdater.checkForUpdates()
    .catch((error: unknown) => {
      console.warn('[MegaClient] Update check failed:', error)
      publish({ state: 'error', message: friendlyUpdateError(error), checkedAt: new Date().toISOString() })
      schedule(RETRY_INTERVAL)
      return state
    })
    .finally(() => { checkInFlight = null })
  return checkInFlight
}

export function updaterState(): LauncherUpdateState {
  return {
    ...state,
    automatic: automaticEnabled,
    pausedForGame: gameplayActive,
    nextCheckAt: nextCheckAt ? new Date(nextCheckAt).toISOString() : undefined
  }
}

export function installReadyUpdate(): void {
  if (updateReady) autoUpdater.quitAndInstall(false, true)
}

export function notifyWindowFocused(): void {
  void checkForUpdates('focus')
}
