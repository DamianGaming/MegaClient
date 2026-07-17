import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Home,
  Clock3,
  Image,
  Info,
  Library,
  Layers3,
  Lock,
  LogOut,
  Minus,
  Monitor,
  Map,
  PackagePlus,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Copy,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
  Zap
} from 'lucide-react'
import Skin3DPreview from './Skin3DPreview'

type Tab = 'home' | 'instances' | 'browse' | 'manage' | 'servers' | 'cosmetics' | 'settings'
type Loader = 'vanilla' | 'forge' | 'neoforge' | 'fabric'
type ToastKind = 'error' | 'success' | 'warning'

interface BootStatus {
  value: number
  message: string
  detail?: string
}

const CLIENT_FALLBACK_VERSION = '0.11.11'
const LAUNCH_PHASES = ['security', 'client', 'prepare', 'download', 'loader', 'java', 'assets', 'natives', 'launch'] as const

function launchPhaseLabel(phase?: string): string {
  return ({
    security: 'Safety checks',
    client: 'MegaClient files',
    prepare: 'Game files',
    download: 'Downloading',
    loader: 'Mod loader',
    java: 'Java runtime',
    assets: 'Minecraft assets',
    natives: 'Native libraries',
    launch: 'Starting Minecraft'
  } as Record<string, string>)[phase ?? ''] ?? 'Preparing'
}

function launchPhaseProgress(phase?: string, value?: number): number {
  const index = Math.max(0, LAUNCH_PHASES.indexOf((phase ?? '') as typeof LAUNCH_PHASES[number]))
  const within = Math.max(0, Math.min(1, value ?? 0.18))
  return Math.min(1, (index + within) / LAUNCH_PHASES.length)
}

interface Instance {
  id: string
  name: string
  slug: string
  minecraftVersion: string
  loader: Loader
  loaderVersion?: string
  customClient: boolean
  createdAt: string
  updatedAt: string
  lastPlayedAt?: string
  modpack?: { title: string; projectId: string; versionId: string }
}

interface SettingsData {
  memoryMin: number
  memoryMax: number
  width: number
  height: number
  fullscreen: boolean
  showConsole: boolean
  minimizeToTrayOnLaunch: boolean
  showSnapshots: boolean
  javaMode: 'auto' | 'manual'
  javaPath: string
  checkUpdates: boolean
  reducedMotion: boolean
}

interface Account {
  name: string
  uuid: string
  avatarUrl: string
  xboxGamertag?: string
}

interface ModItem {
  projectId?: string
  versionId?: string
  title: string
  fileName: string
  enabled: boolean
  versionNumber?: string
  iconUrl?: string
  source?: 'modrinth' | 'local' | 'client'
}

interface SearchHit {
  project_id: string
  project_type: 'mod' | 'modpack' | 'resourcepack' | 'shader'
  title: string
  description: string
  author: string
  downloads: number
  icon_url?: string
  categories: string[]
  versions: string[]
}

interface PackItem {
  projectId?: string
  versionId?: string
  title: string
  fileName: string
  enabled: boolean
  versionNumber?: string
  iconUrl?: string
  contentType: 'resourcepack' | 'shader'
  source: 'modrinth' | 'local'
}

interface WorldItem {
  id: string
  name: string
  folderName: string
  modifiedAt: string
}

interface ProfileSkin {
  id: string
  url: string
  state: 'active' | 'inactive'
  variant: 'classic' | 'slim'
}

interface ProfileCape {
  id: string
  url: string
  state: 'active' | 'inactive'
  alias: string
}

interface ProfileData {
  skins: ProfileSkin[]
  capes: ProfileCape[]
  revision: number
}

interface PartnerServerStatus {
  online: boolean
  address: string
  host: string
  port: number
  latency?: number
  version?: string
  protocol?: number
  players?: { online: number; max: number; sample: string[] }
  motd?: string
  icon?: string
  checkedAt: string
  error?: string
}

const navItems: Array<{ id: Tab; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'instances', label: 'Instances', icon: Library },
  { id: 'browse', label: 'Discover', icon: Search },
  { id: 'manage', label: 'Manage', icon: Layers3 },
  { id: 'servers', label: 'Servers', icon: Server },
  { id: 'cosmetics', label: 'Skin & cape', icon: Palette },
  { id: 'settings', label: 'Settings', icon: Settings }
]

function formatBytes(value = 0): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function formatDownloads(value: number): string {
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function loaderLabel(loader: Loader): string {
  return ({ vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric' } as const)[loader]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function cacheBustedImage(url: string, revision: number): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' && parsed.hostname.toLowerCase() === 'textures.minecraft.net') parsed.protocol = 'https:'
    if (parsed.protocol !== 'https:') return ''
    parsed.searchParams.set('mc', String(revision))
    return parsed.toString()
  } catch {
    return ''
  }
}

function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [account, setAccount] = useState<Account | null>(null)
  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [version, setVersion] = useState('1.8.1')
  const [clientVersion, setClientVersion] = useState(CLIENT_FALLBACK_VERSION)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState<string>()
  const [bootStatus, setBootStatus] = useState<BootStatus>({ value: 12, message: 'Opening MegaClient', detail: 'Starting the secure launcher interface' })
  const [bootElapsed, setBootElapsed] = useState(0)
  const [toast, setToast] = useState<{ message: string; kind: ToastKind } | null>(null)
  const [launching, setLaunching] = useState(false)
  const [launchProgress, setLaunchProgress] = useState<{
    phase?: string
    message: string
    progress?: number
    downloaded?: number
    total?: number
    speed?: number
  }>({ message: '' })
  const [update, setUpdate] = useState<any>(null)
  const [authenticating, setAuthenticating] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const toastTimer = useRef<number | null>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const rendererReadySent = useRef(false)
  const bootStartedAt = useRef(Date.now())

  const selected = useMemo(
    () => instances.find((item) => item.id === selectedId) ?? instances[0],
    [instances, selectedId]
  )

  const notify = useCallback((message: string, kind: ToastKind = 'success') => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    setToast({ message, kind })
    toastTimer.current = window.setTimeout(() => {
      setToast(null)
      toastTimer.current = null
    }, kind === 'error' ? 5200 : 3600)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    if (!accountMenuOpen) return
    const close = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountMenuOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [accountMenuOpen])

  const bootstrap = useCallback(async (initial = false) => {
    if (initial) {
      bootStartedAt.current = Date.now()
      setBootElapsed(0)
      setBootError(undefined)
      setBooting(true)
      setBootStatus({ value: 30, message: 'Connecting launcher services', detail: 'Loading your settings and saved account' })
    }
    try {
      const data = await window.mega.app.bootstrap()
      setAccount(data.account)
      setInstances(data.instances)
      setSelectedId(data.selectedInstanceId ?? data.instances[0]?.id)
      setSettings(data.settings)
      setVersion(data.version)
      setClientVersion(data.clientVersion ?? CLIENT_FALLBACK_VERSION)
    } catch (error) {
      const message = errorMessage(error)
      if (initial) setBootError(message)
      else notify(message, 'error')
    } finally {
      if (initial) setBooting(false)
    }
  }, [notify])

  useEffect(() => {
    if (rendererReadySent.current) return
    rendererReadySent.current = true
    void window.mega.app.rendererReady()
  }, [])
  useEffect(() => window.mega.app.onBootStatus(setBootStatus), [])
  useEffect(() => { void bootstrap(true) }, [bootstrap])
  useEffect(() => {
    if (!booting) return
    const timer = window.setInterval(() => setBootElapsed(Math.floor((Date.now() - bootStartedAt.current) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [booting])
  useEffect(() => window.mega.launchEvents.onProgress((event) => {
    setLaunching(true)
    setLaunchProgress(event)
  }), [])
  useEffect(() => window.mega.launchEvents.onError((event) => {
    setLaunching(false)
    notify(event.message ?? 'Minecraft failed to launch.', 'error')
  }), [notify])
  useEffect(() => window.mega.launchEvents.onWarning((event) => {
    notify(event.message ?? 'Minecraft launched with a warning.', 'warning')
  }), [notify])
  useEffect(() => window.mega.launchEvents.onClosed(() => {
    setLaunching(false)
    setLaunchProgress({ message: '' })
    void bootstrap()
  }), [bootstrap])
  useEffect(() => window.mega.app.onUpdate(setUpdate), [])

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = settings?.reducedMotion ? 'true' : 'false'
  }, [settings?.reducedMotion])

  const selectInstance = async (id: string) => {
    setSelectedId(id)
    await window.mega.instances.select(id)
  }

  const login = async () => {
    if (authenticating) return
    setAuthenticating(true)
    try {
      setAccount(await window.mega.account.login())
      notify('Signed in successfully.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setAuthenticating(false)
    }
  }

  const signOut = async () => {
    setAccountMenuOpen(false)
    await window.mega.account.logout()
    setAccount(null)
    setTab('home')
  }

  const switchAccount = async () => {
    if (authenticating) return
    setAccountMenuOpen(false)
    setAuthenticating(true)
    try {
      await window.mega.account.logout()
      const next = await window.mega.account.login()
      setAccount(next)
      notify('Account switched.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setAuthenticating(false)
    }
  }

  const launch = async () => {
    if (!selected) return notify('Create an instance first.', 'error')
    if (!account) return notify('Sign in with Microsoft before launching.', 'error')
    setLaunching(true)
    setLaunchProgress({ message: 'Preparing to launch', progress: 0 })
    try {
      await window.mega.instances.launch(selected.id)
    } catch (error) {
      setLaunching(false)
      notify(errorMessage(error), 'error')
    }
  }

  if (booting || bootError) {
    return (
      <StartupView
        status={bootStatus}
        elapsed={bootElapsed}
        error={bootError}
        onRetry={() => void bootstrap(true)}
        onClose={() => void window.mega.app.quit()}
      />
    )
  }

  if (!account) {
    return (
      <>
        <LoginScreen version={version} loading={authenticating} onLogin={login} />
        {toast && <Toast toast={toast} />}
      </>
    )
  }

  return (
    <div className="app-shell">
      <Titlebar status={launching ? launchPhaseLabel(launchProgress.phase) : update?.state === 'downloading' ? 'Updating' : 'Ready'} />
      <aside className="sidebar">
        <button className="brand" onClick={() => { setAccountMenuOpen(false); setTab('home') }}>
          <img src="./logo.png" alt="MegaClient" />
          <span><strong>MegaClient</strong><small>MegaStudios</small></span>
        </button>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setAccountMenuOpen(false); setTab(item.id) }}>
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom" ref={accountMenuRef}>
          {accountMenuOpen && (
            <div className="account-menu">
              <button onClick={() => void switchAccount()} disabled={authenticating}><UserRound size={16} /><span>Switch account</span></button>
              <button className="danger" onClick={() => void signOut()}><LogOut size={16} /><span>Sign out</span></button>
            </div>
          )}
          <button className={`account-mini ${accountMenuOpen ? 'open' : ''}`} onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen}>
            <img src={account.avatarUrl} alt="" />
            <span><strong>{account.name}</strong><small>Microsoft account</small></span>
            <ChevronDown size={15} />
          </button>
          <div className="version-line">MegaClient v{version}</div>
        </div>
      </aside>

      <main className="content">
        {update?.state === 'ready' && (
          <div className="update-banner">
            <Download size={17} />
            <span>MegaClient {update.version} is ready.</span>
            <button onClick={() => window.mega.app.installUpdate()}>Restart and update</button>
          </div>
        )}
        {update?.state === 'downloading' && (
          <div className="update-banner quiet">
            <RefreshCw className="spin" size={16} />
            <span>Downloading launcher update · {Math.round(update.percent ?? 0)}%</span>
            <div className="banner-progress"><i style={{ width: `${Math.max(2, update.percent ?? 0)}%` }} /></div>
          </div>
        )}
        {launching && <ActivityBanner progress={launchProgress} onConsole={() => window.mega.instances.openConsole()} />}
        {tab === 'home' && (
          <HomeView
            selected={selected}
            launching={launching}
            progress={launchProgress}
            clientVersion={clientVersion}
            onLaunch={launch}
            onInstances={() => setTab('instances')}
            onBrowse={() => setTab('browse')}
            onManage={() => setTab('manage')}
            onServers={() => setTab('servers')}
            onConsole={() => window.mega.instances.openConsole()}
          />
        )}
        {tab === 'instances' && settings && (
          <InstancesView
            instances={instances}
            selectedId={selected?.id}
            settings={settings}
            onSelect={selectInstance}
            onChanged={bootstrap}
            notify={notify}
          />
        )}
        {tab === 'browse' && <BrowseView selected={selected} onChanged={bootstrap} notify={notify} />}
        {tab === 'manage' && <ManageView selected={selected} notify={notify} />}
        {tab === 'servers' && <ServersView selected={selected} launching={launching} notify={notify} />}
        {tab === 'cosmetics' && <CosmeticsView account={account} notify={notify} />}
        {tab === 'settings' && settings && (
          <SettingsView settings={settings} setSettings={setSettings} update={update} version={version} clientVersion={clientVersion} notify={notify} />
        )}
      </main>
      {toast && <Toast toast={toast} />}
    </div>
  )
}

function StartupView({ status, elapsed, error, onRetry, onClose }: {
  status: BootStatus
  elapsed: number
  error?: string
  onRetry: () => void
  onClose: () => void
}) {
  const value = Math.max(4, Math.min(100, Number(status.value) || 0))
  const steps = [
    { label: 'Launcher interface', threshold: 25 },
    { label: 'Settings and instances', threshold: 55 },
    { label: 'Microsoft account', threshold: 78 },
    { label: 'Instance library', threshold: 96 }
  ]

  return (
    <div className="startup-shell">
      <Titlebar status={error ? 'Needs attention' : 'Starting'} />
      <main className="startup-workspace">
        <section className={`startup-card ${error ? 'has-error' : ''}`}>
          <div className="startup-brand"><img src="./logo.png" alt="" /><div><strong>MegaClient</strong><span>MegaStudios</span></div></div>
          {error ? (
            <>
              <div className="startup-error-icon"><AlertTriangle /></div>
              <h1>MegaClient could not finish starting</h1>
              <p>{error}</p>
              <div className="startup-actions"><button className="secondary" onClick={onClose}>Close</button><button className="primary" onClick={onRetry}><RefreshCw /> Try again</button></div>
            </>
          ) : (
            <>
              <div className="startup-heading"><div><small>GETTING THINGS READY</small><h1>{status.message}</h1><p>{status.detail ?? 'MegaClient is preparing your launcher.'}</p></div><span>{Math.round(value)}%</span></div>
              <div className="startup-progress"><i style={{ width: `${value}%` }} /></div>
              <div className="startup-steps">
                {steps.map((step) => {
                  const done = value >= step.threshold
                  const active = !done && value >= step.threshold - 24
                  return <div key={step.label} className={done ? 'done' : active ? 'active' : ''}><span>{done ? <Check /> : active ? <RefreshCw className="spin" /> : <i />}</span><strong>{step.label}</strong></div>
                })}
              </div>
              <div className="startup-foot"><span><Clock3 /> {elapsed < 2 ? 'Starting now' : `${elapsed}s elapsed`}</span><small>{elapsed >= 12 ? 'Still working — Microsoft services can occasionally take a little longer.' : 'The launcher stays responsive while account and game data load.'}</small></div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function ActivityBanner({ progress, onConsole }: { progress: any; onConsole: () => void }) {
  const overall = launchPhaseProgress(progress.phase, progress.progress)
  const percent = Math.round(overall * 100)
  return (
    <div className="activity-banner" aria-live="polite">
      <div className="activity-icon"><RefreshCw className="spin" /></div>
      <div className="activity-copy"><strong>{progress.message || 'Preparing Minecraft'}</strong><small>{launchPhaseLabel(progress.phase)} · {percent}% complete</small></div>
      {progress.total ? <span className="activity-transfer">{formatBytes(progress.downloaded)} / {formatBytes(progress.total)}</span> : null}
      <button onClick={onConsole}><TerminalSquare /> Console</button>
      <div className="activity-progress"><i style={{ width: `${Math.max(3, percent)}%` }} /></div>
    </div>
  )
}

function Toast({ toast }: { toast: { message: string; kind: ToastKind } }) {
  const icon = toast.kind === 'success'
    ? <Check size={17} />
    : toast.kind === 'warning'
      ? <AlertTriangle size={17} />
      : <X size={17} />
  return <div className={`toast ${toast.kind}`}>{icon}<span>{toast.message}</span></div>
}

function ConfirmDialog({ title, message, confirmLabel = 'Delete', onCancel, onConfirm }: {
  title: string
  message: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop confirm-backdrop" onPointerDown={() => !busy && onCancel()}>
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onPointerDown={(event) => event.stopPropagation()}>
        <div className="confirm-icon"><Trash2 size={20} /></div>
        <div><h2 id="confirm-title">{title}</h2><p>{message}</p></div>
        <div className="confirm-actions"><button className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="danger-button" disabled={busy} onClick={() => void confirm()}>{busy ? <RefreshCw className="spin" /> : <Trash2 />}{busy ? 'Removing…' : confirmLabel}</button></div>
      </section>
    </div>
  )
}

export function SplashWindow() {
  const [progress, setProgress] = useState({ value: 8, message: 'Starting MegaClient' })

  useEffect(() => window.mega.app.onSplashProgress((event) => {
    setProgress({
      value: Math.max(0, Math.min(100, Number(event?.value ?? 0))),
      message: String(event?.message ?? 'Starting MegaClient')
    })
  }), [])

  return (
    <div className="splash compact-splash separate-splash">
      <section className="splash-surface">
        <div className="splash-mark"><img src="./logo.png" alt="" /></div>
        <div className="splash-copy"><strong>MegaClient</strong><span>{progress.message}</span></div>
        <span className="splash-percent">{Math.round(progress.value)}%</span>
        <div className="splash-progress" aria-label={`Loading ${Math.round(progress.value)}%`}><i style={{ width: `${progress.value}%` }} /></div>
      </section>
    </div>
  )
}

function LoginScreen({ version, loading, onLogin }: { version: string; loading: boolean; onLogin: () => void }) {
  return (
    <div className="login-shell refined-login">
      <Titlebar />
      <div className="login-ambient ambient-one" />
      <div className="login-ambient ambient-two" />
      <section className="login-card">
        <div className="login-brand">
          <div className="login-logo-wrap"><img src="./logo.png" alt="" /></div>
          <div><strong>MegaClient</strong><small>MegaStudios · v{version}</small></div>
        </div>
        <div className="login-copy">
          <span className="login-eyebrow">Minecraft, organised.</span>
          <h1>Everything you play,<br /><em>in one launcher.</em></h1>
          <p>Keep every instance, mod, pack and world together with a fast launcher built around Minecraft Java Edition.</p>
        </div>
        <div className="login-features">
          <span><Library size={15} /> Separate instances</span>
          <span><PackagePlus size={15} /> One-click content</span>
          <span><ShieldCheck size={15} /> Protected launches</span>
        </div>
        <button className="microsoft-login" onClick={onLogin} disabled={loading}>
          <span className="ms-symbol"><i /><i /><i /><i /></span>
          <span>{loading ? 'Opening Microsoft sign-in…' : 'Continue with Microsoft'}</span>
          {loading ? <RefreshCw className="spin" size={18} /> : <ChevronRight size={18} />}
        </button>
        <div className="login-details">
          <span>Official Microsoft sign-in</span>
        </div>
      </section>
      <aside className="login-art" aria-hidden="true">
        <div className="login-art-grid" />
        <div className="login-orbit orbit-a" />
        <div className="login-orbit orbit-b" />
        <img src="./logo.png" alt="" />
        <div className="login-art-label"><span>MEGACLIENT</span><strong>Ready when you are.</strong></div>
      </aside>
    </div>
  )
}

function Titlebar({ status }: { status?: string } = {}) {
  return (
    <header className="titlebar">
      <div className="titlebar-label"><img src="./logo.png" alt="" /><span>MegaClient</span></div>
      {status && <div className="titlebar-status"><i className={status === 'Ready' ? 'ready' : ''} /><span>{status}</span></div>}
      <div className="drag-region" />
      <div className="window-buttons">
        <button aria-label="Minimise" onClick={() => window.mega.window.minimize()}><Minus size={15} /></button>
        <button aria-label="Maximise" onClick={() => window.mega.window.maximize()}><Square size={12} /></button>
        <button aria-label="Close" className="close" onClick={() => window.mega.window.close()}><X size={15} /></button>
      </div>
    </header>
  )
}

function PageHeading({ eyebrow, title, description, actions }: {
  eyebrow?: string
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <div className="page-heading">
      <div>{eyebrow && <small>{eyebrow}</small>}<h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  )
}

function HomeView({ selected, launching, progress, clientVersion, onLaunch, onInstances, onBrowse, onManage, onServers, onConsole }: any) {
  return (
    <div className="page home-page">
      <section className="hero-card">
        <div className="hero-copy">
          <span className="pill"><Zap size={14} /> Fast, isolated and protected</span>
          <h1>Play Minecraft<br /><em>your way.</em></h1>
          <p>Launch Vanilla, modded Minecraft or the dedicated MegaClient 26.2 profile from one clean library.</p>
          <div className="hero-actions">
            <button className="primary large" onClick={onLaunch} disabled={launching || !selected}>
              {launching ? <RefreshCw className="spin" size={18} /> : <Play fill="currentColor" size={18} />}
              {launching ? 'Launching…' : 'Play'}
            </button>
            <button className="secondary large" onClick={onInstances}><Library size={18} /> Instances</button>
          </div>
        </div>
        <div className="hero-mark"><div className="orbit one" /><div className="orbit two" /><img src="./logo.png" alt="" /></div>
      </section>

      <div className="home-grid">
        <section className="panel selected-panel">
          <div className="panel-title"><span>Selected instance</span>{selected && <span className={`status-dot ${launching ? 'working' : ''}`}>{launching ? launchPhaseLabel(progress.phase) : 'Ready'}</span>}</div>
          {selected ? (
            <>
              <div className="instance-feature">
                <div className="instance-icon">{selected.customClient ? <img src="./logo.png" alt="" /> : <Gamepad2 />}</div>
                <div><h3>{selected.name}</h3><p>Minecraft {selected.minecraftVersion} · {loaderLabel(selected.loader)}{selected.customClient ? ` · Client ${clientVersion}` : ''}</p></div>
              </div>
              {launching ? (
                <div className="launch-status detailed">
                  <div className="launch-row"><span>{progress.message}</span><span>{Math.round(launchPhaseProgress(progress.phase, progress.progress) * 100)}%</span></div>
                  <div className="progress"><i style={{ width: `${Math.max(4, launchPhaseProgress(progress.phase, progress.progress) * 100)}%` }} /></div>
                  <div className="launch-detail"><span>{launchPhaseLabel(progress.phase)}</span>{progress.total ? <small>{formatBytes(progress.downloaded)} of {formatBytes(progress.total)} · {formatBytes((progress.speed ?? 0) * 1024)}/s</small> : <small>Working in the background</small>}</div>
                  <button className="launch-console-link" onClick={onConsole}><TerminalSquare /> Open live console</button>
                </div>
              ) : (
                <div className="instance-meta">
                  <span><HardDrive size={14} />{selected.loaderVersion ? `Loader ${selected.loaderVersion}` : 'No loader required'}</span>
                  <button onClick={onConsole}><TerminalSquare size={15} /> Console</button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-compact"><Library /><h3>No instances yet</h3><p>Create your first Minecraft setup to begin.</p></div>
          )}
        </section>

        <section className="panel quick-panel home-shortcuts">
          <div className="panel-title"><span>Quick access</span></div>
          <div className="shortcut-list">
            <button onClick={onBrowse}><Search /><span><strong>Discover content</strong><small>Find mods, packs and shaders</small></span><ChevronRight /></button>
            <button onClick={onManage}><Layers3 /><span><strong>Manage content</strong><small>Mods, packs, shaders and worlds</small></span><ChevronRight /></button>
            <button onClick={onServers}><Server /><span><strong>Partner servers</strong><small>Join SkyLabs directly</small></span><ChevronRight /></button>
          </div>
        </section>

      </div>
    </div>
  )
}

function InstancesView({ instances, selectedId, settings, onSelect, onChanged, notify }: any) {
  const [showCreate, setShowCreate] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Instance>()
  const remove = async (instance: Instance) => {
    try {
      await window.mega.instances.delete(instance.id)
      setPendingDelete(undefined)
      await onChanged()
      notify('Instance deleted.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <div className="page">
      <PageHeading
        eyebrow="Library"
        title="Instances"
        description="Separate Minecraft setups with their own content and saves."
        actions={<button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> New instance</button>}
      />
      <div className="instance-grid">
        {instances.map((instance: Instance) => (
          <article key={instance.id} className={`instance-card ${selectedId === instance.id ? 'selected' : ''}`} onClick={() => onSelect(instance.id)}>
            <div className="instance-card-top">
              <div className="instance-icon big">{instance.customClient ? <img src="./logo.png" alt="" /> : <Gamepad2 size={25} />}</div>
              <div className="instance-actions">
                <button title="Open folder" onClick={(event) => { event.stopPropagation(); void window.mega.instances.openFolder(instance.id) }}><FolderOpen size={16} /></button>
                <button title="Delete" className="danger-icon" onClick={(event) => { event.stopPropagation(); setPendingDelete(instance) }}><Trash2 size={16} /></button>
              </div>
            </div>
            <h3>{instance.name}</h3>
            <p>Minecraft {instance.minecraftVersion}</p>
            <div className="badges"><span>{loaderLabel(instance.loader)}</span>{instance.customClient && <span className="gradient-badge">MegaClient</span>}</div>
            <div className="card-footer">
              <small>{instance.lastPlayedAt ? `Played ${new Date(instance.lastPlayedAt).toLocaleDateString('en-GB')}` : 'Not played yet'}</small>
              {selectedId === instance.id && <span><Check size={13} /> Selected</span>}
            </div>
          </article>
        ))}
      </div>
      {!instances.length && (
        <div className="empty-state">
          <Library size={34} /><h2>Your instance library is empty</h2>
          <p>Create a normal Minecraft instance or start with the dedicated MegaClient 26.2 profile.</p>
          <button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> Create instance</button>
        </div>
      )}
      {showCreate && (
        <CreateInstanceModal
          settings={settings}
          onClose={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await onChanged(); notify('Instance created.', 'success') }}
          notify={notify}
        />
      )}
      {pendingDelete && <ConfirmDialog title={`Delete ${pendingDelete.name}?`} message="This removes the instance, its mods and local game files." onCancel={() => setPendingDelete(undefined)} onConfirm={() => remove(pendingDelete)} />}
    </div>
  )
}

interface SelectMenuOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

function SelectMenu({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select an option',
  ariaLabel,
  emptyLabel = 'No compatible options found'
}: {
  value: string
  options: SelectMenuOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel: string
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const searchable = options.length > 12
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(term))
  }, [options, query])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const selectedIndex = Math.max(0, filtered.findIndex((option) => option.value === value))
    setActiveIndex(selectedIndex)
    if (searchable) window.setTimeout(() => search.current?.focus(), 0)
  }, [open, value, searchable])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  const choose = (option: SelectMenuOption) => {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
  }

  const move = (direction: 1 | -1) => {
    if (!filtered.length) return
    let next = activeIndex
    for (let checked = 0; checked < filtered.length; checked++) {
      next = (next + direction + filtered.length) % filtered.length
      if (!filtered[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      else move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.currentTarget === event.target) {
      event.preventDefault()
      if (!open) setOpen(true)
      else if (filtered[activeIndex]) choose(filtered[activeIndex])
    }
  }

  return (
    <div className={`select-menu ${open ? 'open' : ''} ${disabled ? 'disabled' : ''}`} ref={root} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? '' : 'placeholder'}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="select-popover">
          {searchable && (
            <div className="select-search">
              <Search size={14} aria-hidden="true" />
              <input
                ref={search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    move(event.key === 'ArrowDown' ? 1 : -1)
                  } else if (event.key === 'Enter' && filtered[activeIndex]) {
                    event.preventDefault()
                    choose(filtered[activeIndex])
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setOpen(false)
                  }
                }}
                placeholder="Search versions…"
                aria-label={`Search ${ariaLabel.toLowerCase()}`}
              />
            </div>
          )}
          <div className="select-options" role="listbox" aria-label={ariaLabel}>
            {filtered.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`select-option ${index === activeIndex ? 'active' : ''}`}
                key={option.value}
                disabled={option.disabled}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                {option.value === value && <Check size={15} aria-hidden="true" />}
              </button>
            ))}
            {!filtered.length && <div className="select-empty"><Info size={15} /><span>{emptyLabel}</span></div>}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateInstanceModal({ settings, onClose, onCreated, notify }: any) {
  const [custom, setCustom] = useState(false)
  const [name, setName] = useState('New instance')
  const [loader, setLoader] = useState<Loader>('vanilla')
  const [versions, setVersions] = useState<Array<{ id: string; type: string }>>([])
  const [mcVersion, setMcVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<string[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(true)
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [loaderError, setLoaderError] = useState('')

  const loadMinecraftVersions = useCallback(async () => {
    setLoadingVersions(true)
    setVersionsError('')
    try {
      const items = await window.mega.app.getVersions(settings.showSnapshots)
      setVersions(items)
      setMcVersion((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? ''))
      if (!items.length) setVersionsError('No Minecraft versions were returned. Check your connection and try again.')
    } catch (error) {
      setVersions([])
      setMcVersion('')
      setVersionsError(errorMessage(error))
    } finally {
      setLoadingVersions(false)
    }
  }, [settings.showSnapshots])

  useEffect(() => { void loadMinecraftVersions() }, [loadMinecraftVersions])

  useEffect(() => {
    if (custom) {
      setName('MegaClient 26.2')
      setLoader('fabric')
      setMcVersion('26.2')
    } else if (name === 'MegaClient 26.2') {
      setName('New instance')
      setLoader('vanilla')
      setMcVersion(versions[0]?.id ?? '')
    }
  }, [custom, versions])

  useEffect(() => {
    if (loader === 'vanilla' || !mcVersion) {
      setLoaderVersions([])
      setLoaderVersion('')
      setLoaderError('')
      setLoadingLoaderVersions(false)
      return
    }
    let active = true
    setLoaderVersions([])
    setLoaderVersion('')
    setLoaderError('')
    setLoadingLoaderVersions(true)
    void window.mega.app.getLoaderVersions(loader, mcVersion).then((items) => {
      if (!active) return
      setLoaderVersions(items)
      setLoaderVersion(items[0] ?? '')
      if (!items.length) setLoaderError(`${loaderLabel(loader)} does not provide a build for Minecraft ${mcVersion}.`)
    }).catch((error) => {
      if (!active) return
      setLoaderVersions([])
      setLoaderError(errorMessage(error))
    }).finally(() => {
      if (active) setLoadingLoaderVersions(false)
    })
    return () => { active = false }
  }, [loader, mcVersion])

  const create = async () => {
    if (!name.trim()) return notify('Give the instance a name.', 'error')
    if (!mcVersion) return notify('Select a Minecraft version first.', 'error')
    if (loader !== 'vanilla' && !loaderVersion) return notify(loaderError || `${loaderLabel(loader)} does not support this Minecraft version.`, 'error')
    setBusy(true)
    try {
      await window.mega.instances.create({ name: name.trim(), minecraftVersion: mcVersion, loader, loaderVersion, customClient: custom })
      await onCreated()
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const minecraftOptions = useMemo<SelectMenuOption[]>(() => versions.map((item) => ({
    value: item.id,
    label: item.id,
    description: item.type === 'release' ? 'Release' : item.type.replaceAll('_', ' ')
  })), [versions])
  const loaderOptions = useMemo<SelectMenuOption[]>(() => [
    { value: 'vanilla', label: 'Vanilla', description: 'Official Minecraft with no mod loader' },
    { value: 'fabric', label: 'Fabric', description: 'Lightweight and fast mod loader' },
    { value: 'forge', label: 'Forge', description: 'Large established mod ecosystem' },
    { value: 'neoforge', label: 'NeoForge', description: 'Modern Forge-based mod loader' }
  ], [])
  const loaderVersionOptions = useMemo<SelectMenuOption[]>(() => loaderVersions.map((item, index) => ({
    value: item,
    label: item,
    description: index === 0 ? 'Recommended latest compatible build' : undefined
  })), [loaderVersions])
  const createDisabled = busy || (!custom && (loadingVersions || !mcVersion)) || (loader !== 'vanilla' && (loadingLoaderVersions || !loaderVersion))

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal create-instance-modal" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="create-instance-title">
        <div className="modal-header">
          <div><small>NEW INSTANCE</small><h2 id="create-instance-title">Create an instance</h2></div>
          <button type="button" aria-label="Close create instance" onClick={onClose}><X /></button>
        </div>
        <div className="choice-row" aria-label="Instance type">
          <button type="button" className={!custom ? 'chosen' : ''} onClick={() => setCustom(false)}><Gamepad2 /><span><strong>Standard</strong><small>Vanilla or a mod loader</small></span></button>
          <button type="button" className={custom ? 'chosen client-choice' : ''} onClick={() => setCustom(true)}><img src="./logo.png" alt="" /><span><strong>MegaClient</strong><small>Fabric · Minecraft 26.2</small></span></button>
        </div>
        <label className="field-label">Instance name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} autoFocus /></label>
        {!custom && (
          <>
            <div className="form-grid">
              <label className="field-label">Minecraft version
                <SelectMenu
                  value={mcVersion}
                  options={minecraftOptions}
                  onChange={setMcVersion}
                  disabled={loadingVersions || !minecraftOptions.length}
                  placeholder={loadingVersions ? 'Loading versions…' : 'Select a version'}
                  ariaLabel="Minecraft version"
                  emptyLabel="No Minecraft versions match your search"
                />
              </label>
              <label className="field-label">Loader
                <SelectMenu value={loader} options={loaderOptions} onChange={(value) => setLoader(value as Loader)} ariaLabel="Mod loader" />
              </label>
            </div>
            {versionsError && (
              <div className="field-message error"><AlertTriangle size={15} /><span>{versionsError}</span><button type="button" onClick={() => void loadMinecraftVersions()}>Retry</button></div>
            )}
            {loader !== 'vanilla' && (
              <label className="field-label">Loader version
                <SelectMenu
                  value={loaderVersion}
                  options={loaderVersionOptions}
                  onChange={setLoaderVersion}
                  disabled={loadingLoaderVersions || !loaderVersionOptions.length}
                  placeholder={loadingLoaderVersions ? 'Checking compatibility…' : 'Select a compatible build'}
                  ariaLabel={`${loaderLabel(loader)} version`}
                />
              </label>
            )}
            {loaderError && <div className="field-message error"><AlertTriangle size={15} /><span>{loaderError}</span></div>}
          </>
        )}
        {custom && (
          <div className="client-note">
            <img src="./logo.png" alt="" />
            <div><strong>MegaClient 0.11.11</strong><p>Minecraft 26.2 and everything it needs are prepared automatically.</p></div>
            <span className="locked-chip"><Lock size={12} /> Protected</span>
          </div>
        )}
        {custom && loadingLoaderVersions && <div className="field-message"><RefreshCw className="spin" size={15} /><span>Checking the required Fabric Loader build…</span></div>}
        {custom && loaderError && <div className="field-message error"><AlertTriangle size={15} /><span>{loaderError}</span></div>}
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={create} disabled={createDisabled}>{busy ? <RefreshCw className="spin" /> : <Plus />}{busy ? 'Creating…' : 'Create instance'}</button>
        </div>
      </div>
    </div>
  )
}
function BrowseView({ selected, onChanged, notify }: { selected?: Instance; onChanged: () => Promise<void>; notify: (message: string, kind?: ToastKind) => void }) {
  const [type, setType] = useState<'mod' | 'modpack' | 'resourcepack' | 'shader'>('mod')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string>()
  const [progress, setProgress] = useState<any>(null)
  const [page, setPage] = useState(1)
  const [totalHits, setTotalHits] = useState(0)
  const requestId = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const pageSize = 30
  const pageCount = Math.max(1, Math.ceil(totalHits / pageSize))

  useEffect(() => window.mega.mods.onProgress(setProgress), [])
  useEffect(() => setPage(1), [selected?.id])

  useEffect(() => {
    const current = ++requestId.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      void window.mega.mods.search({ query: deferredQuery, type, instanceId: selected?.id, offset: (page - 1) * pageSize })
        .then((data) => {
          if (current !== requestId.current) return
          setResults(data.hits)
          setTotalHits(Number(data.total_hits ?? data.hits.length))
        })
        .catch((error) => { if (current === requestId.current) notify(errorMessage(error), 'error') })
        .finally(() => { if (current === requestId.current) setLoading(false) })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [deferredQuery, type, selected?.id, page, notify])

  const changePage = (next: number) => {
    const safe = Math.max(1, Math.min(pageCount, next))
    if (safe === page) return
    setPage(safe)
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const install = async (hit: SearchHit) => {
    if (!selected) return notify('Create and select an instance first.', 'error')
    setInstalling(hit.project_id)
    try {
      if (type === 'mod') await window.mega.mods.install(selected.id, hit.project_id)
      else if (type === 'modpack') await window.mega.mods.installModpack(selected.id, hit.project_id)
      else await window.mega.packs.install(selected.id, hit.project_id, type)
      notify(`${hit.title} installed.`, 'success')
      await onChanged()
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setInstalling(undefined)
      setProgress(null)
    }
  }

  const labels = { mod: 'mods', modpack: 'modpacks', resourcepack: 'resource packs', shader: 'shaders' } as const
  const fallbackIcon = type === 'mod' ? <Box /> : type === 'modpack' ? <PackagePlus /> : type === 'resourcepack' ? <Image /> : <Sparkles />

  return (
    <div className="page discover-page">
      <PageHeading
        eyebrow="Discover"
        title="Find new content"
        description={selected ? `${selected.name} · Minecraft ${selected.minecraftVersion}` : 'Select an instance before installing.'}
      />
      <div className="browse-toolbar stacked-toolbar" ref={listRef}>
        <div className="segmented discover-types">
          <button className={type === 'mod' ? 'active' : ''} onClick={() => { setType('mod'); setPage(1) }}><Box size={16} /> Mods</button>
          <button className={type === 'modpack' ? 'active' : ''} onClick={() => { setType('modpack'); setPage(1) }}><PackagePlus size={16} /> Modpacks</button>
          <button className={type === 'resourcepack' ? 'active' : ''} onClick={() => { setType('resourcepack'); setPage(1) }}><Image size={16} /> Resource packs</button>
          <button className={type === 'shader' ? 'active' : ''} onClick={() => { setType('shader'); setPage(1) }}><Sparkles size={16} /> Shaders</button>
        </div>
        <div className="search-box"><Search size={17} /><input placeholder={`Search ${labels[type]}…`} value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} />{loading && <RefreshCw className="spin" size={16} />}</div>
      </div>
      {installing && progress && <ProgressStrip progress={progress} />}
      {loading && !results.length && <LoadingRows count={5} />}
      <div className={`content-list ${loading && results.length ? 'is-loading' : ''}`} aria-busy={loading}>
        {results.map((hit) => (
          <article key={hit.project_id} className="content-card">
            <div className="content-icon">{hit.icon_url ? <img src={hit.icon_url} alt="" loading="lazy" decoding="async" /> : fallbackIcon}</div>
            <div className="content-copy"><h3>{hit.title}<span>by {hit.author}</span></h3><p>{hit.description}</p><div className="content-meta"><span><Download size={13} />{formatDownloads(hit.downloads)}</span>{hit.categories.slice(0, 2).map((category) => <span key={category}>{category}</span>)}</div></div>
            <button className="secondary install-button" disabled={!selected || Boolean(installing)} onClick={() => install(hit)}>{installing === hit.project_id ? <RefreshCw className="spin" /> : <Download />} {installing === hit.project_id ? 'Installing…' : 'Install'}</button>
          </article>
        ))}
      </div>
      {!loading && !results.length && <div className="empty-state small"><Search /><h2>No matching content</h2><p>Try a different search or instance.</p></div>}
      {totalHits > pageSize && <Pagination page={page} pageCount={pageCount} onChange={changePage} />}
    </div>
  )
}

function LoadingRows({ count = 4, compact = false }: { count?: number; compact?: boolean }) {
  return (
    <div className={`loading-rows ${compact ? 'compact' : ''}`} aria-label="Loading content" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="loading-row" key={index}><i /><span><b /><small /></span><em /></div>
      ))}
    </div>
  )
}

function Pagination({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (page: number) => void }) {
  const pages = useMemo(() => {
    const values = new Set<number>([1, pageCount, page - 1, page, page + 1])
    return [...values].filter((value) => value >= 1 && value <= pageCount).sort((a, b) => a - b)
  }, [page, pageCount])
  return (
    <nav className="pagination" aria-label="Discover pages">
      <button disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={16} /> Previous</button>
      <div>
        {pages.map((value, index) => (
          <span key={value}>
            {index > 0 && pages[index - 1] !== value - 1 && <i>…</i>}
            <button className={value === page ? 'active' : ''} aria-current={value === page ? 'page' : undefined} onClick={() => onChange(value)}>{value}</button>
          </span>
        ))}
      </div>
      <button disabled={page === pageCount} onClick={() => onChange(page + 1)}>Next <ChevronRight size={16} /></button>
    </nav>
  )
}

function ProgressStrip({ progress }: { progress: any }) {
  const determinate = Number.isFinite(progress?.progress)
  const percent = determinate ? Math.max(0, Math.min(100, Math.round(progress.progress * 100))) : 0
  return (
    <div className="install-strip" aria-live="polite">
      <RefreshCw className="spin" />
      <div><strong>{progress.message}</strong><small>{determinate ? `${percent}%` : 'Working…'}</small><div className={`progress ${determinate ? '' : 'indeterminate'}`}><i style={determinate ? { width: `${Math.max(3, percent)}%` } : undefined} /></div></div>
    </div>
  )
}

type ManageSection = 'mods' | 'resourcepacks' | 'shaders' | 'worlds'

function ManageView({ selected, notify }: { selected?: Instance; notify: (message: string, kind?: ToastKind) => void }) {
  const [section, setSection] = useState<ManageSection>('mods')
  return (
    <div className="page manage-page">
      <PageHeading
        eyebrow={selected?.name ?? 'No instance selected'}
        title="Manage"
        description="Everything installed for the selected instance, kept in one place."
      />
      <div className="segmented manage-tabs" role="tablist" aria-label="Content management">
        <button className={section === 'mods' ? 'active' : ''} onClick={() => setSection('mods')}><Box size={16} /> Mods</button>
        <button className={section === 'resourcepacks' ? 'active' : ''} onClick={() => setSection('resourcepacks')}><Image size={16} /> Resource packs</button>
        <button className={section === 'shaders' ? 'active' : ''} onClick={() => setSection('shaders')}><Sparkles size={16} /> Shaders</button>
        <button className={section === 'worlds' ? 'active' : ''} onClick={() => setSection('worlds')}><Map size={16} /> Worlds</button>
      </div>
      <div className="manage-surface">
        {section === 'mods' && <ModsManager selected={selected} notify={notify} />}
        {section === 'resourcepacks' && <PacksManager selected={selected} type="resourcepack" notify={notify} />}
        {section === 'shaders' && <PacksManager selected={selected} type="shader" notify={notify} />}
        {section === 'worlds' && <WorldsManager selected={selected} notify={notify} />}
      </div>
    </div>
  )
}

function ManagerHeading({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="manager-heading">
      <div><h2>{title}</h2><p>{description}</p></div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  )
}

function ModsManager({ selected, notify }: { selected?: Instance; notify: (message: string, kind?: ToastKind) => void }) {
  const [mods, setMods] = useState<ModItem[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<any>(null)
  const [pendingRemove, setPendingRemove] = useState<ModItem>()

  const load = useCallback(async () => {
    if (!selected) return setMods([])
    setLoading(true)
    try { setMods(await window.mega.mods.list(selected.id)) }
    catch (error) { notify(errorMessage(error), 'error') }
    finally { setLoading(false) }
  }, [selected?.id, notify])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.mega.mods.onProgress(setProgress), [])

  const addLocal = async () => {
    if (!selected) return
    try {
      const count = await window.mega.instances.addLocalMod(selected.id)
      if (count) { await load(); notify(`${count} mod${count === 1 ? '' : 's'} added.`, 'success') }
    } catch (error) { notify(errorMessage(error), 'error') }
  }

  const toggle = async (mod: ModItem) => {
    if (!selected) return
    const previous = mods
    setMods((items) => items.map((item) => item.fileName === mod.fileName ? { ...item, enabled: !item.enabled } : item))
    try { await window.mega.mods.setEnabled(selected.id, mod.fileName, !mod.enabled) }
    catch (error) { setMods(previous); notify(errorMessage(error), 'error') }
  }

  const remove = async (mod: ModItem) => {
    if (!selected) return
    const previous = mods
    setMods((items) => items.filter((item) => item.fileName !== mod.fileName))
    try {
      await window.mega.mods.remove(selected.id, mod.fileName)
      setPendingRemove(undefined)
      notify('Mod removed.', 'success')
    } catch (error) {
      setMods(previous)
      notify(errorMessage(error), 'error')
    }
  }

  const updateOne = async (mod: ModItem) => {
    if (!selected || !mod.projectId) return
    setProgress({ message: `Checking ${mod.title}` })
    try {
      const result = await window.mega.mods.update(selected.id, mod.projectId)
      await load()
      notify(result ? `${mod.title} updated.` : `${mod.title} is already current.`, 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
    finally { setProgress(null) }
  }

  const updateAll = async () => {
    if (!selected) return
    setProgress({ message: 'Checking installed mods' })
    try {
      const count = await window.mega.mods.updateAll(selected.id)
      await load()
      notify(count ? `Updated ${count} mod${count === 1 ? '' : 's'}.` : 'All Modrinth mods are current.', 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
    finally { setProgress(null) }
  }

  return (
    <section className="manager-section">
      <ManagerHeading
        title="Mods"
        description="Enable, disable, update or remove mods for this instance."
        actions={<><button className="secondary" disabled={!selected} onClick={addLocal}><Upload size={16} /> Add JAR</button><button className="primary" disabled={!selected} onClick={updateAll}><RefreshCw size={16} /> Update all</button></>}
      />
      {progress && <ProgressStrip progress={progress} />}
      {selected?.loader === 'vanilla' && <div className="notice compact-notice"><Info /><div><strong>Vanilla does not load mods</strong><p>Use Fabric, Forge or NeoForge for mod JARs.</p></div></div>}
      <div className="mods-table">
        <div className="mods-head"><span>Mod</span><span>Version</span><span>Source</span><span>Status</span><span /></div>
        {loading && !mods.length && <LoadingRows count={4} compact />}
        {mods.map((mod) => (
          <div className={`mod-row ${!mod.enabled ? 'disabled' : ''}`} key={mod.fileName}>
            <div className="mod-name"><div>{mod.iconUrl ? <img src={mod.iconUrl} alt="" loading="lazy" /> : <Box />}</div><span><strong>{mod.title}</strong><small>{mod.fileName}</small></span></div>
            <span>{mod.versionNumber ?? 'Local file'}</span>
            <span className="source-tag">{mod.source === 'modrinth' ? 'Modrinth' : 'Local'}</span>
            <button className={`toggle ${mod.enabled ? 'on' : ''}`} aria-label={mod.enabled ? `Disable ${mod.title}` : `Enable ${mod.title}`} onClick={() => toggle(mod)}><i /></button>
            <div className="row-actions">{mod.projectId && <button title="Check for update" onClick={() => updateOne(mod)}><RefreshCw /></button>}<button title="Remove" onClick={() => setPendingRemove(mod)}><Trash2 /></button></div>
          </div>
        ))}
      </div>
      {!loading && !mods.length && <div className="empty-state"><Box /><h2>No mods installed</h2><p>Install compatible mods from Discover or add a local JAR.</p></div>}
      {pendingRemove && <ConfirmDialog title={`Remove ${pendingRemove.title}?`} message="The mod file will be removed from this instance." confirmLabel="Remove" onCancel={() => setPendingRemove(undefined)} onConfirm={() => remove(pendingRemove)} />}
    </section>
  )
}

function PacksManager({ selected, type, notify }: { selected?: Instance; type: 'resourcepack' | 'shader'; notify: (message: string, kind?: ToastKind) => void }) {
  const [packs, setPacks] = useState<PackItem[]>([])
  const [loading, setLoading] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<PackItem>()

  const load = useCallback(async () => {
    if (!selected) return setPacks([])
    setLoading(true)
    try { setPacks(await window.mega.packs.list(selected.id, type)) }
    catch (error) { notify(errorMessage(error), 'error') }
    finally { setLoading(false) }
  }, [selected?.id, type, notify])

  useEffect(() => { void load() }, [load])

  const toggle = async (pack: PackItem) => {
    if (!selected) return
    const previous = packs
    setPacks((items) => items.map((item) => item.fileName === pack.fileName ? { ...item, enabled: !item.enabled } : item))
    try { await window.mega.packs.setEnabled(selected.id, pack.fileName, pack.contentType, !pack.enabled) }
    catch (error) { setPacks(previous); notify(errorMessage(error), 'error') }
  }

  const remove = async (pack: PackItem) => {
    if (!selected) return
    const previous = packs
    setPacks((items) => items.filter((item) => item.fileName !== pack.fileName))
    try {
      await window.mega.packs.remove(selected.id, pack.fileName, pack.contentType)
      setPendingRemove(undefined)
      notify('Pack removed.', 'success')
    } catch (error) {
      setPacks(previous)
      notify(errorMessage(error), 'error')
    }
  }

  const label = type === 'resourcepack' ? 'Resource packs' : 'Shaders'
  return (
    <section className="manager-section">
      <ManagerHeading
        title={label}
        description={`Manage ${label.toLowerCase()} installed for this instance.`}
        actions={<button className="secondary" disabled={!selected} onClick={() => selected && window.mega.packs.openFolder(selected.id, type)}><FolderOpen size={16} /> Open folder</button>}
      />
      {loading && !packs.length && <LoadingRows count={4} compact />}
      <div className="pack-grid">
        {packs.map((pack) => (
          <article className={`pack-card ${pack.enabled ? '' : 'disabled'}`} key={`${pack.contentType}:${pack.fileName}`}>
            <div className="pack-icon">{pack.iconUrl ? <img src={pack.iconUrl} alt="" loading="lazy" /> : type === 'resourcepack' ? <Image /> : <Sparkles />}</div>
            <div className="pack-copy"><h3>{pack.title}</h3><p>{pack.versionNumber ?? 'Local file'}</p></div>
            <button className={`toggle ${pack.enabled ? 'on' : ''}`} aria-label={pack.enabled ? 'Disable' : 'Enable'} onClick={() => toggle(pack)}><i /></button>
            <button className="icon-button danger-icon" title="Remove" onClick={() => setPendingRemove(pack)}><Trash2 size={16} /></button>
          </article>
        ))}
      </div>
      {!loading && !packs.length && <div className="empty-state"><Layers3 /><h2>No {label.toLowerCase()} installed</h2><p>Install compatible content from Discover.</p></div>}
      {pendingRemove && <ConfirmDialog title={`Remove ${pendingRemove.title}?`} message={`The ${type === 'resourcepack' ? 'resource pack' : 'shader'} file will be removed from this instance.`} confirmLabel="Remove" onCancel={() => setPendingRemove(undefined)} onConfirm={() => remove(pendingRemove)} />}
    </section>
  )
}

function WorldsManager({ selected, notify }: { selected?: Instance; notify: (message: string, kind?: ToastKind) => void }) {
  const [worlds, setWorlds] = useState<WorldItem[]>([])
  const [loading, setLoading] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [progress, setProgress] = useState<any>(null)
  const [pendingDelete, setPendingDelete] = useState<WorldItem>()

  const load = useCallback(async () => {
    if (!selected) return setWorlds([])
    setLoading(true)
    try { setWorlds(await window.mega.worlds.list(selected.id)) }
    catch (error) { notify(errorMessage(error), 'error') }
    finally { setLoading(false) }
  }, [selected?.id, notify])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.mega.mods.onProgress(setProgress), [])

  const importWorld = async () => {
    if (!selected) return notify('Select an instance first.', 'error')
    try {
      const result = await window.mega.worlds.importZip(selected.id)
      if (result) { await load(); notify('World imported.', 'success') }
    } catch (error) { notify(errorMessage(error), 'error') }
  }

  const downloadWorld = async (url: string) => {
    if (!selected) return
    setProgress({ message: 'Starting world download', progress: 0 })
    try {
      await window.mega.worlds.download(selected.id, url)
      await load()
      setDownloadOpen(false)
      notify('World installed.', 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
    finally { setProgress(null) }
  }

  const remove = async (world: WorldItem) => {
    if (!selected) return
    const previous = worlds
    setWorlds((items) => items.filter((item) => item.id !== world.id))
    try {
      await window.mega.worlds.delete(selected.id, world.id)
      setPendingDelete(undefined)
      notify('World deleted.', 'success')
    } catch (error) {
      setWorlds(previous)
      notify(errorMessage(error), 'error')
    }
  }

  return (
    <section className="manager-section">
      <ManagerHeading
        title="Worlds"
        description="Import, download and manage worlds for this instance."
        actions={<><button className="secondary" disabled={!selected} onClick={() => selected && window.mega.worlds.openFolder(selected.id)}><FolderOpen size={16} /> Saves folder</button><button className="secondary" disabled={!selected} onClick={importWorld}><Upload size={16} /> Import ZIP</button><button className="primary" disabled={!selected} onClick={() => setDownloadOpen(true)}><Download size={16} /> Download world</button></>}
      />
      {progress && <ProgressStrip progress={progress} />}
      {loading && !worlds.length && <LoadingRows count={3} compact />}
      <div className="world-grid">
        {worlds.map((world) => (
          <article className="world-card" key={world.id}>
            <div className="world-icon"><Map /></div>
            <div><h3>{world.name}</h3><p>Updated {new Date(world.modifiedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
            <div className="row-actions"><button title="Open folder" onClick={() => selected && window.mega.worlds.openFolder(selected.id, world.id)}><FolderOpen /></button><button title="Delete" onClick={() => setPendingDelete(world)}><Trash2 /></button></div>
          </article>
        ))}
      </div>
      {!loading && !worlds.length && <div className="empty-state"><Map /><h2>No worlds found</h2><p>Import a ZIP, paste a direct download link or create a world in-game.</p></div>}
      {downloadOpen && <WorldDownloadModal onClose={() => setDownloadOpen(false)} onDownload={downloadWorld} />}
      {pendingDelete && <ConfirmDialog title={`Delete ${pendingDelete.name}?`} message="This permanently removes the world from this instance." onCancel={() => setPendingDelete(undefined)} onConfirm={() => remove(pendingDelete)} />}
    </section>
  )
}

function WorldDownloadModal({ onClose, onDownload }: { onClose: () => void; onDownload: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    try { await onDownload(url.trim()) } finally { setBusy(false) }
  }
  return (
    <div className="modal-backdrop nested-modal" onPointerDown={onClose}>
      <div className="modal world-download-modal" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="world-download-title">
        <div className="modal-header"><div><small>WORLD DOWNLOAD</small><h2 id="world-download-title">Install from a link</h2></div><button aria-label="Close" onClick={onClose}><X /></button></div>
        <p className="modal-description">Paste a direct HTTPS link to a Minecraft world ZIP.</p>
        <label className="field-label">World ZIP link<input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} placeholder="https://example.com/world.zip" /></label>
        <div className="modal-footer"><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!url.trim() || busy} onClick={() => void submit()}>{busy ? <RefreshCw className="spin" /> : <Download />}{busy ? 'Installing…' : 'Install world'}</button></div>
      </div>
    </div>
  )
}

const partnerServers = [
  { id: 'skylabs', name: 'SkyLabs', address: 'play.sky-labs.co.uk' }
] as const

function ServersView({ selected, launching, notify }: { selected?: Instance; launching: boolean; notify: (message: string, kind?: ToastKind) => void }) {
  const [statuses, setStatuses] = useState<Record<string, PartnerServerStatus | undefined>>({})
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true)
    try {
      const entries = await Promise.all(partnerServers.map(async (server) => [server.id, await window.mega.servers.status(server.address, force)] as const))
      setStatuses(Object.fromEntries(entries))
    } catch (error) {
      if (force) notify(errorMessage(error), 'error')
    } finally {
      setRefreshing(false)
    }
  }, [notify])

  useEffect(() => {
    void refresh(false)
    const timer = window.setInterval(() => void refresh(false), 60_000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const play = async (address: string) => {
    if (!selected) return notify('Select an instance first.', 'error')
    try { await window.mega.instances.launchServer(selected.id, address) }
    catch (error) { notify(errorMessage(error), 'error') }
  }

  const copy = async (address: string) => {
    await window.mega.servers.copyAddress(address)
    notify('Server address copied.', 'success')
  }

  return (
    <div className="page">
      <PageHeading
        eyebrow="Featured"
        title="Partner servers"
        description="Live server details and one-click joining."
        actions={<button className="secondary" disabled={refreshing} onClick={() => void refresh(true)}><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh</button>}
      />
      <div className="server-grid">
        {partnerServers.map((server) => {
          const status = statuses[server.id]
          return (
            <article className={`server-card live-server-card ${status?.online ? 'online' : status ? 'offline' : 'loading'}`} key={server.id}>
              <div className="server-art">
                {status?.icon ? <img src={status.icon} alt={`${server.name} server icon`} /> : <Server size={42} />}
                <span>{status?.online ? 'Online' : status ? 'Offline' : 'Checking'}</span>
              </div>
              <div className="server-copy">
                <div className="server-title-row"><h2>{server.name}</h2><span className={`server-state ${status?.online ? 'online' : 'offline'}`}><i />{status?.online ? 'Online' : status ? 'Offline' : 'Checking'}</span></div>
                <p>{status?.motd || (status?.online ? 'Minecraft server' : status?.error || 'Checking server status…')}</p>
                <div className="server-live-meta">
                  <span><Users size={14} />{status?.online ? `${status.players?.online ?? 0} / ${status.players?.max ?? 0}` : '—'}</span>
                  <span><Gamepad2 size={14} />{status?.version ?? '—'}</span>
                  <span><Clock3 size={14} />{status?.latency != null ? `${status.latency} ms` : '—'}</span>
                </div>
                <button className="server-address" onClick={() => copy(server.address)}><span>{server.address}</span><Copy size={15} /></button>
              </div>
              <button className="primary large" disabled={!selected || launching} onClick={() => play(server.address)}>{launching ? <RefreshCw className="spin" /> : <Play fill="currentColor" />} Play</button>
            </article>
          )
        })}
      </div>
      {!selected && <div className="notice"><Info /><div><strong>Select an instance</strong><p>Choose the Minecraft setup you want to use before joining.</p></div></div>}
    </div>
  )
}

function CosmeticsView({ account, notify }: {
  account: Account
  notify: (message: string, kind?: ToastKind) => void
}) {
  const [profile, setProfile] = useState<ProfileData>()
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string>()
  const [variant, setVariant] = useState<'classic' | 'slim'>('classic')

  const load = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const next = await window.mega.account.profile(force) as ProfileData
      setProfile(next)
      const active = next.skins.find((skin) => skin.state === 'active')
      if (active) setVariant(active.variant)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { void load() }, [load])

  const upload = async () => {
    const file = await window.mega.account.chooseSkin()
    if (!file) return
    setAction('skin')
    try {
      const next = await window.mega.account.setSkin(file, variant) as ProfileData
      setProfile(next)
      notify('Skin updated.', 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
    finally { setAction(undefined) }
  }

  const cape = async (id?: string) => {
    setAction(id ?? 'hide')
    try {
      const next = await window.mega.account.setCape(id) as ProfileData
      setProfile(next)
      notify(id ? 'Cape activated.' : 'Cape hidden.', 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
    finally { setAction(undefined) }
  }

  const activeSkin = profile?.skins.find((skin) => skin.state === 'active')
  const activeCape = profile?.capes.find((capeItem) => capeItem.state === 'active')
  const revision = profile?.revision ?? 0
  const skinUrl = activeSkin ? cacheBustedImage(activeSkin.url, revision) : undefined
  const capeUrl = activeCape ? cacheBustedImage(activeCape.url, revision) : undefined

  return (
    <div className="page cosmetics-page">
      <PageHeading eyebrow="Appearance" title="Skin & cape" description={`Preview and update ${account.name}'s Minecraft look.`} />
      <div className="profile-grid refined-profile-grid">
        <section className="panel skin-panel clean-skin-panel">
          <div className="panel-title"><span>3D preview</span><button title="Refresh profile" disabled={loading} onClick={() => load(true)}><RefreshCw className={loading ? 'spin' : ''} size={15} /></button></div>
          <div className="skin-preview interactive-preview real-3d-preview">
            <Skin3DPreview skinUrl={skinUrl} capeUrl={capeUrl} slim={(activeSkin?.variant ?? variant) === 'slim'} loading={loading} />
            {activeSkin && <span className="skin-variant-chip">{activeSkin.variant === 'slim' ? 'Slim arms' : 'Classic arms'}</span>}
            {activeCape && <span className="active-cape-chip"><Sparkles size={12} /> {activeCape.alias}</span>}
          </div>
          <div className="skin-actions">
            <div className="segmented compact">
              <button className={variant === 'classic' ? 'active' : ''} onClick={() => setVariant('classic')}>Classic</button>
              <button className={variant === 'slim' ? 'active' : ''} onClick={() => setVariant('slim')}>Slim</button>
            </div>
            <button className="primary" onClick={upload} disabled={Boolean(action) || loading}>{action === 'skin' ? <RefreshCw className="spin" /> : <Upload />} Upload skin</button>
          </div>
        </section>

        <section className="panel cape-panel">
          <div className="panel-title"><span>Capes</span></div>
          <div className="cape-list">
            {profile?.capes.map((item) => (
              <button key={item.id} className={item.state === 'active' ? 'active' : ''} onClick={() => cape(item.id)} disabled={Boolean(action)}>
                <div className="cape-texture">{item.url ? <img src={cacheBustedImage(item.url, revision)} alt="" loading="lazy" decoding="async" /> : <Image />}</div>
                <span><strong>{item.alias}</strong><small>{item.state === 'active' ? 'Shown on preview' : 'Select cape'}</small></span>
                {action === item.id ? <RefreshCw className="spin" /> : item.state === 'active' ? <Check /> : <ChevronRight />}
              </button>
            ))}
          </div>
          {!loading && !profile?.capes.length && <div className="empty-compact"><Image /><h3>No capes found</h3><p>Your owned Java Edition capes will appear here.</p></div>}
          {Boolean(profile?.capes.length) && <button className="secondary hide-cape" disabled={Boolean(action) || !activeCape} onClick={() => cape(undefined)}>{action === 'hide' ? <RefreshCw className="spin" /> : <X />} Hide cape</button>}
        </section>
      </div>
    </div>
  )
}

function SettingsView({ settings, setSettings, update, version, clientVersion, notify }: {
  settings: SettingsData
  setSettings: (settings: SettingsData) => void
  update: any
  version: string
  clientVersion: string
  notify: (message: string, kind?: ToastKind) => void
}) {
  const [draft, setDraft] = useState(settings)
  useEffect(() => setDraft(settings), [settings])

  const patch = async (values: Partial<SettingsData>) => {
    const optimistic = { ...draft, ...values }
    setDraft(optimistic)
    try {
      const next = await window.mega.settings.update(values)
      setSettings(next)
      setDraft(next)
    } catch (error) {
      setDraft(settings)
      notify(errorMessage(error), 'error')
    }
  }

  const commitMemory = () => void patch({ memoryMin: draft.memoryMin, memoryMax: draft.memoryMax })
  const commitWindow = () => void patch({ width: draft.width, height: draft.height })

  return (
    <div className="page">
      <PageHeading eyebrow="Launcher" title="Settings" description="Performance, launch and update preferences." />
      <div className="settings-layout">
        <section className="settings-section">
          <div className="settings-title"><SlidersHorizontal /><div><h3>Performance</h3><p>Memory allocated to Minecraft</p></div></div>
          <div className="setting-row"><div><strong>Maximum memory</strong><small>{(draft.memoryMax / 1024).toFixed(1)} GB</small></div><input type="range" min="2048" max="32768" step="512" value={draft.memoryMax} onChange={(event) => setDraft({ ...draft, memoryMax: Number(event.target.value) })} onPointerUp={commitMemory} onKeyUp={commitMemory} /></div>
          <div className="setting-row"><div><strong>Minimum memory</strong><small>{(draft.memoryMin / 1024).toFixed(1)} GB</small></div><input type="range" min="512" max={Math.max(1024, draft.memoryMax - 512)} step="512" value={draft.memoryMin} onChange={(event) => setDraft({ ...draft, memoryMin: Number(event.target.value) })} onPointerUp={commitMemory} onKeyUp={commitMemory} /></div>
          <div className="settings-hint"><Cpu size={14} /><span>4–8 GB is suitable for most modded instances. Excessive allocation can make Java pauses worse.</span></div>
        </section>

        <section className="settings-section">
          <div className="settings-title"><Monitor /><div><h3>Game window</h3><p>Initial Minecraft window size</p></div></div>
          <div className="two-inputs">
            <label>Width<input type="number" min="640" max="7680" value={draft.width} onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })} onBlur={commitWindow} /></label>
            <label>Height<input type="number" min="360" max="4320" value={draft.height} onChange={(event) => setDraft({ ...draft, height: Number(event.target.value) })} onBlur={commitWindow} /></label>
          </div>
          <SettingToggle title="Start in fullscreen" description="Launch Minecraft directly in fullscreen mode." checked={draft.fullscreen} onChange={(value) => patch({ fullscreen: value })} />
        </section>

        <section className="settings-section">
          <div className="settings-title"><TerminalSquare /><div><h3>Launch behaviour</h3><p>Console and launcher visibility</p></div></div>
          <SettingToggle title="Open launch console" description="Show a separate live log window while Minecraft starts and runs." checked={draft.showConsole} onChange={(value) => patch({ showConsole: value })} />
          <SettingToggle title="Move launcher to tray while playing" description="Hide MegaClient when Minecraft starts and restore it when the game closes." checked={draft.minimizeToTrayOnLaunch} onChange={(value) => patch({ minimizeToTrayOnLaunch: value })} />
          <SettingToggle title="Reduce interface motion" description="Disable non-essential movement while keeping transitions responsive." checked={draft.reducedMotion} onChange={(value) => patch({ reducedMotion: value })} />
        </section>

        <section className="settings-section">
          <div className="settings-title"><RefreshCw /><div><h3>Updates & versions</h3><p>Keep MegaClient current</p></div></div>
          <div className="version-summary"><span><small>Launcher</small><strong>v{version}</strong></span><span><small>Built-in client</small><strong>v{clientVersion}</strong></span><span><small>Minecraft</small><strong>26.2</strong></span></div>
          <SettingToggle title="Automatic update checks" description="Check for launcher updates quietly when MegaClient starts." checked={draft.checkUpdates} onChange={(value) => patch({ checkUpdates: value })} />
          <SettingToggle title="Show snapshots" description="Include Minecraft snapshots in the instance version list." checked={draft.showSnapshots} onChange={(value) => patch({ showSnapshots: value })} />
          <div className="update-row"><span>{update?.state === 'checking' ? 'Checking for updates…' : update?.state === 'downloading' ? `Downloading update · ${Math.round(update.percent ?? 0)}%` : update?.state === 'ready' ? `Version ${update.version} ready` : update?.state === 'current' ? 'You are up to date' : update?.state === 'error' ? 'Update check could not finish' : 'MegaClient updates'}</span><button className="secondary" onClick={async () => { await window.mega.app.checkUpdates(); notify('Update check started.', 'success') }}><RefreshCw /> Check now</button></div>
        </section>

        <section className="settings-section full security-locked compact-security">
          <div className="settings-title"><ShieldCheck /><div><h3>Launch protection</h3><p>High-confidence checks run automatically without blocking normal mods for compatibility references or addon filenames.</p></div><span className="always-on"><Lock size={12} /> Always on</span></div>
        </section>

        <section className="settings-section full">
          <div className="settings-title"><HardDrive /><div><h3>Java runtime</h3><p>Automatic Java installs the correct runtime for each Minecraft version.</p></div></div>
          <div className="segmented java-mode"><button className={draft.javaMode === 'auto' ? 'active' : ''} onClick={() => patch({ javaMode: 'auto' })}>Automatic</button><button className={draft.javaMode === 'manual' ? 'active' : ''} onClick={() => patch({ javaMode: 'manual' })}>Custom path</button></div>
          {draft.javaMode === 'manual' && <label className="wide-label">Java executable path<input value={draft.javaPath} onChange={(event) => setDraft({ ...draft, javaPath: event.target.value })} onBlur={() => patch({ javaPath: draft.javaPath })} placeholder="C:\Program Files\Java\bin\javaw.exe" /></label>}
        </section>
      </div>
    </div>
  )
}

function SettingToggle({ title, description, checked, onChange }: {
  title: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="toggle-setting">
      <div><strong>{title}</strong><small>{description}</small></div>
      <button aria-pressed={checked} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><i /></button>
    </div>
  )
}

export default App
