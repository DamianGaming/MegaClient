import type { Update } from '@tauri-apps/plugin-updater'
import type { LauncherUpdateState } from './types'

const blankState = (currentVersion = ''): LauncherUpdateState => ({
  state: 'idle',
  currentVersion,
  version: '',
  notes: '',
  percent: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  bytesPerSecond: 0
})

type StateListener = (state: LauncherUpdateState) => void

let pendingUpdate: Update | null = null
let currentState = blankState()
let checkPromise: Promise<LauncherUpdateState> | null = null
let downloadPromise: Promise<LauncherUpdateState> | null = null
let installPromise: Promise<void> | null = null

function publish(listener: StateListener, next: LauncherUpdateState): LauncherUpdateState {
  currentState = next
  listener(next)
  return next
}

function fail(listener: StateListener, error: unknown): LauncherUpdateState {
  return publish(listener, {
    ...currentState,
    state: 'error',
    bytesPerSecond: 0,
    message: error instanceof Error ? error.message : String(error)
  })
}

async function closePending(): Promise<void> {
  const update = pendingUpdate
  pendingUpdate = null
  if (!update) return
  await update.close().catch(() => undefined)
}

export function updaterBuildEnabled(): boolean {
  return import.meta.env.VITE_UPDATER_ENABLED === 'true'
}

export function initialUpdaterState(currentVersion = ''): LauncherUpdateState {
  if (!updaterBuildEnabled()) {
    return {
      ...blankState(currentVersion),
      state: 'disabled',
      message: import.meta.env.DEV
        ? 'Updates are disabled in development builds.'
        : 'This build was not signed and configured for automatic updates.'
    }
  }
  return blankState(currentVersion)
}

export async function checkForLauncherUpdate(
  currentVersion: string,
  listener: StateListener
): Promise<LauncherUpdateState> {
  if (!updaterBuildEnabled()) return publish(listener, initialUpdaterState(currentVersion))
  if (checkPromise) return checkPromise
  if (currentState.state === 'downloading' || currentState.state === 'installing') return currentState

  checkPromise = (async () => {
    publish(listener, {
      ...blankState(currentVersion),
      state: 'checking',
      checkedAt: new Date().toISOString()
    })
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check({ timeout: 30_000 })
      if (!update) {
        await closePending()
        return publish(listener, {
          ...blankState(currentVersion),
          state: 'not-available',
          checkedAt: new Date().toISOString(),
          message: 'MegaClient is up to date.'
        })
      }

      await closePending()
      pendingUpdate = update
      return publish(listener, {
        state: 'available',
        currentVersion: update.currentVersion || currentVersion,
        version: update.version,
        notes: update.body?.trim() ?? '',
        date: update.date,
        percent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        bytesPerSecond: 0,
        checkedAt: new Date().toISOString(),
        message: `MegaClient ${update.version} is available.`
      })
    } catch (error) {
      return fail(listener, error)
    } finally {
      checkPromise = null
    }
  })()

  return checkPromise
}

export async function downloadLauncherUpdate(listener: StateListener): Promise<LauncherUpdateState> {
  if (downloadPromise) return downloadPromise
  const update = pendingUpdate
  if (!update) {
    return fail(listener, new Error('No pending launcher update. Check for updates again.'))
  }
  if (currentState.state === 'downloaded') return currentState

  downloadPromise = (async () => {
    let downloadedBytes = 0
    let totalBytes = 0
    let lastSampleBytes = 0
    let lastSampleAt = performance.now()
    let lastPaintAt = 0
    let smoothedSpeed = 0

    const emitProgress = (force = false) => {
      const now = performance.now()
      if (!force && now - lastPaintAt < 100) return
      const elapsedSeconds = Math.max((now - lastSampleAt) / 1000, 0.001)
      const instantaneousSpeed = (downloadedBytes - lastSampleBytes) / elapsedSeconds
      smoothedSpeed = smoothedSpeed === 0 ? instantaneousSpeed : smoothedSpeed * 0.72 + instantaneousSpeed * 0.28
      lastSampleBytes = downloadedBytes
      lastSampleAt = now
      lastPaintAt = now
      publish(listener, {
        ...currentState,
        state: 'downloading',
        percent: totalBytes > 0 ? Math.min(100, downloadedBytes / totalBytes * 100) : 0,
        downloadedBytes,
        totalBytes,
        bytesPerSecond: Math.max(0, Math.round(smoothedSpeed)),
        message: 'Downloading the signed update…'
      })
    }

    publish(listener, {
      ...currentState,
      state: 'downloading',
      percent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      message: 'Preparing the signed update…'
    })

    try {
      await update.download(event => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0
          emitProgress(true)
          return
        }
        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          emitProgress(false)
          return
        }
        if (event.event === 'Finished') emitProgress(true)
      }, { timeout: 10 * 60_000 })

      return publish(listener, {
        ...currentState,
        state: 'downloaded',
        percent: 100,
        downloadedBytes: totalBytes || downloadedBytes,
        totalBytes: totalBytes || downloadedBytes,
        bytesPerSecond: 0,
        message: 'Update downloaded and verified. Restart to install it.'
      })
    } catch (error) {
      return fail(listener, error)
    } finally {
      downloadPromise = null
    }
  })()

  return downloadPromise
}

export async function installLauncherUpdate(listener: StateListener): Promise<void> {
  if (installPromise) return installPromise
  const update = pendingUpdate
  if (!update) {
    fail(listener, new Error('No downloaded launcher update is ready to install.'))
    return
  }
  if (currentState.state !== 'downloaded') {
    fail(listener, new Error('Download the update before installing it.'))
    return
  }

  installPromise = (async () => {
    publish(listener, {
      ...currentState,
      state: 'installing',
      bytesPerSecond: 0,
      message: 'Installing the update and restarting MegaClient…'
    })
    try {
      await update.install()
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (error) {
      fail(listener, error)
    } finally {
      installPromise = null
    }
  })()

  return installPromise
}
