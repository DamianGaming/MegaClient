import { useEffect, useMemo, useRef } from 'react'
import { CircleStop, Terminal, X } from 'lucide-react'
import type { LauncherController } from '../hooks/useLauncher'
import { launcherApi } from '../lib/api'

export function LaunchConsoleModal({ controller }: { controller: LauncherController }) {
  const { consoleLines, launchConsoleVisible, setLaunchConsoleVisible, status } = controller
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const running = ['installing', 'launching', 'running', 'stopping'].includes(status.state)
  const statusLabel = useMemo(() => {
    switch (status.state) {
      case 'installing': return 'Preparing game'
      case 'launching': return 'Starting Java'
      case 'running': return 'Minecraft is running'
      case 'stopping': return 'Stopping game'
      case 'error': return 'Launch failed'
      case 'closed': return 'Game closed'
      default: return 'Launch console'
    }
  }, [status.state])

  useEffect(() => {
    if (!launchConsoleVisible) return
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [consoleLines, launchConsoleVisible])

  if (!launchConsoleVisible) return null

  return (
    <div className="launch-console-backdrop" role="presentation">
      <section className="launch-console-modal" role="dialog" aria-modal="true" aria-label="Launch console">
        <header className="launch-console-modal__head">
          <div className="launch-console-modal__title">
            <span><Terminal size={18} /></span>
            <div>
              <strong>{statusLabel}</strong>
              <small>{consoleLines.length} console lines</small>
            </div>
          </div>
          <div className="launch-console-modal__actions">
            {running && (
              <button className="button button--small button--danger" onClick={() => void launcherApi.kill()}>
                <CircleStop size={14} /> Stop
              </button>
            )}
            <button className="icon-button" aria-label="Close launch console" onClick={() => setLaunchConsoleVisible(false)}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="launch-console-modal__status">
          <i className={running ? 'status-dot status-dot--busy' : status.state === 'error' ? 'status-dot status-dot--error' : 'status-dot status-dot--muted'} />
          <span>{status.message || statusLabel}</span>
        </div>
        <div className="launch-console-modal__lines" ref={scrollRef} role="log" aria-live="polite">
          {consoleLines.length === 0 ? (
            <div className="launch-console-modal__empty">Waiting for launch output…</div>
          ) : consoleLines.map((line, index) => (
            <div className={`console-line console-line--${line.level}`} key={`${line.timestamp}-${index}`}>
              <time>{new Date(line.timestamp).toLocaleTimeString()}</time>
              <span>{line.level}</span>
              <code>{line.text}</code>
            </div>
          ))}
        </div>
        <footer className="launch-console-modal__foot">
          <span>You can close this window without stopping Minecraft.</span>
          <button className="button button--ghost button--small" onClick={() => setLaunchConsoleVisible(false)}>Dismiss</button>
        </footer>
      </section>
    </div>
  )
}
