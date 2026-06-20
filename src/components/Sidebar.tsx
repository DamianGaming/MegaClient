import {
  Home,
  Library,
  Search,
  Server,
  Settings,
  Shirt
} from 'lucide-react'
import comet from '../assets/comet.png'
import type { AccountSummary, RouteKey } from '../lib/types'

const routeGroups: Array<{
  label: string
  items: Array<{ key: RouteKey; label: string; icon: typeof Home }>
}> = [
  {
    label: 'Play',
    items: [
      { key: 'home', label: 'Home', icon: Home },
      { key: 'library', label: 'Library', icon: Library },
      { key: 'discover', label: 'Content', icon: Search },
      { key: 'servers', label: 'Partnered servers', icon: Server }
    ]
  },
  {
    label: 'Account',
    items: [
      { key: 'skins', label: 'Appearance', icon: Shirt },
      { key: 'settings', label: 'Settings', icon: Settings }
    ]
  }
]

export function Sidebar({
  route,
  onRoute,
  compact,
  account
}: {
  route: RouteKey
  onRoute: (route: RouteKey) => void
  compact: boolean
  account?: AccountSummary
}) {
  return (
    <aside className={`sidebar ${compact ? 'sidebar--compact' : ''}`}>
      <button className="sidebar__logo" onClick={() => onRoute('home')} aria-label="MegaClient home">
        <span className="sidebar__logo-halo" />
        <img src={comet} alt="MegaClient" draggable={false} />
        {!compact && <span>MegaClient</span>}
      </button>

      <nav className="sidebar__nav" aria-label="Main navigation">
        {routeGroups.map(group => (
          <div className="sidebar__group" key={group.label}>
            {!compact && <span className="sidebar__group-label">{group.label}</span>}
            {group.items.map(item => {
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  className={route === item.key ? 'is-active' : ''}
                  onClick={() => onRoute(item.key)}
                  title={compact ? item.label : undefined}
                >
                  <Icon size={18} strokeWidth={1.9} />
                  {!compact && <span>{item.label}</span>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="sidebar__spacer" />

      <button className="sidebar__account" onClick={() => onRoute('settings')} title="Account settings">
        <img src={account?.avatarUrl || comet} alt="" />
        {!compact && <span><strong>{account?.name || 'Account syncing…'}</strong><small>{account ? 'Signed in' : 'Checking session'}</small></span>}
      </button>
    </aside>
  )
}
