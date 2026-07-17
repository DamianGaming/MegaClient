import fs from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { DiscoverContentType, LauncherInstance, TrackedMod, TrackedPack } from '../types'
import { getInstance, updateInstance } from './instances'
import {
  instanceDirectory,
  metadataDirectory,
  modsDirectory,
  resourcePacksDirectory,
  shaderPacksDirectory
} from './paths'
import { downloadFile, fetchJson, hashFile } from './net'

interface SearchHit {
  project_id: string
  project_type: DiscoverContentType
  slug: string
  author: string
  title: string
  description: string
  categories: string[]
  versions: string[]
  downloads: number
  icon_url?: string
  date_modified: string
}

interface SearchResponse { hits: SearchHit[]; offset: number; limit: number; total_hits: number }

interface ModrinthFile {
  hashes: { sha1?: string; sha512?: string }
  url: string
  filename: string
  primary: boolean
  size: number
  file_type?: string
}

interface ModrinthDependency {
  version_id?: string | null
  project_id?: string | null
  file_name?: string | null
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded'
}

interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  version_type: 'release' | 'beta' | 'alpha'
  game_versions: string[]
  loaders: string[]
  date_published: string
  downloads: number
  files: ModrinthFile[]
  dependencies: ModrinthDependency[]
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  icon_url?: string
  project_type: DiscoverContentType
}

interface ModpackIndex {
  formatVersion: number
  game: 'minecraft'
  versionId: string
  name: string
  summary?: string
  files: Array<{
    path: string
    hashes: { sha1?: string; sha512?: string }
    env?: { client?: 'required' | 'optional' | 'unsupported'; server?: string }
    downloads: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>
}

interface ModMetadataFile { mods: TrackedMod[] }
interface PackMetadataFile { packs: TrackedPack[] }

const searchCache = new Map<string, { value: SearchResponse; expires: number }>()
const projectCache = new Map<string, { value: ModrinthProject; expires: number }>()
const versionsCache = new Map<string, { value: ModrinthVersion[]; expires: number }>()
const installLocks = new Map<string, Promise<unknown>>()

function stateFile(instance: LauncherInstance): string {
  return path.join(metadataDirectory(instance.slug), 'mods.json')
}

function packStateFile(instance: LauncherInstance): string {
  return path.join(metadataDirectory(instance.slug), 'packs.json')
}

async function readState(instance: LauncherInstance): Promise<ModMetadataFile> {
  try { return JSON.parse(await fs.readFile(stateFile(instance), 'utf8')) as ModMetadataFile }
  catch { return { mods: [] } }
}

async function writeState(instance: LauncherInstance, state: ModMetadataFile): Promise<void> {
  await fs.mkdir(metadataDirectory(instance.slug), { recursive: true })
  await fs.writeFile(stateFile(instance), JSON.stringify(state, null, 2), 'utf8')
}

async function readPackState(instance: LauncherInstance): Promise<PackMetadataFile> {
  try { return JSON.parse(await fs.readFile(packStateFile(instance), 'utf8')) as PackMetadataFile }
  catch { return { packs: [] } }
}

async function writePackState(instance: LauncherInstance, state: PackMetadataFile): Promise<void> {
  await fs.mkdir(metadataDirectory(instance.slug), { recursive: true })
  await fs.writeFile(packStateFile(instance), JSON.stringify(state, null, 2), 'utf8')
}

function compatibleLoaders(instance: LauncherInstance): string[] {
  if (instance.customClient) return ['fabric']
  return instance.loader === 'vanilla' ? [] : [instance.loader]
}

function packDirectory(instance: LauncherInstance, type: TrackedPack['contentType']): string {
  return type === 'resourcepack' ? resourcePacksDirectory(instance.slug) : shaderPacksDirectory(instance.slug)
}

export async function searchContent(input: {
  query: string
  type: DiscoverContentType
  instanceId?: string
  offset?: number
}): Promise<SearchResponse> {
  const facets: string[][] = [[`project_type:${input.type}`]]
  if (input.instanceId) {
    const instance = getInstance(input.instanceId)
    facets.push([`versions:${instance.minecraftVersion}`])
    const loaders = compatibleLoaders(instance)
    if (input.type === 'mod' && loaders.length) facets.push(loaders.map((loader) => `categories:${loader}`))
  }
  const url = new URL('https://api.modrinth.com/v2/search')
  url.searchParams.set('query', input.query.trim())
  url.searchParams.set('limit', '30')
  url.searchParams.set('offset', String(input.offset ?? 0))
  url.searchParams.set('index', input.query.trim() ? 'relevance' : 'downloads')
  url.searchParams.set('facets', JSON.stringify(facets))

  const cacheKey = url.toString()
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.value
  const value = await fetchJson<SearchResponse>(cacheKey)
  searchCache.set(cacheKey, { value, expires: Date.now() + 45_000 })
  if (searchCache.size > 80) {
    for (const [key, entry] of searchCache) {
      if (entry.expires <= Date.now() || searchCache.size > 60) searchCache.delete(key)
    }
  }
  return value
}

async function project(projectId: string): Promise<ModrinthProject> {
  const cached = projectCache.get(projectId)
  if (cached && cached.expires > Date.now()) return cached.value
  const value = await fetchJson<ModrinthProject>(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}`)
  projectCache.set(projectId, { value, expires: Date.now() + 10 * 60_000 })
  return value
}

function sortVersions(versions: ModrinthVersion[]): ModrinthVersion[] {
  return versions.sort((a, b) => {
    const rank = { release: 3, beta: 2, alpha: 1 }
    return rank[b.version_type] - rank[a.version_type] || Date.parse(b.date_published) - Date.parse(a.date_published)
  })
}

async function versionsFor(projectId: string, instance: LauncherInstance, type: DiscoverContentType = 'mod'): Promise<ModrinthVersion[]> {
  const cacheKey = `${projectId}:${instance.minecraftVersion}:${instance.loader}:${type}`
  const cached = versionsCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.value

  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`)
  url.searchParams.set('game_versions', JSON.stringify([instance.minecraftVersion]))
  if (type === 'mod') {
    const loaders = compatibleLoaders(instance)
    if (loaders.length) url.searchParams.set('loaders', JSON.stringify(loaders))
  } else if (type === 'resourcepack') {
    url.searchParams.set('loaders', JSON.stringify(['minecraft']))
  }
  const value = sortVersions(await fetchJson<ModrinthVersion[]>(url.toString()))
  versionsCache.set(cacheKey, { value, expires: Date.now() + 5 * 60_000 })
  return value
}

async function getVersion(versionId: string): Promise<ModrinthVersion> {
  return fetchJson<ModrinthVersion>(`https://api.modrinth.com/v2/version/${encodeURIComponent(versionId)}`)
}

function versionSupportsInstance(version: ModrinthVersion, instance: LauncherInstance, type: DiscoverContentType): boolean {
  if (!version.game_versions.includes(instance.minecraftVersion)) return false
  if (type !== 'mod') return true
  const loaders = compatibleLoaders(instance)
  return !loaders.length || loaders.some((loader) => version.loaders.includes(loader))
}

function bestFile(version: ModrinthVersion, extension?: string): ModrinthFile {
  const candidates = extension ? version.files.filter((file) => file.filename.toLowerCase().endsWith(extension)) : version.files
  const file = candidates.find((item) => item.primary) ?? candidates[0]
  if (!file) throw new Error('This Modrinth version has no downloadable file.')
  return file
}

async function resolveDependencyVersion(dependency: ModrinthDependency, instance: LauncherInstance): Promise<{ version: ModrinthVersion; project: ModrinthProject } | null> {
  let dependencyProject: ModrinthProject | undefined
  let dependencyVersion: ModrinthVersion | undefined

  if (dependency.version_id) {
    const exact = await getVersion(dependency.version_id)
    dependencyProject = await project(exact.project_id)
    // Some publishers leave an older exact dependency version attached while a
    // newer compatible build exists. Prefer the exact version when it really
    // supports this instance, otherwise resolve a compatible project version.
    if (versionSupportsInstance(exact, instance, dependencyProject.project_type)) dependencyVersion = exact
  }

  const projectId = dependency.project_id ?? dependencyProject?.id
  if (!dependencyVersion && projectId) {
    dependencyProject ??= await project(projectId)
    dependencyVersion = (await versionsFor(projectId, instance, dependencyProject.project_type))[0]
  }

  if (!dependencyVersion || !dependencyProject) return null
  return { version: dependencyVersion, project: dependencyProject }
}

async function installDependencies(
  instance: LauncherInstance,
  version: ModrinthVersion,
  visited: Set<string>,
  onProgress?: (message: string, progress?: number) => void
): Promise<void> {
  for (const dependency of version.dependencies.filter((item) => item.dependency_type === 'required')) {
    const resolved = await resolveDependencyVersion(dependency, instance)
    if (!resolved) throw new Error('A required Modrinth dependency has no compatible version for this instance.')
    if (resolved.project.project_type === 'mod') {
      if (instance.loader === 'vanilla') {
        throw new Error(`${resolved.project.title} requires a mod loader. Use a Fabric, Forge or NeoForge instance.`)
      }
      await installModVersion(instance, resolved.version, resolved.project, visited, onProgress)
    } else if (resolved.project.project_type === 'resourcepack' || resolved.project.project_type === 'shader') {
      await installPackVersion(instance, resolved.version, resolved.project, visited, onProgress)
    }
  }
}

async function installModVersion(
  instance: LauncherInstance,
  version: ModrinthVersion,
  info: ModrinthProject,
  visited: Set<string>,
  onProgress?: (message: string, progress?: number) => void
): Promise<TrackedMod> {
  if (visited.has(version.id)) {
    const state = await readState(instance)
    return state.mods.find((mod) => mod.versionId === version.id) ?? {
      projectId: version.project_id, versionId: version.id, title: info.title, fileName: '', enabled: true,
      versionNumber: version.version_number, iconUrl: info.icon_url, source: 'modrinth'
    }
  }
  visited.add(version.id)

  const existingState = await readState(instance)
  const existing = existingState.mods.find((mod) => mod.projectId === version.project_id && mod.versionId === version.id)
  if (existing) {
    const base = path.join(modsDirectory(instance.slug), existing.fileName)
    try { await fs.access(existing.enabled ? base : `${base}.disabled`); return existing } catch { /* reinstall */ }
  }

  await installDependencies(instance, version, visited, onProgress)
  const file = bestFile(version, '.jar')
  const directory = modsDirectory(instance.slug)
  const target = path.join(directory, file.filename)
  await fs.mkdir(directory, { recursive: true })
  onProgress?.(`Downloading ${info.title}`)
  await downloadFile(file.url, target, (downloaded, total) => onProgress?.(`Downloading ${info.title}`, total ? downloaded / total : undefined))
  if (file.hashes.sha512 && await hashFile(target, 'sha512') !== file.hashes.sha512) {
    await fs.rm(target, { force: true })
    throw new Error(`The downloaded file for ${info.title} failed its integrity check.`)
  }

  const tracked: TrackedMod = {
    projectId: version.project_id, versionId: version.id, title: info.title, fileName: file.filename,
    enabled: true, versionNumber: version.version_number, iconUrl: info.icon_url,
    installedAt: new Date().toISOString(), source: 'modrinth'
  }
  const state = await readState(instance)
  const old = state.mods.find((mod) => mod.projectId === tracked.projectId)
  if (old?.fileName && old.fileName !== tracked.fileName) {
    await Promise.all([
      fs.rm(path.join(directory, old.fileName), { force: true }),
      fs.rm(path.join(directory, `${old.fileName}.disabled`), { force: true })
    ])
  }
  state.mods = [...state.mods.filter((mod) => mod.projectId !== tracked.projectId), tracked]
  await writeState(instance, state)
  return tracked
}

async function installPackVersion(
  instance: LauncherInstance,
  version: ModrinthVersion,
  info: ModrinthProject,
  visited: Set<string>,
  onProgress?: (message: string, progress?: number) => void
): Promise<TrackedPack> {
  if (info.project_type !== 'resourcepack' && info.project_type !== 'shader') {
    throw new Error(`${info.title} is not a resource pack or shader pack.`)
  }
  if (visited.has(version.id)) {
    const state = await readPackState(instance)
    return state.packs.find((item) => item.versionId === version.id) ?? {
      projectId: version.project_id, versionId: version.id, title: info.title, fileName: '', enabled: true,
      versionNumber: version.version_number, iconUrl: info.icon_url, contentType: info.project_type, source: 'modrinth'
    }
  }
  visited.add(version.id)
  await installDependencies(instance, version, visited, onProgress)

  const file = bestFile(version, '.zip')
  const directory = packDirectory(instance, info.project_type)
  const target = path.join(directory, file.filename)
  await fs.mkdir(directory, { recursive: true })
  onProgress?.(`Downloading ${info.title}`)
  await downloadFile(file.url, target, (downloaded, total) => onProgress?.(`Downloading ${info.title}`, total ? downloaded / total : undefined))
  if (file.hashes.sha512 && await hashFile(target, 'sha512') !== file.hashes.sha512) {
    await fs.rm(target, { force: true })
    throw new Error(`The downloaded file for ${info.title} failed its integrity check.`)
  }

  const tracked: TrackedPack = {
    projectId: version.project_id, versionId: version.id, title: info.title, fileName: file.filename,
    enabled: true, versionNumber: version.version_number, iconUrl: info.icon_url,
    installedAt: new Date().toISOString(), contentType: info.project_type, source: 'modrinth'
  }
  const state = await readPackState(instance)
  const old = state.packs.find((item) => item.projectId === tracked.projectId)
  if (old?.fileName && old.fileName !== tracked.fileName) {
    const oldDirectory = packDirectory(instance, old.contentType)
    await Promise.all([
      fs.rm(path.join(oldDirectory, old.fileName), { force: true }),
      fs.rm(path.join(oldDirectory, `${old.fileName}.disabled`), { force: true })
    ])
  }
  state.packs = [...state.packs.filter((item) => item.projectId !== tracked.projectId), tracked]
  await writePackState(instance, state)
  return tracked
}

async function withInstallLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = installLocks.get(key)
  if (existing) return existing as Promise<T>
  const promise = task().finally(() => installLocks.delete(key))
  installLocks.set(key, promise)
  return promise
}

export async function installMod(instanceId: string, projectId: string, onProgress?: (message: string, progress?: number) => void): Promise<TrackedMod> {
  return withInstallLock(`mod:${instanceId}:${projectId}`, async () => {
    const instance = getInstance(instanceId)
    if (instance.loader === 'vanilla') throw new Error('Use a Fabric, Forge, or NeoForge instance to install mods.')
    const info = await project(projectId)
    const version = (await versionsFor(projectId, instance, 'mod'))[0]
    if (!version) throw new Error(`No compatible ${instance.loader} version is available for Minecraft ${instance.minecraftVersion}.`)
    return installModVersion(instance, version, info, new Set(), onProgress)
  })
}

export async function installPack(
  instanceId: string,
  projectId: string,
  contentType: TrackedPack['contentType'],
  onProgress?: (message: string, progress?: number) => void
): Promise<TrackedPack> {
  return withInstallLock(`${contentType}:${instanceId}:${projectId}`, async () => {
    const instance = getInstance(instanceId)
    const info = await project(projectId)
    if (info.project_type !== contentType) throw new Error(`This project is not a ${contentType === 'shader' ? 'shader pack' : 'resource pack'}.`)
    const version = (await versionsFor(projectId, instance, contentType))[0]
    if (!version) throw new Error(`No compatible version is available for Minecraft ${instance.minecraftVersion}.`)
    return installPackVersion(instance, version, info, new Set(), onProgress)
  })
}

export async function listMods(instanceId: string): Promise<TrackedMod[]> {
  const instance = getInstance(instanceId)
  const directory = modsDirectory(instance.slug)
  await fs.mkdir(directory, { recursive: true })
  const files = await fs.readdir(directory)
  const state = await readState(instance)
  const trackedByFile = new Map(state.mods.map((mod) => [mod.fileName, mod]))
  const mods: TrackedMod[] = []
  for (const file of files.filter((name) => !name.startsWith('mc-runtime-') && (name.endsWith('.jar') || name.endsWith('.jar.disabled')))) {
    const enabled = file.endsWith('.jar')
    const base = enabled ? file : file.slice(0, -'.disabled'.length)
    const tracked = trackedByFile.get(base)
    mods.push(tracked ? { ...tracked, enabled } : {
      title: base.replace(/\.jar$/i, ''), fileName: base, enabled, source: 'local'
    })
  }
  return mods.sort((a, b) => a.title.localeCompare(b.title))
}

export async function listPacks(instanceId: string, contentType?: TrackedPack['contentType']): Promise<TrackedPack[]> {
  const instance = getInstance(instanceId)
  const state = await readPackState(instance)
  const types: TrackedPack['contentType'][] = contentType ? [contentType] : ['resourcepack', 'shader']
  const packs: TrackedPack[] = []
  for (const type of types) {
    const directory = packDirectory(instance, type)
    await fs.mkdir(directory, { recursive: true })
    const files = await fs.readdir(directory)
    const trackedByFile = new Map(state.packs.filter((item) => item.contentType === type).map((item) => [item.fileName, item]))
    for (const file of files.filter((name) => name.endsWith('.zip') || name.endsWith('.zip.disabled'))) {
      const enabled = file.endsWith('.zip')
      const base = enabled ? file : file.slice(0, -'.disabled'.length)
      const tracked = trackedByFile.get(base)
      packs.push(tracked ? { ...tracked, enabled } : {
        title: base.replace(/\.zip$/i, ''), fileName: base, enabled, contentType: type, source: 'local'
      })
    }
  }
  return packs.sort((a, b) => a.title.localeCompare(b.title))
}

export async function setModEnabled(instanceId: string, fileName: string, enabled: boolean): Promise<void> {
  const instance = getInstance(instanceId)
  const enabledPath = path.join(modsDirectory(instance.slug), fileName)
  await fs.rename(enabled ? `${enabledPath}.disabled` : enabledPath, enabled ? enabledPath : `${enabledPath}.disabled`)
  const state = await readState(instance)
  state.mods = state.mods.map((mod) => mod.fileName === fileName ? { ...mod, enabled } : mod)
  await writeState(instance, state)
}

export async function setPackEnabled(instanceId: string, fileName: string, type: TrackedPack['contentType'], enabled: boolean): Promise<void> {
  const instance = getInstance(instanceId)
  const enabledPath = path.join(packDirectory(instance, type), fileName)
  await fs.rename(enabled ? `${enabledPath}.disabled` : enabledPath, enabled ? enabledPath : `${enabledPath}.disabled`)
  const state = await readPackState(instance)
  state.packs = state.packs.map((item) => item.fileName === fileName && item.contentType === type ? { ...item, enabled } : item)
  await writePackState(instance, state)
}

export async function removeMod(instanceId: string, fileName: string): Promise<void> {
  const instance = getInstance(instanceId)
  const base = path.join(modsDirectory(instance.slug), fileName)
  await Promise.all([fs.rm(base, { force: true }), fs.rm(`${base}.disabled`, { force: true })])
  const state = await readState(instance)
  state.mods = state.mods.filter((mod) => mod.fileName !== fileName)
  await writeState(instance, state)
}

export async function removePack(instanceId: string, fileName: string, type: TrackedPack['contentType']): Promise<void> {
  const instance = getInstance(instanceId)
  const base = path.join(packDirectory(instance, type), fileName)
  await Promise.all([fs.rm(base, { force: true }), fs.rm(`${base}.disabled`, { force: true })])
  const state = await readPackState(instance)
  state.packs = state.packs.filter((item) => item.fileName !== fileName || item.contentType !== type)
  await writePackState(instance, state)
}

export async function updateMod(instanceId: string, projectId: string, onProgress?: (message: string, progress?: number) => void): Promise<TrackedMod | null> {
  const instance = getInstance(instanceId)
  const state = await readState(instance)
  const current = state.mods.find((mod) => mod.projectId === projectId)
  const latest = (await versionsFor(projectId, instance, 'mod'))[0]
  if (!latest || latest.id === current?.versionId) return null
  const info = await project(projectId)
  const wasEnabled = current?.enabled ?? true
  const installed = await installModVersion(instance, latest, info, new Set(), onProgress)
  if (!wasEnabled) await setModEnabled(instanceId, installed.fileName, false)
  return { ...installed, enabled: wasEnabled }
}

export async function updateAllMods(instanceId: string, onProgress?: (message: string, progress?: number) => void): Promise<number> {
  const instance = getInstance(instanceId)
  const state = await readState(instance)
  let updated = 0
  for (const mod of state.mods.filter((item) => item.projectId && item.source === 'modrinth')) {
    if (await updateMod(instanceId, mod.projectId!, onProgress)) updated++
  }
  return updated
}

function safeDestination(root: string, relative: string): string {
  const destination = path.resolve(root, relative)
  if (!destination.startsWith(path.resolve(root) + path.sep) && destination !== path.resolve(root)) throw new Error(`Unsafe archive path: ${relative}`)
  return destination
}

async function extractOverrides(zip: AdmZip, prefix: string, destinationRoot: string): Promise<void> {
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(`${prefix}/`)) continue
    const relative = entry.entryName.slice(prefix.length + 1)
    if (!relative) continue
    const destination = safeDestination(destinationRoot, relative)
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.writeFile(destination, entry.getData())
  }
}

function loaderFromDependencies(dependencies: Record<string, string>): { loader: LauncherInstance['loader']; loaderVersion?: string } {
  if (dependencies['fabric-loader']) return { loader: 'fabric', loaderVersion: dependencies['fabric-loader'] }
  if (dependencies.neoforge) return { loader: 'neoforge', loaderVersion: dependencies.neoforge }
  if (dependencies.forge) {
    const minecraft = dependencies.minecraft
    const raw = dependencies.forge
    return { loader: 'forge', loaderVersion: raw.startsWith(`${minecraft}-`) ? raw : `${minecraft}-${raw}` }
  }
  return { loader: 'vanilla' }
}

export async function installModpack(instanceId: string, projectId: string, onProgress?: (message: string, progress?: number) => void): Promise<LauncherInstance> {
  return withInstallLock(`modpack:${instanceId}:${projectId}`, async () => {
    let instance = getInstance(instanceId)
    const info = await project(projectId)
    const versions = sortVersions(await fetchJson<ModrinthVersion[]>(`https://api.modrinth.com/v2/project/${encodeURIComponent(projectId)}/version`))
    const version = versions[0]
    if (!version) throw new Error('No modpack version is available.')
    const file = bestFile(version, '.mrpack')
    const temp = path.join(metadataDirectory(instance.slug), `${version.id}.mrpack`)
    await fs.mkdir(metadataDirectory(instance.slug), { recursive: true })
    await downloadFile(file.url, temp, (downloaded, total) => onProgress?.(`Downloading ${info.title}`, total ? downloaded / total : undefined))
    try {
      const zip = new AdmZip(temp)
      const indexEntry = zip.getEntry('modrinth.index.json')
      if (!indexEntry) throw new Error('This file is not a valid Modrinth modpack.')
      const index = JSON.parse(indexEntry.getData().toString('utf8')) as ModpackIndex
      if (!index.dependencies.minecraft) throw new Error('The modpack does not declare a Minecraft version.')
      const loader = loaderFromDependencies(index.dependencies)
      instance = await updateInstance(instanceId, {
        name: info.title, minecraftVersion: index.dependencies.minecraft, loader: loader.loader,
        loaderVersion: loader.loaderVersion, modpack: { projectId, versionId: version.id, title: info.title }
      })
      await fs.mkdir(instanceDirectory(instance.slug), { recursive: true })
      let completed = 0
      const installable = index.files.filter((item) => item.env?.client !== 'unsupported')
      for (const item of installable) {
        const url = item.downloads[0]
        if (!url) continue
        const destination = safeDestination(instanceDirectory(instance.slug), item.path)
        onProgress?.(`Installing ${path.basename(item.path)}`, installable.length ? completed / installable.length : undefined)
        await downloadFile(url, destination)
        if (item.hashes.sha512 && await hashFile(destination, 'sha512') !== item.hashes.sha512) {
          await fs.rm(destination, { force: true })
          throw new Error(`Integrity check failed for ${item.path}.`)
        }
        completed++
      }
      await extractOverrides(zip, 'overrides', instanceDirectory(instance.slug))
      await extractOverrides(zip, 'client-overrides', instanceDirectory(instance.slug))
      onProgress?.(`Installed ${info.title}`, 1)
      return instance
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined)
    }
  })
}
