import type {
  AccountSummary,
  BootstrapPayload,
  ConsoleLine,
  CreateInstanceRequest,
  GameStatus,
  InstallContentRequest,
  InstalledContent,
  InstanceProfile,
  JavaRuntime,
  LaunchRequest,
  LauncherSettings,
  ModrinthProject,
  ModrinthVersion,
  PartneredServer,
  SearchRequest,
  SkinProfile,
  VersionManifest
} from './types'

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return mockInvoke<T>(command, args)
  const api = await import('@tauri-apps/api/core')
  return api.invoke<T>(command, args)
}

export const launcherApi = {
  bootstrap: () => invoke<BootstrapPayload>('bootstrap'),
  getSettings: () => invoke<LauncherSettings>('get_settings'),
  saveSettings: (settings: LauncherSettings) => invoke<LauncherSettings>('save_settings', { settings }),

  signInMicrosoft: () => invoke<AccountSummary>('sign_in_microsoft'),
  listAccounts: () => invoke<AccountSummary[]>('list_accounts'),
  restoreActiveAccount: () => invoke<AccountSummary>('restore_active_account'),
  switchAccount: (accountId: string) => invoke<AccountSummary[]>('switch_account', { accountId }),
  removeAccount: (accountId: string) => invoke<AccountSummary[]>('remove_account', { accountId }),

  getVersionManifest: () => invoke<VersionManifest>('get_version_manifest'),
  installVersion: (instanceId: string) => invoke<boolean>('install_version', { instanceId }),
  deleteVersion: (versionId: string) => invoke<boolean>('delete_version', { versionId }),

  listInstances: () => invoke<InstanceProfile[]>('list_instances'),
  createInstance: (request: CreateInstanceRequest) => invoke<InstanceProfile>('create_instance', { request }),
  updateInstance: (instance: InstanceProfile) => invoke<InstanceProfile>('update_instance', { instance }),
  duplicateInstance: (instanceId: string) => invoke<InstanceProfile>('duplicate_instance', { instanceId }),
  deleteInstance: (instanceId: string) => invoke<boolean>('delete_instance', { instanceId }),

  launch: (request: LaunchRequest) => invoke<boolean>('launch_game', { request }),
  kill: () => invoke<boolean>('kill_game'),
  status: () => invoke<GameStatus>('game_status'),
  console: () => invoke<ConsoleLine[]>('get_console_lines'),

  detectJava: (minecraftVersion?: string) => invoke<JavaRuntime[]>('detect_java', { minecraftVersion }),
  installJava: (major: number) => invoke<JavaRuntime>('install_java', { major }),

  search: (request: SearchRequest) => invoke<ModrinthProject[]>('search_modrinth', { request }),
  projectVersions: (projectId: string, minecraftVersion?: string, loader?: string) =>
    invoke<ModrinthVersion[]>('get_project_versions', { projectId, minecraftVersion, loader }),
  installContent: (request: InstallContentRequest) => invoke<boolean>('install_content', { request }),
  listContent: (instanceId: string, kind?: string) => invoke<InstalledContent[]>('list_content', { instanceId, kind }),
  toggleContent: (instanceId: string, contentId: string, enabled: boolean) =>
    invoke<boolean>('toggle_content', { instanceId, contentId, enabled }),
  deleteContent: (instanceId: string, contentId: string) => invoke<boolean>('delete_content', { instanceId, contentId }),
  updateContent: (instanceId: string, contentId: string) => invoke<boolean>('update_content', { instanceId, contentId }),

  partneredServers: () => invoke<PartneredServer[]>('list_partnered_servers'),


  skinProfile: () => invoke<SkinProfile>('get_skin_profile'),
  uploadSkin: (path: string, variant: 'classic' | 'slim') => invoke<boolean>('upload_skin', { path, variant }),
  resetSkin: () => invoke<boolean>('reset_skin'),
  setCape: (capeId?: string) => invoke<boolean>('set_cape', { capeId })
}

export async function listenToLauncherEvents(handlers: {
  progress?: (payload: unknown) => void
  console?: (payload: unknown) => void
  status?: (payload: unknown) => void
}): Promise<() => void> {
  if (!isTauri()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  const unlisteners = await Promise.all([
    handlers.progress ? listen('launcher://progress', event => handlers.progress?.(event.payload)) : Promise.resolve(() => undefined),
    handlers.console ? listen('launcher://console', event => handlers.console?.(event.payload)) : Promise.resolve(() => undefined),
    handlers.status ? listen('launcher://status', event => handlers.status?.(event.payload)) : Promise.resolve(() => undefined)
  ])
  return () => unlisteners.forEach(unlisten => unlisten())
}

export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return defaultPath ?? null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, defaultPath })
  return typeof selected === 'string' ? selected : null
}

export async function pickPng(defaultPath?: string): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ multiple: false, defaultPath, filters: [{ name: 'PNG skin', extensions: ['png'] }] })
  return typeof selected === 'string' ? selected : null
}

export async function openPath(path: string): Promise<void> {
  if (!isTauri()) return
  const { openPath } = await import('@tauri-apps/plugin-opener')
  await openPath(path)
}

export async function openUrl(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(url)
}

const mockInstances: InstanceProfile[] = [
  {
    id: 'balanced-1211',
    name: 'Balanced 1.21.1',
    minecraftVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: 'latest',
    directory: '~/.megaclient/instances/balanced-1211',
    lastPlayedAt: new Date(Date.now() - 1000 * 60 * 32).toISOString(),
    playTimeSeconds: 11820,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
    favorite: true
  },
  {
    id: 'vanilla-latest',
    name: 'Vanilla Latest',
    minecraftVersion: '1.21.1',
    loader: 'vanilla',
    directory: '~/.megaclient/instances/vanilla-latest',
    lastPlayedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    playTimeSeconds: 2640,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 24).toISOString(),
    favorite: false
  }
]

const defaultSettings: LauncherSettings = {
  gameDirectory: '~/.megaclient',
  javaPath: '',
  minRamMb: 1024,
  maxRamMb: 4096,
  width: 1280,
  height: 720,
  minimizeWhilePlaying: true,
  reducedMotion: false,
  compactNavigation: false,
  showSnapshots: false,
  showConsoleOnLaunch: true,
  selectedInstanceId: mockInstances[0].id,
  autoCheckUpdates: true,
  autoDownloadUpdates: false
}


async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  await new Promise(resolve => setTimeout(resolve, command === 'bootstrap' ? 180 : 70))
  switch (command) {
    case 'bootstrap': {
      const showLoginPreview = new URLSearchParams(window.location.search).get('login') === '1'
      return {
        settings: defaultSettings,
        accounts: showLoginPreview ? [] : [{ id: 'demo', name: 'MegaPlayer', avatarUrl: 'https://mc-heads.net/avatar/Steve/80', active: true }],
        instances: mockInstances,
        versions: { latestRelease: '1.21.1', latestSnapshot: '25w20a', versions: [] },
        javaRuntimes: [{ path: '/managed/java-21/bin/java', major: 21, vendor: 'Eclipse Temurin', managed: true, recommended: true }],
        gameStatus: { state: 'idle' },
        platform: 'preview',
        appVersion: '2.3.2',
        authConfigured: !showLoginPreview
      } as T
    }
    case 'sign_in_microsoft': return { id: 'demo', name: 'MegaPlayer', avatarUrl: 'https://mc-heads.net/avatar/Steve/80', active: true } as T
    case 'restore_active_account': return { id: 'demo', name: 'MegaPlayer', avatarUrl: 'https://mc-heads.net/avatar/Steve/80', active: true } as T
    case 'list_accounts': return [{ id: 'demo', name: 'MegaPlayer', avatarUrl: 'https://mc-heads.net/avatar/Steve/80', active: true }] as T
    case 'list_instances': return mockInstances as T
    case 'get_settings': return defaultSettings as T
    case 'get_version_manifest': return { latestRelease: '1.21.1', latestSnapshot: '25w20a', versions: [] } as T
    case 'save_settings': return args?.settings as T
    case 'game_status': return { state: 'idle' } as T
    case 'get_console_lines': return [
      { level: 'info', text: 'MegaClient Rust core ready.', timestamp: new Date().toISOString() },
      { level: 'info', text: 'No game process is currently running.', timestamp: new Date().toISOString() }
    ] as T
    case 'search_modrinth': return [
      { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: 'A modern rendering engine for Minecraft.', author: 'CaffeineMC', projectType: 'mod', downloads: 187000000, follows: 800000, categories: ['optimization', 'fabric'], gameVersions: ['1.21.1'], loaders: ['fabric'], updatedAt: new Date().toISOString() },
      { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', description: 'General-purpose optimization without changing vanilla behavior.', author: 'CaffeineMC', projectType: 'mod', downloads: 125000000, follows: 560000, categories: ['optimization'], gameVersions: ['1.21.1'], loaders: ['fabric'], updatedAt: new Date().toISOString() },
      { id: '5ZwdcRci', slug: 'immediatelyfast', title: 'ImmediatelyFast', description: 'Optimizes immediate mode rendering and GUI drawing.', author: 'RaphiMC', projectType: 'mod', downloads: 44000000, follows: 170000, categories: ['optimization'], gameVersions: ['1.21.1'], loaders: ['fabric'], updatedAt: new Date().toISOString() }
    ] as T
    case 'get_project_versions': return [
      { id: 'demo-latest', projectId: String(args?.projectId ?? 'demo'), name: 'Latest compatible release', versionNumber: '1.0.0', gameVersions: ['1.21.1'], loaders: ['fabric'], publishedAt: new Date().toISOString(), featured: true },
      { id: 'demo-previous', projectId: String(args?.projectId ?? 'demo'), name: 'Previous release', versionNumber: '0.9.0', gameVersions: ['1.21.1'], loaders: ['fabric'], publishedAt: new Date(Date.now() - 86400000 * 14).toISOString(), featured: false }
    ] as T
    case 'list_content': return [] as T
    case 'list_partnered_servers': return [{ id: 'skylabs', name: 'Skylabs', address: 'play.sky-labs.co.uk', online: true, motd: ['Welcome to Skylabs'], playersOnline: 24, playersMax: 200, version: 'Minecraft Java', checkedAt: new Date().toISOString() }] as T
    case 'get_skin_profile': return { id: 'demo', name: 'MegaPlayer', skinVariant: 'classic', capes: [] } as T
    case 'detect_java': return [{ path: '/managed/java-21/bin/java', major: 21, vendor: 'Eclipse Temurin', managed: true, recommended: true }] as T
    default: return true as T
  }
}
