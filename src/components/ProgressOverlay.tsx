import { Check, LoaderCircle } from 'lucide-react'
import type { ProgressEvent } from '../lib/types'

export function ProgressOverlay({ progress, onDismiss }: { progress: ProgressEvent | null; onDismiss: () => void }) {
  if (!progress) return null
  const percent = Math.max(0, Math.min(100, progress.percent))
  return (
    <div className={`progress-toast ${progress.done ? 'is-done' : ''}`} role="status">
      <span className="progress-toast__icon">
        {progress.done ? <Check size={17} /> : <LoaderCircle className="spin" size={18} />}
      </span>
      <div className="progress-toast__body">
        <div><strong>{progress.label}</strong><span>{Math.round(percent)}%</span></div>
        <small>{progress.detail}</small>
        <div className="progress-track"><span style={{ transform: `scaleX(${percent / 100})` }} /></div>
      </div>
      {progress.done && <button onClick={onDismiss}>Done</button>}
    </div>
  )
}
