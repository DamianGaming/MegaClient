import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, LoaderCircle, Play, RefreshCw, Server, Users } from 'lucide-react'
import { EmptyState } from '../components/EmptyState'
import { SectionHeader } from '../components/SectionHeader'
import type { LauncherController } from '../hooks/useLauncher'
import { launcherApi } from '../lib/api'
import type { PartneredServer } from '../lib/types'
import { safeMessage } from '../lib/utils'

export function ServersPage({ controller }: { controller: LauncherController }) {
  const [servers, setServers] = useState<PartneredServer[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setServers(await launcherApi.partneredServers())
    } catch (error) {
      controller.setError(safeMessage(error))
    } finally {
      setLoading(false)
    }
  }, [controller.setError])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(timer)
  }, [load])

  const copyAddress = async (server: PartneredServer) => {
    await navigator.clipboard.writeText(server.address)
    setCopied(server.id)
    window.setTimeout(() => setCopied(current => current === server.id ? null : current), 1600)
  }

  return (
    <div className="page">
      <SectionHeader
        title="Partnered servers"
        action={
          <button className="button button--ghost" disabled={loading} onClick={() => void load()}>
            <RefreshCw className={loading ? 'spin' : ''} size={16} /> Refresh
          </button>
        }
      />

      {loading && servers.length === 0 ? (
        <div className="page-loading"><LoaderCircle className="spin" size={22} /> Checking server status…</div>
      ) : servers.length === 0 ? (
        <EmptyState icon={Server} title="No partnered servers" description="Partnered servers will appear here." />
      ) : (
        <div className="partner-server-grid">
          {servers.map(server => (
            <article className="partner-server-card panel" key={server.id}>
              <div className="partner-server-card__identity">
                <span className="partner-server-card__icon">
                  {server.iconUrl ? <img src={server.iconUrl} alt={`${server.name} server icon`} /> : <Server size={30} />}
                </span>
                <div>
                  <span className={server.online ? 'server-state is-online' : 'server-state'}>
                    <i className={server.online ? 'status-dot' : 'status-dot status-dot--muted'} />
                    {server.online ? 'Online' : 'Offline'}
                  </span>
                  <h2>{server.name}</h2>
                  <button className="server-address" onClick={() => void copyAddress(server)} title="Copy server address">
                    <code>{server.address}</code>
                    {copied === server.id ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>

              <div className="partner-server-card__motd">
                {server.motd.map((line, index) => <p key={`${server.id}-${index}`}>{line}</p>)}
              </div>

              <div className="partner-server-card__meta">
                <span><Users size={16} /><strong>{server.playersOnline}</strong> / {server.playersMax || '—'} players</span>
                <span>{server.version || 'Minecraft Java'}</span>
              </div>

              <div className="partner-server-card__actions">
                <button
                  className="button button--primary"
                  disabled={!controller.selectedInstance || ['installing', 'launching', 'running', 'stopping'].includes(controller.status.state)}
                  onClick={() => void controller.launchServer(server.address)}
                >
                  <Play size={16} fill="currentColor" />
                  {controller.selectedInstance ? `Join with ${controller.selectedInstance.name}` : 'Select an instance first'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
