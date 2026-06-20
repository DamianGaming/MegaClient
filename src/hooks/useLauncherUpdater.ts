import { useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherUpdateState } from '../lib/types'
import {
  checkForLauncherUpdate,
  downloadLauncherUpdate,
  initialUpdaterState,
  installLauncherUpdate,
  updaterBuildEnabled
} from '../lib/updater'

const STARTUP_CHECK_DELAY_MS = 2500

export function useLauncherUpdater(options: {
  currentVersion: string
  autoCheck: boolean
  autoDownload: boolean
  ready: boolean
}) {
  const { currentVersion, autoCheck, autoDownload, ready } = options
  const [updateState, setUpdateState] = useState<LauncherUpdateState>(() => initialUpdaterState(currentVersion))
  const checkedThisSession = useRef(false)

  useEffect(() => {
    setUpdateState(current => ({ ...current, currentVersion }))
  }, [currentVersion])

  const downloadUpdate = useCallback(async () => {
    return downloadLauncherUpdate(setUpdateState)
  }, [])

  const checkForUpdates = useCallback(async () => {
    const result = await checkForLauncherUpdate(currentVersion, setUpdateState)
    if (result.state === 'available' && autoDownload) await downloadLauncherUpdate(setUpdateState)
    return result
  }, [autoDownload, currentVersion])

  const installUpdate = useCallback(async () => {
    await installLauncherUpdate(setUpdateState)
  }, [])

  useEffect(() => {
    if (!ready || !autoCheck || !updaterBuildEnabled() || checkedThisSession.current) return
    checkedThisSession.current = true
    const timer = window.setTimeout(() => {
      void checkForUpdates()
    }, STARTUP_CHECK_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [autoCheck, checkForUpdates, ready])

  return {
    updateState,
    updaterEnabled: updaterBuildEnabled(),
    checkForUpdates,
    downloadUpdate,
    installUpdate
  }
}
