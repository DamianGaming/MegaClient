import type { Account } from 'eml-lib'

export type LoaderType = 'vanilla' | 'forge' | 'neoforge' | 'fabric'

export interface LauncherInstance {
  id: string
  name: string
  slug: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion?: string
  icon?: string
  createdAt: string
  updatedAt: string
  lastPlayedAt?: string
  customClient: boolean
  modpack?: { projectId: string; versionId: string; title: string }
}


export type ImportSourceKind = 'curseforge' | 'modrinth' | 'lunar' | 'prism' | 'minecraft' | 'generic'

export interface ImportSourcePreview {
  sourcePath: string
  kind: ImportSourceKind
  sourceLabel: string
  name: string
  minecraftVersion?: string
  loader?: LoaderType
  loaderVersion?: string
  unsupportedLoader?: string
  content: { mods: number; resourcePacks: number; shaders: number; worlds: number; configurationFiles: number; otherFiles: number }
  warnings: string[]
  referencedRemoteMods?: number
  contentRoot?: string
}

export interface ImportRequest {
  sourcePath: string
  mode: 'new' | 'existing'
  instanceId?: string
  name?: string
  minecraftVersion?: string
  loader?: LoaderType
  loaderVersion?: string
}

export interface ImportResult {
  instance: LauncherInstance
  copiedFiles: number
  skippedFiles: number
  warnings: string[]
}

export interface ImportProgress { message: string; progress?: number }

export interface LauncherSettings {
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

export interface StoredData {
  settings: LauncherSettings
  instances: LauncherInstance[]
  selectedInstanceId?: string
}

export interface PublicAccount {
  name: string
  uuid: string
  avatarUrl: string
  xboxGamertag?: string
}

export interface LaunchProgress {
  phase: string
  message: string
  progress?: number
  downloaded?: number
  total?: number
  speed?: number
}

export interface TrackedMod {
  projectId?: string
  versionId?: string
  title: string
  fileName: string
  enabled: boolean
  versionNumber?: string
  iconUrl?: string
  installedAt?: string
  source?: 'modrinth' | 'local' | 'client'
}

export interface AccountEnvelope {
  encrypted: boolean
  value: string
}

export interface MinecraftProfileSkin {
  id: string
  url: string
  state: 'active' | 'inactive'
  variant: 'classic' | 'slim'
}

export interface MinecraftProfileCape {
  id: string
  url: string
  state: 'active' | 'inactive'
  alias: string
}

export interface MinecraftProfileData {
  skins: MinecraftProfileSkin[]
  capes: MinecraftProfileCape[]
  revision: number
}

export type AuthenticatedAccount = Account

export type DiscoverContentType = 'mod' | 'modpack' | 'resourcepack' | 'shader'

export interface TrackedPack {
  projectId?: string
  versionId?: string
  title: string
  fileName: string
  enabled: boolean
  versionNumber?: string
  iconUrl?: string
  installedAt?: string
  contentType: 'resourcepack' | 'shader'
  source: 'modrinth' | 'local'
}

export interface WorldSummary {
  id: string
  name: string
  folderName: string
  modifiedAt: string
}
