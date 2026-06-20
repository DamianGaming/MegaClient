export type LoaderKind = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'
export type ContentKind = 'mod' | 'modpack' | 'resourcepack' | 'shader'
export type RouteKey = 'home' | 'library' | 'discover' | 'servers' | 'skins' | 'settings'

export interface AccountSummary {
  id: string
  name: string
  avatarUrl: string
  active: boolean
  expiresAt?: string
}

export interface LauncherSettings {
  gameDirectory: string
  javaPath: string
  minRamMb: number
  maxRamMb: number
  width: number
  height: number
  minimizeWhilePlaying: boolean
  reducedMotion: boolean
  compactNavigation: boolean
  showSnapshots: boolean
  showConsoleOnLaunch: boolean
  selectedInstanceId: string
  autoCheckUpdates: boolean
  autoDownloadUpdates: boolean
}


export type LauncherUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'disabled'

export interface LauncherUpdateState {
  state: LauncherUpdateStatus
  currentVersion: string
  version: string
  notes: string
  date?: string
  percent: number
  downloadedBytes: number
  totalBytes: number
  bytesPerSecond: number
  checkedAt?: string
  message?: string
}

export interface InstanceProfile {
  id: string
  name: string
  minecraftVersion: string
  loader: LoaderKind
  loaderVersion?: string
  directory: string
  iconUrl?: string
  lastPlayedAt?: string
  playTimeSeconds: number
  createdAt: string
  favorite: boolean
}

export interface VersionEntry {
  id: string
  kind: string
  releaseTime: string
  installed: boolean
}

export interface VersionManifest {
  latestRelease: string
  latestSnapshot: string
  versions: VersionEntry[]
}

export interface JavaRuntime {
  path: string
  major: number
  vendor: string
  managed: boolean
  recommended: boolean
}

export interface GameStatus {
  state: 'idle' | 'installing' | 'launching' | 'running' | 'stopping' | 'closed' | 'error'
  instanceId?: string
  pid?: number
  startedAt?: string
  message?: string
}

export interface ProgressEvent {
  id: string
  kind: 'version' | 'content' | 'java' | 'launch' | 'update'
  label: string
  detail: string
  percent: number
  bytesPerSecond: number
  done: boolean
}

export interface ConsoleLine {
  level: 'info' | 'warn' | 'error'
  text: string
  timestamp: string
}

export interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  projectType: ContentKind
  downloads: number
  follows: number
  categories: string[]
  gameVersions: string[]
  loaders: string[]
  updatedAt: string
}

export interface ModrinthVersion {
  id: string
  projectId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  publishedAt: string
  featured: boolean
}

export interface SearchRequest {
  query: string
  projectType: ContentKind
  gameVersion?: string
  loader?: LoaderKind
  category?: string
  offset?: number
  limit?: number
}

export interface InstalledContent {
  id: string
  projectId?: string
  versionId?: string
  name: string
  fileName: string
  kind: ContentKind
  enabled: boolean
  sizeBytes: number
  versionNumber?: string
  iconUrl?: string
  installedAt: string
  updateAvailable: boolean
  dependency: boolean
}

export interface InstallContentRequest {
  instanceId: string
  projectId: string
  versionId?: string
  kind: ContentKind
}


export interface SkinProfile {
  id: string
  name: string
  skinUrl?: string
  skinVariant: 'classic' | 'slim'
  capes: Array<{ id: string; alias: string; url: string; active: boolean }>
}

export interface BootstrapPayload {
  settings: LauncherSettings
  accounts: AccountSummary[]
  instances: InstanceProfile[]
  versions: VersionManifest
  javaRuntimes: JavaRuntime[]
  gameStatus: GameStatus
  platform: string
  appVersion: string
  authConfigured: boolean
}

export interface CreateInstanceRequest {
  name: string
  minecraftVersion: string
  loader: LoaderKind
  loaderVersion?: string
}


export interface PartneredServer {
  id: string
  name: string
  address: string
  online: boolean
  motd: string[]
  iconUrl?: string
  playersOnline: number
  playersMax: number
  version?: string
  checkedAt: string
}

export interface LaunchRequest {
  instanceId: string
  server?: string
  port?: number
}
