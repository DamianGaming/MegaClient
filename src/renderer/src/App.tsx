import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  Gauge,
  HardDrive,
  Home,
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
  Shirt,
  SlidersHorizontal,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X
} from 'lucide-react'
// Keep the canvas renderer out of the initial launcher bundle until cosmetics opens.
const Skin3DPreview = lazy(() => import('./Skin3DPreview'))

type Tab = 'home' | 'instances' | 'browse' | 'manage' | 'servers' | 'cosmetics' | 'settings'
type Loader = 'vanilla' | 'forge' | 'neoforge' | 'fabric'
type ToastKind = 'error' | 'success' | 'warning'

interface BootStatus {
  value: number
  message: string
  detail?: string
}

const CLIENT_FALLBACK_VERSION = '0.14.3'
const LAUNCH_PHASES = ['profile', 'security', 'account', 'client', 'prepare', 'download', 'loader', 'java', 'assets', 'natives', 'launch'] as const

function launchPhaseLabel(phase?: string): string {
  return ({
    profile: 'Minecraft profile',
    security: 'Safety checks',
    account: 'Microsoft account',
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

interface ImportSourcePreview {
  sourcePath: string
  kind: 'curseforge' | 'modrinth' | 'lunar' | 'prism' | 'minecraft' | 'generic'
  sourceLabel: string
  name: string
  minecraftVersion?: string
  loader?: Loader
  loaderVersion?: string
  unsupportedLoader?: string
  content: { mods: number; resourcePacks: number; shaders: number; worlds: number; configurationFiles: number; otherFiles: number }
  warnings: string[]
  referencedRemoteMods?: number
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
  discordActivity: boolean
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

const navGroups: Array<{ label: string; items: Tab[] }> = [
  { label: 'Play', items: ['home', 'instances'] },
  { label: 'Content', items: ['browse', 'manage', 'servers', 'cosmetics'] },
  { label: 'Launcher', items: ['settings'] }
]

// An original pixel-art sunset used as the launcher's signature backdrop.
// Drawn on an 8px grid so it stays crisp at any size and costs almost nothing to render.
type SceneRect = [x: number, y: number, w: number, h: number, fill: string, opacity?: number]
const SCENE_RECTS: SceneRect[] = (() => {
  const r: SceneRect[] = []
  const add = (x: number, y: number, w: number, h: number, fill: string, o?: number) => r.push([x, y, w, h, fill, o])
  ;([[4, 1], [11, 2], [19, 1], [27, 3], [33, 1], [14, 4], [55, 4], [47, 2]] satisfies Array<[number, number]>).forEach(([x, y]) => add(x, y, 1, 1, '#ffffff', .55))
  add(36, 8, 12, 12, '#ffd9a0', .08)
  add(37, 9, 10, 10, '#ffd9a0', .12)
  ;([[40, 9, 4], [39, 10, 6], [38, 11, 8], [38, 12, 8], [38, 13, 8], [38, 14, 8], [38, 15, 8], [39, 16, 6], [40, 17, 4]] satisfies Array<[number, number, number]>).forEach(([x, y, w]) => add(x, y, w, 1, '#fff0c7'))
  add(6, 6, 8, 1, '#ffffff', .2); add(8, 5, 5, 1, '#ffffff', .2); add(7, 7, 6, 1, '#ffffff', .14)
  add(22, 10, 7, 1, '#ffffff', .18); add(24, 9, 4, 1, '#ffffff', .18)
  add(50, 6, 6, 1, '#ffffff', .18); add(52, 5, 3, 1, '#ffffff', .18)
  ;([[0, 22, 12, 12], [12, 20, 8, 14], [20, 21, 10, 13], [30, 19, 9, 15], [39, 21, 9, 13], [48, 19, 12, 15]] satisfies Array<[number, number, number, number]>).forEach(([x, y, w, h]) => add(x, y, w, h, '#6b3f93'))
  ;([[0, 24, 14, 10], [14, 23, 10, 11], [24, 25, 12, 9], [36, 23, 10, 11], [46, 24, 14, 10]] satisfies Array<[number, number, number, number]>).forEach(([x, y, w, h]) => add(x, y, w, h, '#432b7d'))
  ;([[2, 27], [16, 27], [21, 28], [33, 28], [43, 27], [50, 28], [58, 27]] satisfies Array<[number, number]>).forEach(([x, y]) => {
    add(x, y, 1, 2, '#35246c'); add(x - 1, y - 2, 3, 2, '#35246c'); add(x, y - 3, 1, 1, '#35246c')
  })
  ;([[6, 27], [13, 28], [19, 26], [26, 27], [31, 26], [38, 27], [41, 26], [47, 27], [54, 27]] satisfies Array<[number, number]>).forEach(([x, y]) => add(x, y, 1, 1, '#533a96'))
  ;([[5, 25], [10, 26], [29, 26], [34, 25], [52, 25], [57, 26]] satisfies Array<[number, number]>).forEach(([x, y]) => {
    add(x, y, 1, 4, '#251c58'); add(x - 2, y - 3, 5, 3, '#251c58'); add(x - 1, y - 5, 3, 2, '#251c58')
  })
  add(0, 29, 60, 1, '#63c471'); add(0, 30, 60, 1, '#3f9a54'); add(0, 31, 60, 3, '#4b3046')
  ;([[3, 32], [9, 33], [15, 32], [22, 33], [28, 32], [35, 33], [41, 32], [47, 33], [53, 32], [58, 33], [12, 31], [31, 31], [50, 31]] satisfies Array<[number, number]>).forEach(([x, y]) => add(x, y, 1, 1, '#614159'))
  ;([[7, 30], [19, 30], [26, 30], [44, 30], [56, 30]] satisfies Array<[number, number]>).forEach(([x, y]) => add(x, y, 1, 1, '#79dd86'))
  return r
})()

function PixelScene({ className = '', align = 'xMid' }: { className?: string; align?: 'xMin' | 'xMid' | 'xMax' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg className={`pixel-scene ${className}`} viewBox="0 0 480 272" preserveAspectRatio={`${align}YMax slice`} shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2470" />
          <stop offset=".45" stopColor="#7d4aa8" />
          <stop offset=".78" stopColor="#e0709a" />
          <stop offset="1" stopColor="#ffb470" />
        </linearGradient>
      </defs>
      <rect width="480" height="272" fill={`url(#sky${id})`} />
      {SCENE_RECTS.map(([x, y, w, h, fill, o], index) => <rect key={index} x={x * 8} y={y * 8} width={w * 8} height={h * 8} fill={fill} opacity={o} />)}
    </svg>
  )
}

function formatBytes(value = 0): string {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`
}

function updateTransferLabel(update: any): string {
  const transferred = Number(update?.transferred ?? 0)
  const total = Number(update?.total ?? 0)
  const speed = Number(update?.bytesPerSecond ?? 0)
  const parts: string[] = []
  if (transferred > 0 && total > 0) parts.push(`${formatBytes(transferred)} of ${formatBytes(total)}`)
  if (speed > 0) parts.push(`${formatBytes(speed)}/s`)
  return parts.join(' · ')
}

function formatDownloads(value: number): string {
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function loaderLabel(loader: Loader): string {
  return ({ vanilla: 'Vanilla', forge: 'Forge', neoforge: 'NeoForge', fabric: 'Fabric' } as const)[loader]
}

function errorMessage(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error)
  message = message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || 'Something went wrong. Please try again.'
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
  const [version, setVersion] = useState('1.12.17')
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
    overall?: number
  }>({ message: '' })
  const [update, setUpdate] = useState<any>(null)
  const [discordConfigured, setDiscordConfigured] = useState(false)
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
      setUpdate(data.update ?? null)
      setDiscordConfigured(Boolean(data.discordConfigured))
      document.documentElement.dataset.gamePerformance = String(Boolean(data.gamePerformanceMode))
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
  useEffect(() => window.mega.app.onPerformanceMode((active) => { document.documentElement.dataset.gamePerformance = String(active) }), [])
  useEffect(() => { void bootstrap(true) }, [bootstrap])
  useEffect(() => {
    if (!booting) return
    const timer = window.setInterval(() => setBootElapsed(Math.floor((Date.now() - bootStartedAt.current) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [booting])
  const progressTimer = useRef<number | null>(null)
  const queuedLaunchProgress = useRef<Parameters<Parameters<typeof window.mega.launchEvents.onProgress>[0]>[0] | null>(null)
  const progressLastAppliedAt = useRef(0)
  const highestLaunchProgress = useRef(0)
  useEffect(() => {
    const applyQueued = () => {
      progressTimer.current = null
      const current = queuedLaunchProgress.current
      queuedLaunchProgress.current = null
      if (current) {
        progressLastAppliedAt.current = Date.now()
        setLaunching(true)
        // Different loaders may report phases out of order. Keep the existing
        // progress bars smooth while still displaying the current, real step.
        const overall = Math.max(highestLaunchProgress.current, launchPhaseProgress(current.phase, current.progress))
        highestLaunchProgress.current = overall
        setLaunchProgress({ ...current, overall })
      }
    }
    const dispose = window.mega.launchEvents.onProgress((event) => {
      queuedLaunchProgress.current = event
      if (progressTimer.current !== null) return
      const interval = document.hidden ? 400 : 110
      const delay = Math.max(0, interval - (Date.now() - progressLastAppliedAt.current))
      progressTimer.current = window.setTimeout(applyQueued, delay)
    })
    return () => {
      if (progressTimer.current !== null) window.clearTimeout(progressTimer.current)
      progressTimer.current = null
      queuedLaunchProgress.current = null
      dispose()
    }
  }, [])
  useEffect(() => window.mega.launchEvents.onError((event) => {
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current)
    progressTimer.current = null
    queuedLaunchProgress.current = null
    highestLaunchProgress.current = 0
    setLaunching(false)
    notify(event.message ?? 'Minecraft failed to launch.', 'error')
  }), [notify])
  useEffect(() => window.mega.launchEvents.onWarning((event) => {
    notify(event.message ?? 'Minecraft launched with a warning.', 'warning')
  }), [notify])
  useEffect(() => window.mega.launchEvents.onClosed(() => {
    if (progressTimer.current !== null) window.clearTimeout(progressTimer.current)
    progressTimer.current = null
    queuedLaunchProgress.current = null
    highestLaunchProgress.current = 0
    setLaunching(false)
    setLaunchProgress({ message: '' })
    void bootstrap()
  }), [bootstrap])
  useEffect(() => window.mega.app.onUpdate(setUpdate), [])
  useEffect(() => {
    const retryUpdatesWhenOnline = () => void window.mega.app.checkUpdates()
    window.addEventListener('online', retryUpdatesWhenOnline)
    return () => window.removeEventListener('online', retryUpdatesWhenOnline)
  }, [])

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

  const launch = async (id?: string) => {
    const target = id ? instances.find((item) => item.id === id) : selected
    if (!target) return notify('Create an instance first.', 'error')
    if (!account) return notify('Sign in with Microsoft before launching.', 'error')
    if (launching) return
    highestLaunchProgress.current = 0
    setLaunching(true)
    setLaunchProgress({ message: 'Preparing to launch', progress: 0 })
    try {
      if (target.id !== selected?.id) await selectInstance(target.id)
      await window.mega.instances.launch(target.id)
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
      <Titlebar status={launching ? launchPhaseLabel(launchProgress.phase) : update?.state === 'downloading' ? 'Updating' : update?.state === 'checking' ? 'Checking updates' : update?.state === 'offline' ? 'Offline' : 'Ready'} />
      <aside className="sidebar">
        <button className="brand" onClick={() => { setAccountMenuOpen(false); setTab('home') }}>
          <img src="./logo-mark.png" alt="MegaClient" />
          <span><strong>MegaClient</strong><small>MegaStudios</small></span>
        </button>
        <nav aria-label="Launcher navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="sidebar-section-label">{group.label}</div>
              {group.items.map((id) => {
                const item = navItems.find((entry) => entry.id === id)!
                return (
                  <button key={item.id} aria-label={item.label} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => { setAccountMenuOpen(false); setTab(item.id) }}>
                    <item.icon size={21} strokeWidth={1.8} /> <span>{item.label}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom" ref={accountMenuRef}>
          {accountMenuOpen && (
            <div className="account-menu">
              <div className="account-menu-head"><img src={account.avatarUrl} alt="" /><span><strong>{account.name}</strong><small>Microsoft account</small></span></div>
              <button onClick={() => void switchAccount()} disabled={authenticating}><UserRound size={16} /><span>Switch account</span></button>
              <button className="danger" onClick={() => void signOut()}><LogOut size={16} /><span>Sign out</span></button>
            </div>
          )}
          <button className="rail-tool" aria-label="Launch console" onClick={() => window.mega.instances.openConsole()}><TerminalSquare size={20} /></button>
          <button className={`account-mini ${accountMenuOpen ? 'open' : ''}`} onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen} aria-label={`Account: ${account.name}`}>
            <img src={account.avatarUrl} alt="" />
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="workspace-topline">
        {update?.state === 'ready' && (
          <div className="update-banner">
            <Download size={17} />
            <span>MegaClient {update.version} is ready.</span>
            <button onClick={() => window.mega.app.installUpdate()}>Restart and update</button>
          </div>
        )}
        {update?.pausedForGame && update?.state !== 'ready' && (
          <div className="update-banner quiet">
            <Gauge size={16} />
            <span>{update?.state === 'available' ? `Update ${update.version} will download after Minecraft closes.` : 'Updates are paused while Minecraft runs.'}</span>
          </div>
        )}
        {update?.state === 'available' && !update?.pausedForGame && (
          <div className="update-banner quiet">
            <Download size={16} />
            <span>Downloading MegaClient {update.version}…</span>
          </div>
        )}
        {update?.state === 'downloading' && (
          <div className="update-banner quiet">
            <RefreshCw className="spin" size={16} />
            <span>Downloading update · {Math.round(update.percent ?? 0)}%{updateTransferLabel(update) ? ` · ${updateTransferLabel(update)}` : ''}</span>
            <div className="banner-progress"><i style={{ width: `${Math.max(2, update.percent ?? 0)}%` }} /></div>
          </div>
        )}
        {launching && <ActivityBanner progress={launchProgress} onConsole={() => window.mega.instances.openConsole()} />}
        </div>
        {tab === 'home' && (
          <HomeView
            selected={selected}
            launching={launching}
            progress={launchProgress}
            account={account}
            instances={instances}
            onLaunch={() => void launch()}
            onLaunchInstance={(id: string) => void launch(id)}
            onInstances={() => setTab('instances')}
            onBrowse={() => setTab('browse')}
            onManage={() => setTab('manage')}
            onServers={() => setTab('servers')}
            onCosmetics={() => setTab('cosmetics')}
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
          <SettingsView settings={settings} setSettings={setSettings} update={update} version={version} clientVersion={clientVersion} discordConfigured={discordConfigured} notify={notify} />
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
          <div className="startup-art" aria-hidden="true"><PixelScene align="xMax" /><img src="./logo.png" alt="" /></div>
          <div className="startup-panel">
          {error ? (
            <>
              <div className="startup-error-icon"><AlertTriangle /></div>
              <h1>MegaClient could not finish starting</h1>
              <p>{error}</p>
              <div className="startup-actions"><button className="secondary" onClick={onClose}>Close</button><button className="primary" onClick={onRetry}><RefreshCw /> Try again</button></div>
            </>
          ) : (
            <>
              <div className="startup-heading"><div><h1>{status.message}</h1>{status.detail && <p>{status.detail}</p>}</div><span>{Math.round(value)}%</span></div>
              <div className="startup-progress"><i style={{ width: `${value}%` }} /></div>
              <div className="startup-steps">
                {steps.map((step) => {
                  const done = value >= step.threshold
                  const active = !done && value >= step.threshold - 24
                  return <div key={step.label} className={done ? 'done' : active ? 'active' : ''}><span>{done ? <Check /> : active ? <RefreshCw className="spin" /> : <i />}</span><strong>{step.label}</strong></div>
                })}
              </div>
              {elapsed >= 12 && <div className="startup-foot"><small>Still working — Microsoft services can occasionally take a little longer.</small></div>}
            </>
          )}
          </div>
        </section>
      </main>
    </div>
  )
}

function ActivityBanner({ progress, onConsole }: { progress: any; onConsole: () => void }) {
  const overall = (progress.overall ?? launchPhaseProgress(progress.phase, progress.progress))
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
  const [progress, setProgress] = useState({
    value: 8,
    message: 'Starting MegaClient',
    detail: 'Preparing the secure launcher',
    launcherVersion: '1.12.17',
    clientVersion: CLIENT_FALLBACK_VERSION
  })
  const [visualProgress, setVisualProgress] = useState(8)
  const [leaving, setLeaving] = useState(false)
  const visualProgressRef = useRef(8)

  useEffect(() => window.mega.app.onSplashProgress((event) => {
    setProgress((current) => ({
      value: Math.max(0, Math.min(100, Number(event?.value ?? current.value))),
      message: String(event?.message ?? current.message),
      detail: String(event?.detail ?? current.detail),
      launcherVersion: String(event?.launcherVersion ?? current.launcherVersion),
      clientVersion: String(event?.clientVersion ?? current.clientVersion)
    }))
  }), [])

  useEffect(() => window.mega.app.onSplashLeaving(() => setLeaving(true)), [])

  useEffect(() => {
    const from = visualProgressRef.current
    const to = progress.value
    if (Math.abs(to - from) < 0.1) return
    const startedAt = performance.now()
    const duration = Math.max(180, Math.min(520, Math.abs(to - from) * 12))
    let frame = 0
    const animate = (now: number) => {
      const amount = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - amount, 3)
      const next = from + (to - from) * eased
      visualProgressRef.current = next
      setVisualProgress(next)
      if (amount < 1) frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [progress.value])

  const roundedProgress = Math.round(visualProgress)

  return (
    <div className={`splash compact-splash separate-splash ${leaving ? 'is-leaving' : ''}`}>
      <PixelScene className="splash-scene" />
      <section className="splash-surface">
        <div className="splash-mark"><img src="./logo-mark.png" alt="" /></div>
        <div className="splash-copy">
          <strong>MegaClient</strong>
          <span>{progress.message}</span>
        </div>
        <span className="splash-percent">{roundedProgress}%</span>
        <div className="splash-progress" aria-label={`Loading ${roundedProgress}%`}><i style={{ width: `${visualProgress}%` }} /></div>
      </section>
    </div>
  )
}

function LoginScreen({ version, loading, onLogin }: { version: string; loading: boolean; onLogin: () => void }) {
  return (
    <div className="login-shell clean-login">
      <Titlebar />
      <section className="login-card">
        <div className="login-art" aria-hidden="true">
          <PixelScene align="xMax" />
          <img src="./logo.png" alt="" />
        </div>
        <div className="login-panel">
          <div className="login-brand">
            <div className="login-logo-wrap"><img src="./logo-mark.png" alt="" /></div>
            <div><strong>MegaClient</strong><small>by MegaStudios</small></div>
          </div>
          <div className="login-copy">
            <h1>Just Minecraft.<br /><em>Your way.</em></h1>
            <p>Sign in to pick up where you left off.</p>
          </div>
          <button className="microsoft-login" onClick={onLogin} disabled={loading}>
            <span className="ms-symbol"><i /><i /><i /><i /></span>
            <span>{loading ? 'Opening Microsoft sign-in…' : 'Continue with Microsoft'}</span>
            {loading ? <RefreshCw className="spin" size={18} /> : <ChevronRight size={18} />}
          </button>
          <div className="login-details"><span>Launcher {version}</span></div>
        </div>
      </section>
    </div>
  )
}

function Titlebar({ status }: { status?: string } = {}) {
  return (
    <header className="titlebar">
      <div className="titlebar-label"><img src="./logo-mark.png" alt="" /><span>MegaClient</span></div>
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

function PageHeading({ title, description, actions }: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="page-heading">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  )
}

function HomeView({ account, instances, selected, launching, progress, onLaunch, onLaunchInstance, onInstances, onBrowse, onManage, onServers, onCosmetics }: any) {
  const loader = selected ? loaderLabel(selected.loader) : ''
  const percent = Math.round((progress.overall ?? launchPhaseProgress(progress.phase, progress.progress)) * 100)
  const others: Instance[] = useMemo(
    () => instances.filter((item: Instance) => item.id !== selected?.id).sort((a: Instance, b: Instance) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '')).slice(0, 2),
    [instances, selected?.id]
  )
  const banners = [
    { action: onBrowse, icon: Search, title: 'Discover', tone: 'one' },
    { action: onManage, icon: Layers3, title: 'Your content', tone: 'two' },
    { action: onServers, icon: Server, title: 'Servers', tone: 'three' },
    { action: onCosmetics, icon: Shirt, title: 'Skin & cape', tone: 'four' }
  ]
  return (
    <div className="page home-page">
      <header className="home-welcome">
        <img src={account.avatarUrl} alt="" />
        <h1>Welcome back, <em>{account.name}</em></h1>
      </header>

      <div className="home-grid">
        <div className="home-main">
          <div className="play-workspace">
            <section className={`hero ${launching ? 'is-launching' : ''}`} aria-label="Current Minecraft instance">
              <PixelScene className="hero-scene" />
              <div className="hero-shade" aria-hidden="true" />
              <div className="hero-character">
                <span className="hero-nametag">{account.name}</span>
                <img src={account.avatarUrl} alt="" />
              </div>
              <div className="hero-body">
                {launching && (
                  <div className="play-live-progress">
                    <div><span>{progress.message || 'Preparing Minecraft'}</span><strong>{percent}%</strong></div>
                    <div className="progress"><i style={{ width: `${Math.max(4, percent)}%` }} /></div>
                  </div>
                )}
                <button className="primary play-primary" onClick={onLaunch} disabled={launching || !selected}>
                  {launching ? <RefreshCw size={20} className="spin" /> : <Play size={20} fill="currentColor" />}
                  <span className="play-label"><strong>{launching ? 'Launching…' : 'Play'}</strong><small>{selected ? selected.name : 'Create an instance to begin'}</small></span>
                </button>
                {selected && (
                  <div className="hero-chips">
                    <span>{loader} {selected.minecraftVersion}</span>
                    <button onClick={onInstances}>Switch</button>
                  </div>
                )}
              </div>
            </section>
          </div>

          {others.length > 0 && (
            <section className="recent" aria-label="Quick launch">
              <div className="recent-head"><span>Quick launch</span></div>
              <div className="recent-list">
                {others.map((item) => (
                  <article key={item.id} className="recent-row">
                    <div className="recent-icon">{item.customClient ? <img src="./logo-mark.png" alt="" /> : <Gamepad2 size={22} />}</div>
                    <div className="recent-copy"><strong>{item.name}</strong><small>{item.minecraftVersion} · {loaderLabel(item.loader)}</small></div>
                    <button className="primary recent-play" disabled={launching} onClick={() => onLaunchInstance(item.id)}><Play size={14} fill="currentColor" /> Play</button>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="home-actions">
            <button className="primary" onClick={onInstances}><Library size={16} /> Manage profiles</button>
            <button className="secondary" onClick={onBrowse}><Plus size={16} /> Add mods</button>
          </div>
        </div>

        <aside className="home-command-list" aria-label="Quick actions">
          {banners.map((banner) => (
            <button key={banner.title} onClick={banner.action} className={`banner-card ${banner.tone}`}>
              <banner.icon className="banner-icon" size={72} strokeWidth={1.3} />
              <strong>{banner.title}</strong>
              <ChevronRight size={18} className="banner-arrow" />
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}

function InstancesView({ instances, selectedId, settings, onSelect, onChanged, notify }: any) {
  const [showCreate, setShowCreate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Instance>()
  const remove = async (instance: Instance) => {
    try {
      await window.mega.instances.delete(instance.id)
      setPendingDelete(undefined)
      await onChanged()
      notify('Instance deleted.', 'success')
    } catch (error) { notify(errorMessage(error), 'error') }
  }

  return (
    <div className="page">
      <PageHeading
        title="Instances"
        actions={<div className="heading-actions"><button className="secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Import</button><button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> New instance</button></div>}
      />
      <div className="instance-grid">
        {instances.map((instance: Instance) => (
          <article key={instance.id} className={`instance-card ${selectedId === instance.id ? 'selected' : ''}`} onClick={() => onSelect(instance.id)}>
            <div className="instance-art" aria-hidden="true" style={{ ['--hue' as any]: ({ vanilla: 145, fabric: 255, forge: 18, neoforge: 28 } as Record<string, number>)[instance.loader] ?? 255 }}><b>{instance.minecraftVersion}</b>{selectedId === instance.id && <span className="instance-check"><Check size={13} /> Selected</span>}</div>
            <div className="instance-card-top">
              <div className="instance-icon big">{instance.customClient ? <img src="./logo-mark.png" alt="" /> : <Gamepad2 size={25} />}</div>
              <div className="instance-actions">
                <button title="Open folder" onClick={(event) => { event.stopPropagation(); void window.mega.instances.openFolder(instance.id) }}><FolderOpen size={16} /></button>
                <button title="Delete" className="danger-icon" onClick={(event) => { event.stopPropagation(); setPendingDelete(instance) }}><Trash2 size={16} /></button>
              </div>
            </div>
            <h3>{instance.name}</h3>
            <div className="badges"><span>{loaderLabel(instance.loader)}</span>{instance.customClient && <span className="gradient-badge">MegaClient</span>}</div>
          </article>
        ))}
      </div>
      {!instances.length && <div className="empty-state"><Library size={34} /><h2>Your instance library is empty</h2><p>Create a fresh setup or bring across a Minecraft profile you already use.</p><div className="empty-actions"><button className="secondary" onClick={() => setShowImport(true)}><Upload size={16} /> Import profile</button><button className="primary" onClick={() => setShowCreate(true)}><Plus size={17} /> Create instance</button></div></div>}
      {showCreate && <CreateInstanceModal settings={settings} onClose={() => setShowCreate(false)} onCreated={async () => { setShowCreate(false); await onChanged(); notify('Instance created.', 'success') }} notify={notify} />}
      {showImport && <ImportInstanceModal instances={instances} onClose={() => setShowImport(false)} onImported={async (result) => { setShowImport(false); await onChanged(); const copied=Number(result?.copiedFiles ?? 0); const skipped=Number(result?.skippedFiles ?? 0); notify(`Imported ${copied} file${copied===1?'':'s'}${skipped?` · ${skipped} already existed`:''}.`, 'success') }} notify={notify} />}
      {pendingDelete && <ConfirmDialog title={`Delete ${pendingDelete.name}?`} message="This removes the instance, its mods and local game files." onCancel={() => setPendingDelete(undefined)} onConfirm={() => remove(pendingDelete)} />}
    </div>
  )
}

function ImportInstanceModal({ instances, onClose, onImported, notify }: { instances: Instance[]; onClose: () => void; onImported: (result: any) => Promise<void>; notify: (message: string, kind?: ToastKind) => void }) {
  const [preview, setPreview] = useState<ImportSourcePreview | null>(null)
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [name, setName] = useState('Imported instance')
  const [minecraftVersion, setMinecraftVersion] = useState('')
  const [loader, setLoader] = useState<Loader>('vanilla')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [instanceId, setInstanceId] = useState(instances[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [progress, setProgress] = useState<{ message: string; progress?: number }>({ message: '' })

  useEffect(() => window.mega.instances.onImportProgress(setProgress), [])
  useEffect(() => {
    if (!preview) return
    setName(preview.name || 'Imported instance')
    setMinecraftVersion(preview.minecraftVersion ?? '')
    setLoader(preview.loader ?? 'vanilla')
    setLoaderVersion(preview.loaderVersion ?? '')
  }, [preview])

  const choose = async (folder: boolean) => {
    if (busy || choosing) return
    setChoosing(true)
    try {
      const source = folder ? await window.mega.instances.chooseImportFolder() : await window.mega.instances.chooseImportFile()
      if (!source) return
      setProgress({ message: 'Checking profile…', progress: 0 })
      setPreview(await window.mega.instances.inspectImport(source) as ImportSourcePreview)
    } catch (error) { notify(errorMessage(error), 'error') } finally { setChoosing(false) }
  }

  const runImport = async () => {
    if (!preview) return
    if (mode === 'existing' && !instanceId) return notify('Choose an existing instance first.', 'error')
    if (mode === 'new' && !name.trim()) return notify('Give the imported instance a name.', 'error')
    if (mode === 'new' && !minecraftVersion.trim()) return notify('Enter the Minecraft version for this profile.', 'error')
    if (mode === 'new' && loader !== 'vanilla' && !loaderVersion.trim()) return notify(`Enter the ${loaderLabel(loader)} loader version.`, 'error')
    setBusy(true); setProgress({ message: 'Preparing import…', progress: 0.01 })
    try {
      const result = await window.mega.instances.importSetup({ sourcePath: preview.sourcePath, mode, instanceId: mode === 'existing' ? instanceId : undefined, name: mode === 'new' ? name.trim() : undefined, minecraftVersion: mode === 'new' ? minecraftVersion.trim() : undefined, loader: mode === 'new' ? loader : undefined, loaderVersion: mode === 'new' && loader !== 'vanilla' ? loaderVersion.trim() : undefined })
      if (result?.warnings?.length) notify(result.warnings[0], 'warning')
      await onImported(result)
    } catch (error) { notify(errorMessage(error), 'error') } finally { setBusy(false) }
  }

  const content=preview?.content
  const total=content ? content.mods+content.resourcePacks+content.shaders+content.worlds+content.configurationFiles+content.otherFiles : 0
  const instanceOptions: SelectMenuOption[]=instances.map((instance)=>({value:instance.id,label:instance.name,description:`Minecraft ${instance.minecraftVersion} · ${loaderLabel(instance.loader)}`}))
  const loaderOptions: SelectMenuOption[]=[{value:'vanilla',label:'Vanilla',description:'No mod loader'},{value:'fabric',label:'Fabric',description:'Fabric mod loader'},{value:'forge',label:'Forge',description:'Forge mod loader'},{value:'neoforge',label:'NeoForge',description:'NeoForge mod loader'}]

  return <div className="modal-backdrop" onPointerDown={busy ? undefined : onClose}>
    <div className="modal import-instance-modal" onPointerDown={(event)=>event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="import-instance-title">
      <div className="modal-header"><div><small>IMPORT</small><h2 id="import-instance-title">Bring your Minecraft setup</h2></div><button type="button" aria-label="Close import" onClick={onClose} disabled={busy}><X /></button></div>
      {!preview ? <div className="import-source-step">
        <p>Move compatible mods, configuration, resource packs, shaders, worlds and profile settings into MegaClient.</p>
        <div className="import-source-grid">
          <button type="button" onClick={()=>void choose(false)} disabled={choosing}><PackagePlus /><span><strong>Profile or pack</strong><small>Modrinth .mrpack, Lunar .dawnpack, CurseForge ZIP or another archive</small></span><ChevronRight /></button>
          <button type="button" onClick={()=>void choose(true)} disabled={choosing}><FolderOpen /><span><strong>Installed profile folder</strong><small>Lunar, CurseForge, Prism / MultiMC or a normal Minecraft profile</small></span><ChevronRight /></button>
        </div>
        <div className="import-note"><Info size={15}/><span>Accounts, launcher credentials and launcher-only cosmetics are never imported.</span></div>
      </div> : <>
        <div className="import-summary"><div className="import-source-icon"><Upload size={20}/></div><div className="import-source-copy"><small>{preview.sourceLabel}</small><strong>{preview.name}</strong><span title={preview.sourcePath}>{preview.sourcePath}</span></div><button className="text-button" type="button" onClick={()=>setPreview(null)} disabled={busy}>Change</button></div>
        <div className="import-counts"><span><strong>{content?.mods??0}</strong><small>Mods</small></span><span><strong>{content?.resourcePacks??0}</strong><small>Packs</small></span><span><strong>{content?.shaders??0}</strong><small>Shaders</small></span><span><strong>{content?.worlds??0}</strong><small>Worlds</small></span><span><strong>{content?.configurationFiles??0}</strong><small>Config</small></span><span><strong>{total}</strong><small>Detected</small></span></div>
        {preview.warnings.map((warning,index)=><div className="field-message warning" key={`${warning}-${index}`}><AlertTriangle size={15}/><span>{warning}</span></div>)}
        <div className="segmented import-target"><button type="button" className={mode==='new'?'active':''} onClick={()=>setMode('new')} disabled={busy}>New instance</button><button type="button" className={mode==='existing'?'active':''} onClick={()=>setMode('existing')} disabled={busy||!instances.length}>Existing instance</button></div>
        {mode==='new' ? <div className="import-form"><label className="field-label">Instance name<input value={name} onChange={(e)=>setName(e.target.value)} maxLength={48} disabled={busy}/></label><div className="form-grid"><label className="field-label">Minecraft version<input value={minecraftVersion} onChange={(e)=>setMinecraftVersion(e.target.value)} placeholder="e.g. 1.21.8" disabled={busy}/></label><label className="field-label">Loader<SelectMenu value={loader} options={loaderOptions} onChange={(value)=>setLoader(value as Loader)} ariaLabel="Imported profile loader" disabled={busy}/></label></div>{loader!=='vanilla'&&<label className="field-label">Loader version<input value={loaderVersion} onChange={(e)=>setLoaderVersion(e.target.value)} placeholder={`Required ${loaderLabel(loader)} version`} disabled={busy}/></label>}</div> : <label className="field-label">Import into<SelectMenu value={instanceId} options={instanceOptions} onChange={setInstanceId} ariaLabel="Existing instance" disabled={busy} emptyLabel="Create an instance first"/></label>}
        {busy&&<div className="import-progress"><div><strong>{progress.message||'Importing profile…'}</strong><span>{Math.round(Math.max(0,Math.min(1,progress.progress??0))*100)}%</span></div><div className="progress"><i style={{width:`${Math.max(3,Math.min(100,(progress.progress??0)*100))}%`}}/></div><small>MegaClient keeps the interface responsive while files are copied.</small></div>}
      </>}
      <div className="modal-footer"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>{preview&&<button type="button" className="primary" onClick={()=>void runImport()} disabled={busy}>{busy?<RefreshCw className="spin"/>:<Upload/>}{busy?'Importing…':'Import profile'}</button>}</div>
    </div>
  </div>
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
      setMcVersion((current) => (current === '26.2' || current === '26.3') ? current : current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? ''))
      if (!items.length) setVersionsError('No Minecraft versions were returned. Check your connection and try again.')
    } catch (error) {
      setVersions([])
      setMcVersion((current) => (current === '26.2' || current === '26.3') ? current : '')
      setVersionsError(errorMessage(error))
    } finally {
      setLoadingVersions(false)
    }
  }, [settings.showSnapshots])

  useEffect(() => { void loadMinecraftVersions() }, [loadMinecraftVersions])

  useEffect(() => {
    if (custom) {
      setName((current) => current.startsWith('MegaClient 26.') ? current : 'MegaClient 26.3')
      setLoader('fabric')
      setMcVersion('26.3')
    } else {
      setName((current) => current === 'MegaClient 26.2' || current === 'MegaClient 26.3' ? 'New instance' : current)
      setLoader('vanilla')
      setMcVersion((current) => current || versions[0]?.id || '')
    }
  }, [custom])

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

  const chooseProtectedVersion = (version: string) => {
    setMcVersion(version)
    if (name === 'MegaClient 26.2' || name === 'MegaClient 26.3') setName(`MegaClient ${version}`)
  }

  const create = async () => {
    if (!name.trim()) return notify('Give the instance a name.', 'error')
    if (!mcVersion) return notify('Select a Minecraft version first.', 'error')
    if (loader !== 'vanilla' && !loaderVersion) return notify(loaderError || `${loaderLabel(loader)} does not support this Minecraft version.`, 'error')
    setBusy(true)
    try {
      await window.mega.instances.create({ name: name.trim(), minecraftVersion: mcVersion, loader, loaderVersion, customClient: custom, autoUpdateLoader: custom || (loader !== 'vanilla' && loaderVersion === loaderVersions[0]) })
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
          <button type="button" className={custom ? 'chosen client-choice' : ''} onClick={() => setCustom(true)}><img src="./logo-mark.png" alt="" /><span><strong>MegaClient</strong><small>Fabric · Minecraft 26.2 / 26.3</small></span></button>
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
          <label className="field-label">MegaClient Minecraft version
            <SelectMenu value={mcVersion} options={[{ value: '26.3', label: '26.3', description: 'Newest supported client' }, { value: '26.2', label: '26.2', description: 'Previous supported client' }]} onChange={chooseProtectedVersion} ariaLabel="MegaClient Minecraft version" />
          </label>
        )}
        {custom && (
          <div className="client-note">
            <img src="./logo-mark.png" alt="" />
            <div><strong>MegaClient {CLIENT_FALLBACK_VERSION}</strong><p>Minecraft {mcVersion} and its compatible Fabric dependencies are prepared automatically.</p></div>
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
        title="Discover"
        description={selected ? `Installing to ${selected.name} · ${selected.minecraftVersion}` : 'Select an instance before installing.'}
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
        title="Manage"
        description={selected?.name ?? 'No instance selected'}
      />
      <div className="manage-layout">
      <div className="manage-tabs" role="tablist" aria-label="Content management">
        <button role="tab" aria-selected={section === 'mods'} className={section === 'mods' ? 'active' : ''} onClick={() => setSection('mods')}><Box size={16} /> Mods</button>
        <button role="tab" aria-selected={section === 'resourcepacks'} className={section === 'resourcepacks' ? 'active' : ''} onClick={() => setSection('resourcepacks')}><Image size={16} /> Resource packs</button>
        <button role="tab" aria-selected={section === 'shaders'} className={section === 'shaders' ? 'active' : ''} onClick={() => setSection('shaders')}><Sparkles size={16} /> Shaders</button>
        <button role="tab" aria-selected={section === 'worlds'} className={section === 'worlds' ? 'active' : ''} onClick={() => setSection('worlds')}><Map size={16} /> Worlds</button>
      </div>
      <div className="manage-surface">
        {section === 'mods' && <ModsManager selected={selected} notify={notify} />}
        {section === 'resourcepacks' && <PacksManager selected={selected} type="resourcepack" notify={notify} />}
        {section === 'shaders' && <PacksManager selected={selected} type="shader" notify={notify} />}
        {section === 'worlds' && <WorldsManager selected={selected} notify={notify} />}
      </div>
      </div>
    </div>
  )
}

function ManagerHeading({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="manager-heading">
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
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
  { id: 'willowsmp', name: 'WillowSMP', address: 'play.willowsmp.co.uk' }
] as const

function ServersView({ selected, launching, notify }: { selected?: Instance; launching: boolean; notify: (message: string, kind?: ToastKind) => void }) {
  const [statuses, setStatuses] = useState<Record<string, PartnerServerStatus | undefined>>({})
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async (force = false) => {
    if (launching || document.hidden) return
    setRefreshing(true)
    try {
      const entries = await Promise.all(partnerServers.map(async (server) => [server.id, await window.mega.servers.status(server.address, force)] as const))
      setStatuses(Object.fromEntries(entries))
    } catch (error) {
      if (force) notify(errorMessage(error), 'error')
    } finally {
      setRefreshing(false)
    }
  }, [launching, notify])

  useEffect(() => {
    if (launching || document.hidden) return
    void refresh(false)
    const timer = window.setInterval(() => void refresh(false), 90_000)
    const onVisibility = () => { if (!document.hidden && !launching) void refresh(false) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [launching, refresh])

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
    <div className="page servers-page">
      <PageHeading
        title="Servers"
        actions={<button className="secondary" disabled={refreshing || launching} onClick={() => void refresh(true)}><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> Refresh</button>}
      />
      <div className="server-grid">
        {partnerServers.map((server) => {
          const status = statuses[server.id]
          const online = status?.players?.online
          const max = status?.players?.max
          const fill = status?.online && max ? Math.min(100, Math.round(((online ?? 0) / max) * 100)) : 0
          const ping = status?.latency
          const pingTone = ping == null ? '' : ping < 80 ? '' : ping < 160 ? 'mid' : 'high'
          return (
            <article className={`server-card live-server-card ${status?.online ? 'online' : status ? 'offline' : 'loading'}`} key={server.id}>
              <div className="server-art">
                <PixelScene />
                {status?.icon ? <img src={status.icon} alt={`${server.name} server icon`} /> : <Server size={42} />}
              </div>
              <div className="server-copy">
                <div className="server-title-row"><h2>{server.name}</h2><span className={`server-state ${status?.online ? 'online' : status ? 'offline' : ''}`}><i />{status?.online ? 'Online' : status ? 'Offline' : 'Checking'}</span></div>
                <p className="server-motd">{status?.motd || (status?.online ? 'Minecraft server' : status?.error || 'Checking server status…')}</p>
                <div className="server-stats">
                  <div className="server-stat"><span>Players</span><strong>{status?.online ? (online ?? 0) : '—'}{status?.online && max ? <small>/ {max}</small> : null}</strong><div className="meter"><i style={{ width: `${fill}%` }} /></div></div>
                  <div className="server-stat"><span>Latency</span><strong>{ping != null ? <span className={`ping ${pingTone}`}><i />{ping} ms</span> : '—'}</strong></div>
                </div>
                <div className="server-actions">
                  <button className="server-address" title="Copy server address" onClick={() => copy(server.address)}><span>{server.address}</span><Copy size={16} /></button>
                  <button className="primary" disabled={!selected || launching} onClick={() => play(server.address)}>{launching ? <RefreshCw className="spin" /> : <Play fill="currentColor" />} Play</button>
                </div>
              </div>
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
  const [profileError, setProfileError] = useState<string>()
  const loadSequence = useRef(0)

  const load = useCallback(async (force = false, quiet = false) => {
    const sequence = ++loadSequence.current
    setLoading(true)
    try {
      const next = await window.mega.account.profile(force) as ProfileData
      if (sequence !== loadSequence.current) return
      setProfile(next)
      setProfileError(undefined)
      const active = next.skins.find((skin) => skin.state === 'active')
      if (active) setVariant(active.variant)
    } catch (error) {
      if (sequence !== loadSequence.current) return
      const message = errorMessage(error)
      setProfileError(message)
      if (!quiet) notify(message, 'error')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [notify])

  useEffect(() => { void load(false, true) }, [load])

  const upload = async () => {
    if (action) return
    setAction('skin-picker')
    try {
      const file = await window.mega.account.chooseSkin()
      if (!file) return

      setAction('skin-upload')
      const next = await window.mega.account.setSkin(file, variant) as ProfileData
      setProfile(next)
      const active = next.skins.find((skin) => skin.state === 'active')
      if (active) setVariant(active.variant)
      notify('Skin uploaded and equipped.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setAction(undefined)
    }
  }

  const cape = async (id?: string) => {
    if (action) return
    const currentlyActive = profile?.capes.find((capeItem) => capeItem.state === 'active')
    if ((id && currentlyActive?.id === id) || (!id && !currentlyActive)) return

    setAction(id ?? 'hide')
    try {
      const next = await window.mega.account.setCape(id) as ProfileData
      setProfile(next)
      notify(id ? 'Cape equipped.' : 'Cape hidden.', 'success')
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setAction(undefined)
    }
  }

  const activeSkin = profile?.skins.find((skin) => skin.state === 'active')
  const activeCape = profile?.capes.find((capeItem) => capeItem.state === 'active')
  const revision = profile?.revision ?? 0
  const skinUrl = activeSkin ? cacheBustedImage(activeSkin.url, revision) : undefined
  const capeUrl = activeCape ? cacheBustedImage(activeCape.url, revision) : undefined

  return (
    <div className="page cosmetics-page">
      <PageHeading title="Skin & cape" />
      {profileError && !profile && (
        <div className="notice cosmetics-service-notice">
          <AlertTriangle />
          <div><strong>Appearance is unavailable right now</strong><p>{profileError}</p></div>
          <button className="secondary" disabled={loading} onClick={() => load(true)}>{loading ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}
      <div className="profile-grid refined-profile-grid">
        <section className="panel skin-panel clean-skin-panel">
          <div className="panel-title"><span>Preview</span><button title="Refresh profile" disabled={loading} onClick={() => load(true)}><RefreshCw className={loading ? 'spin' : ''} size={15} /></button></div>
          <div className="skin-preview interactive-preview real-3d-preview">
            <Suspense fallback={<div className="skin3d-loading">Preparing character preview…</div>}>
              <Skin3DPreview skinUrl={skinUrl} capeUrl={capeUrl} slim={(activeSkin?.variant ?? variant) === 'slim'} loading={loading} />
            </Suspense>
            {activeSkin && <span className="skin-variant-chip">{activeSkin.variant === 'slim' ? 'Slim arms' : 'Classic arms'}</span>}
            {activeCape && <span className="active-cape-chip"><Sparkles size={12} /> {activeCape.alias}</span>}
          </div>
          <div className="skin-actions">
            <div className="segmented compact">
              <button disabled={Boolean(action)} className={variant === 'classic' ? 'active' : ''} onClick={() => setVariant('classic')}>Classic</button>
              <button disabled={Boolean(action)} className={variant === 'slim' ? 'active' : ''} onClick={() => setVariant('slim')}>Slim</button>
            </div>
            <button className="primary" onClick={upload} disabled={Boolean(action) || loading}>
              {action?.startsWith('skin-') ? <RefreshCw className="spin" /> : <Upload />}
              {action === 'skin-picker' ? 'Choosing skin…' : action === 'skin-upload' ? 'Uploading…' : 'Upload skin'}
            </button>
          </div>
          {action?.startsWith('skin-') && <div className="cosmetic-action-status" role="status" aria-live="polite"><RefreshCw className="spin" size={13} /><span>{action === 'skin-picker' ? 'Choose a PNG skin…' : 'Uploading your skin…'}</span></div>}
        </section>

        <section className="panel cape-panel">
          <div className="panel-title"><span>Capes</span></div>
          <div className="cape-list">
            {profile?.capes.map((item) => (
              <button key={item.id} className={item.state === 'active' ? 'active' : ''} onClick={() => cape(item.id)} disabled={Boolean(action)} aria-pressed={item.state === 'active'}>
                <div className="cape-texture">{item.url ? <img src={cacheBustedImage(item.url, revision)} alt="" loading="lazy" decoding="async" /> : <Image />}</div>
                <span><strong>{item.alias}</strong><small>{item.state === 'active' ? 'Equipped' : 'Equip cape'}</small></span>
                {action === item.id ? <RefreshCw className="spin" /> : item.state === 'active' ? <Check /> : <ChevronRight />}
              </button>
            ))}
          </div>
          {!loading && !profile?.capes.length && <div className="empty-compact"><Image /><h3>No capes found</h3><p>Capes you own will appear here.</p></div>}
          {action && !action.startsWith('skin-') && <div className="cosmetic-action-status cape-action-status" role="status" aria-live="polite"><RefreshCw className="spin" size={13} /><span>{action === 'hide' ? 'Hiding cape…' : 'Equipping cape…'}</span></div>}
          {Boolean(profile?.capes.length) && <button className="secondary hide-cape" disabled={Boolean(action) || !activeCape} onClick={() => cape(undefined)}>{action === 'hide' ? <RefreshCw className="spin" /> : <X />} Hide cape</button>}
        </section>
      </div>
    </div>
  )
}

function SettingsView({ settings, setSettings, update, version, clientVersion, discordConfigured, notify }: {
  settings: SettingsData
  setSettings: (settings: SettingsData) => void
  update: any
  version: string
  clientVersion: string
  discordConfigured: boolean
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

  const jump = (id: string) => document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const sections = [
    { id: 'performance', label: 'Performance', icon: SlidersHorizontal },
    { id: 'window', label: 'Game window', icon: Monitor },
    { id: 'launch', label: 'Launch', icon: TerminalSquare },
    { id: 'updates', label: 'Updates', icon: RefreshCw },
    { id: 'protection', label: 'Protection', icon: ShieldCheck },
    { id: 'java', label: 'Java', icon: HardDrive }
  ]
  const commitMemory = () => void patch({ memoryMin: draft.memoryMin, memoryMax: draft.memoryMax })
  const commitWindow = () => void patch({ width: draft.width, height: draft.height })

  return (
    <div className="page">
      <PageHeading title="Settings" />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map((entry) => <button key={entry.id} onClick={() => jump(entry.id)}><entry.icon size={16} />{entry.label}</button>)}
        </nav>
        <div className="settings-body">
        <section className="settings-section" id="settings-performance">
          <div className="settings-title"><SlidersHorizontal /><div><h3>Performance</h3></div></div>
          <div className="setting-row"><div><strong>Maximum memory</strong><small>{(draft.memoryMax / 1024).toFixed(1)} GB</small></div><input type="range" min="2048" max="32768" step="512" value={draft.memoryMax} onChange={(event) => setDraft({ ...draft, memoryMax: Number(event.target.value) })} onPointerUp={commitMemory} onKeyUp={commitMemory} /></div>
          <div className="setting-row"><div><strong>Minimum memory</strong><small>{(draft.memoryMin / 1024).toFixed(1)} GB</small></div><input type="range" min="512" max={Math.max(1024, draft.memoryMax - 512)} step="512" value={draft.memoryMin} onChange={(event) => setDraft({ ...draft, memoryMin: Number(event.target.value) })} onPointerUp={commitMemory} onKeyUp={commitMemory} /></div>
          <div className="settings-hint"><Cpu size={14} /><span>4–8 GB suits most modded instances.</span></div>
        </section>

        <section className="settings-section" id="settings-window">
          <div className="settings-title"><Monitor /><div><h3>Game window</h3></div></div>
          <div className="two-inputs">
            <label>Width<input type="number" min="640" max="7680" value={draft.width} onChange={(event) => setDraft({ ...draft, width: Number(event.target.value) })} onBlur={commitWindow} /></label>
            <label>Height<input type="number" min="360" max="4320" value={draft.height} onChange={(event) => setDraft({ ...draft, height: Number(event.target.value) })} onBlur={commitWindow} /></label>
          </div>
          <SettingToggle title="Start in fullscreen" description="Launch Minecraft in fullscreen." checked={draft.fullscreen} onChange={(value) => patch({ fullscreen: value })} />
        </section>

        <section className="settings-section" id="settings-launch">
          <div className="settings-title"><TerminalSquare /><div><h3>Launch</h3></div></div>
          <SettingToggle title="Open launch console" description="Show a live log window while playing." checked={draft.showConsole} onChange={(value) => patch({ showConsole: value })} />
          <SettingToggle title="Move launcher to tray while playing" description="Hide MegaClient while Minecraft runs." checked={draft.minimizeToTrayOnLaunch} onChange={(value) => patch({ minimizeToTrayOnLaunch: value })} />
          <SettingToggle title="Discord activity status" description={discordConfigured ? 'Show what you’re playing on Discord.' : 'Needs a Discord application ID.'} checked={draft.discordActivity} onChange={(value) => patch({ discordActivity: value })} />
          <SettingToggle title="Reduce interface motion" description="Cut non-essential movement." checked={draft.reducedMotion} onChange={(value) => patch({ reducedMotion: value })} />
        </section>

        <section className="settings-section" id="settings-updates">
          <div className="settings-title"><RefreshCw /><div><h3>Updates</h3></div></div>
          <div className="version-summary"><span><small>Launcher</small><strong>v{version}</strong></span><span><small>Built-in client</small><strong>v{clientVersion}</strong></span><span><small>Minecraft</small><strong>26.2 / 26.3</strong></span></div>
          <SettingToggle title="Automatic update checks" description="Download updates in the background." checked={draft.checkUpdates} onChange={(value) => patch({ checkUpdates: value })} />
          <SettingToggle title="Show snapshots" description="Include snapshots in version lists." checked={draft.showSnapshots} onChange={(value) => patch({ showSnapshots: value })} />
          <div className="update-row update-status-row">
            <span>
              <strong>{update?.pausedForGame ? (update?.state === 'available' ? `Version ${update.version} will download after Minecraft closes` : 'Update activity paused while Minecraft is running') : update?.state === 'checking' ? 'Checking automatically…' : update?.state === 'downloading' ? `Downloading update · ${Math.round(update.percent ?? 0)}%${updateTransferLabel(update) ? ` · ${updateTransferLabel(update)}` : ''}` : update?.state === 'ready' ? `Version ${update.version} is ready` : update?.state === 'current' ? 'MegaClient is up to date' : update?.state === 'offline' ? 'Waiting for an internet connection' : update?.state === 'error' ? (update.message ?? 'The last update scan could not finish') : 'Automatic update scanning is ready'}</strong>
              <small>{update?.checkedAt
                ? `Last scan ${new Date(update.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${update?.nextCheckAt && draft.checkUpdates ? ` · Next ${new Date(update.nextCheckAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`
                : draft.checkUpdates ? 'The first scan starts shortly after launch.' : 'Automatic scans are currently disabled.'}</small>
            </span>
            <button className="secondary" disabled={update?.state === 'checking' || update?.state === 'downloading'} onClick={async () => { await window.mega.app.checkUpdates(); notify('Update scan started.', 'success') }}><RefreshCw className={update?.state === 'checking' ? 'spin' : ''} /> Scan now</button>
          </div>
        </section>

        <section className="settings-section full security-locked compact-security" id="settings-protection">
          <div className="settings-title"><ShieldCheck /><div><h3>Launch protection</h3><p>Checked automatically on every launch.</p></div><span className="always-on"><Lock size={12} /> Always on</span></div>
        </section>

        <section className="settings-section full" id="settings-java">
          <div className="settings-title"><HardDrive /><div><h3>Java</h3><p>Installed automatically for each Minecraft version.</p></div></div>
          <div className="segmented java-mode"><button className={draft.javaMode === 'auto' ? 'active' : ''} onClick={() => patch({ javaMode: 'auto' })}>Automatic</button><button className={draft.javaMode === 'manual' ? 'active' : ''} onClick={() => patch({ javaMode: 'manual' })}>Custom path</button></div>
          {draft.javaMode === 'manual' && <label className="wide-label">Java executable path<input value={draft.javaPath} onChange={(event) => setDraft({ ...draft, javaPath: event.target.value })} onBlur={() => patch({ javaPath: draft.javaPath })} placeholder="C:\Program Files\Java\bin\javaw.exe" /></label>}
        </section>
        </div>
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
