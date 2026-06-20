import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, LoaderCircle, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { LauncherUpdateState } from '../lib/types'

interface UpdateNotificationProps {
  state: LauncherUpdateState
  onCheck: () => Promise<unknown>
  onDownload: () => Promise<unknown>
  onInstall: () => Promise<unknown>
}

export function UpdateNotification({ state, onCheck, onDownload, onInstall }: UpdateNotificationProps) {
  const key = `${state.state}:${state.version}:${state.message ?? ''}`
  const [dismissedKey, setDismissedKey] = useState('')

  useEffect(() => {
    if (state.state === 'downloading' || state.state === 'downloaded' || state.state === 'installing') setDismissedKey('')
  }, [state.state])

  const visible = ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(state.state)
  const summary = useMemo(() => summarizeNotes(state.notes), [state.notes])
  if (!visible || dismissedKey === key) return null

  const busy = state.state === 'downloading' || state.state === 'installing'
  const title = state.state === 'available'
    ? `MegaClient ${state.version} is available`
    : state.state === 'downloading'
      ? `Downloading MegaClient ${state.version}`
      : state.state === 'downloaded'
        ? `MegaClient ${state.version} is ready`
        : state.state === 'installing'
          ? 'Installing update…'
          : 'Update check failed'

  return (
    <aside className={`update-toast update-toast--${state.state}`} role={state.state === 'error' ? 'alert' : 'status'}>
      <div className="update-toast__icon">
        {state.state === 'error' ? <AlertTriangle size={18} /> : state.state === 'downloaded' ? <CheckCircle2 size={18} /> : busy ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
      </div>
      <div className="update-toast__content">
        <div className="update-toast__heading">
          <div><small>Launcher update</small><strong>{title}</strong></div>
          {!busy && <button className="update-toast__close" aria-label="Dismiss update notification" onClick={() => setDismissedKey(key)}><X size={15} /></button>}
        </div>
        {summary && state.state !== 'error' && <p>{summary}</p>}
        {state.message && (state.state === 'error' || busy) && <p>{state.message}</p>}
        {(state.state === 'downloading' || state.state === 'downloaded') && (
          <div className="update-progress">
            <div><span>{state.state === 'downloaded' ? 'Verified' : formatProgress(state)}</span><strong>{Math.round(state.percent)}%</strong></div>
            <div className="update-progress__track"><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, state.percent / 100))})` }} /></div>
          </div>
        )}
        <div className="update-toast__actions">
          {state.state === 'available' && <button className="button button--primary button--small" onClick={() => void onDownload()}><Download size={14} /> Download update</button>}
          {state.state === 'downloaded' && <button className="button button--primary button--small" onClick={() => void onInstall()}><RotateCcw size={14} /> Install and restart</button>}
          {state.state === 'error' && <button className="button button--ghost button--small" onClick={() => void onCheck()}><RefreshCw size={14} /> Try again</button>}
        </div>
      </div>
    </aside>
  )
}

function summarizeNotes(notes: string): string {
  const first = notes.split(/\r?\n/).map(value => value.replace(/^[-*#\s]+/, '').trim()).find(Boolean) ?? ''
  return first.length > 180 ? `${first.slice(0, 177)}…` : first
}

function formatProgress(state: LauncherUpdateState): string {
  if (state.totalBytes <= 0) return state.bytesPerSecond > 0 ? `${formatBytes(state.bytesPerSecond)}/s` : 'Downloading…'
  const speed = state.bytesPerSecond > 0 ? ` · ${formatBytes(state.bytesPerSecond)}/s` : ''
  return `${formatBytes(state.downloadedBytes)} of ${formatBytes(state.totalBytes)}${speed}`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  const amount = value / 1024 ** index
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}
