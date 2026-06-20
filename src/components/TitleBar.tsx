import { Minus, Square, X } from 'lucide-react'
import comet from '../assets/comet.png'

async function withWindow(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!('__TAURI_INTERNALS__' in window)) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const appWindow = getCurrentWindow()
  if (action === 'minimize') await appWindow.minimize()
  if (action === 'toggleMaximize') await appWindow.toggleMaximize()
  if (action === 'close') await appWindow.close()
}

export function TitleBar({ version }: { version: string }) {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar__brand" data-tauri-drag-region>
        <img src={comet} alt="" draggable={false} />
        <span>MegaClient</span>
        <span className="titlebar__version">v{version}</span>
      </div>
      <div className="titlebar__drag" data-tauri-drag-region />
      <div className="window-controls">
        <button aria-label="Minimize" onClick={() => void withWindow('minimize')}><Minus size={15} /></button>
        <button aria-label="Maximize" onClick={() => void withWindow('toggleMaximize')}><Square size={13} /></button>
        <button className="window-controls__close" aria-label="Close" onClick={() => void withWindow('close')}><X size={16} /></button>
      </div>
    </header>
  )
}
