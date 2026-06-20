import { ArrowRight, Boxes, Clock3, Layers3, Play, Search, Server, Sparkles } from 'lucide-react'
import comet from '../assets/comet.png'
import type { LauncherController } from '../hooks/useLauncher'
import type { RouteKey } from '../lib/types'
import { formatLoaderName, formatRelativeDate } from '../lib/utils'

export function HomePage({ controller, onRoute }: { controller: LauncherController; onRoute: (route: RouteKey) => void }) {
  const { bootstrap, selectedInstance, status } = controller
  if (!bootstrap) return null
  const account = controller.activeAccount
  const recent = [...bootstrap.instances].sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '')).slice(0, 3)
  const isRunning = status.state === 'running'

  return (
    <div className="page page--home">
      <section className="home-hero home-hero--clean">
        <div className="home-hero__copy">
          <span className="hero-kicker"><Sparkles size={14} /> Welcome back</span>
          <h1>{account?.name ?? 'MegaClient'}</h1>
          <div className="home-hero__actions">
            <button className="button button--primary" disabled={!selectedInstance || isRunning} onClick={() => void controller.launchSelected()}>
              <Play size={17} fill="currentColor" /> {isRunning ? 'Game running' : selectedInstance ? `Play ${selectedInstance.name}` : 'Select an instance'}
            </button>
            <button className="button button--ghost" onClick={() => onRoute('library')}>Library <ArrowRight size={16} /></button>
          </div>
        </div>
        <div className="home-hero__visual" aria-hidden="true">
          <div className="hero-orbit hero-orbit--one" />
          <div className="hero-orbit hero-orbit--two" />
          <img src={comet} alt="" draggable={false} />
          <span className="hero-status"><span className={status.state === 'idle' ? 'status-dot' : 'status-dot status-dot--busy'} /> {status.state === 'idle' ? 'Ready' : status.state}</span>
        </div>
      </section>

      <div className="home-grid home-grid--single-focus home-grid--spaced">
        <section className="panel recent-panel">
          <div className="panel__heading">
            <div><h2>Recent instances</h2></div>
            <button className="text-button" onClick={() => onRoute('library')}>View all <ArrowRight size={14} /></button>
          </div>
          <div className="recent-list">
            {recent.length > 0 ? recent.map(instance => (
              <button key={instance.id} className={selectedInstance?.id === instance.id ? 'recent-item is-selected' : 'recent-item'} onClick={() => controller.setSelectedInstance(instance.id)}>
                <span className="recent-item__icon"><Layers3 size={18} /></span>
                <span className="recent-item__copy">
                  <strong>{instance.name}</strong>
                  <small>{instance.minecraftVersion} · {formatLoaderName(instance.loader)}</small>
                </span>
                <span className="recent-item__time"><Clock3 size={13} /> {formatRelativeDate(instance.lastPlayedAt)}</span>
                <span className="recent-item__play"><Play size={15} fill="currentColor" /></span>
              </button>
            )) : (
              <div className="home-empty-inline">
                <span><Boxes size={18} /></span>
                <div><strong>No instances yet</strong><small>Create one to start playing.</small></div>
                <button className="button button--soft" onClick={() => onRoute('library')}>Create instance</button>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel quick-panel">
        <div className="quick-grid quick-grid--three">
          <button onClick={() => onRoute('library')}><span><Boxes size={18} /></span><strong>New instance</strong><ArrowRight size={15} /></button>
          <button onClick={() => onRoute('discover')}><span><Search size={18} /></span><strong>Find content</strong><ArrowRight size={15} /></button>
          <button onClick={() => onRoute('servers')}><span><Server size={18} /></span><strong>Partnered servers</strong><small>Skylabs</small><ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  )
}
