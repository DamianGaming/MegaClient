import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { ImportProgress, ImportRequest, ImportResult, ImportSourceKind, ImportSourcePreview, LauncherInstance, LoaderType } from '../types'
import { createInstance, getInstance } from './instances'
import { instanceDirectory } from './paths'
import { downloadFile, hashFile } from './net'
import { store } from './store'

type ZipEntry = ReturnType<AdmZip['getEntries']>[number]

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 20_000
const MAX_EXPANDED_BYTES = 6 * 1024 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024 * 1024
const FOLDERS = new Set(['mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks', 'saves', 'schematics', 'screenshots', 'replay_recordings', 'journeymap', 'xaerowaypoints', 'kubejs', 'scripts'])
const ROOT_FILES = new Set(['options.txt', 'optionsof.txt', 'optionsshaders.txt', 'servers.dat', 'servers.dat_old'])

interface LoaderInfo { loader?: LoaderType; loaderVersion?: string; unsupportedLoader?: string }
interface CurseForgeManifest {
  name?: string
  minecraft?: { version?: string; modLoaders?: Array<{ id?: string; primary?: boolean }> }
  files?: Array<{ projectID?: number; fileID?: number; required?: boolean }>
  overrides?: string
}
interface MrpackFile {
  path: string
  hashes?: { sha1?: string; sha512?: string }
  downloads?: string[]
  fileSize?: number
  env?: { client?: string; server?: string }
}
interface MrpackIndex { name?: string; dependencies?: Record<string, string>; files?: MrpackFile[] }

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const slash = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '')

function safePath(root: string, relative: string): string {
  const clean = slash(relative).replace(/^\/+/, '')
  if (!clean || clean.includes('\0') || clean === '..' || clean.includes('../') || /^[A-Za-z]:\//.test(clean)) throw new Error(`Unsafe import path: ${relative}`)
  const resolvedRoot = path.resolve(root)
  const destination = path.resolve(root, clean)
  if (destination !== resolvedRoot && !destination.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`Unsafe import path: ${relative}`)
  return destination
}

function importable(relative: string): string | null {
  const clean = slash(relative).replace(/^\/+/, '')
  if (!clean || clean === '..' || clean.includes('../')) return null
  const parts = clean.split('/').filter(Boolean)
  const top = parts[0]?.toLowerCase()
  if (!top) return null
  if (FOLDERS.has(top)) return parts.join('/')
  if (parts.length === 1 && ROOT_FILES.has(top)) return parts[0]!
  return null
}

function emptyContent(): ImportSourcePreview['content'] {
  return { mods: 0, resourcePacks: 0, shaders: 0, worlds: 0, configurationFiles: 0, otherFiles: 0 }
}

function count(content: ImportSourcePreview['content'], relative: string): void {
  const top = slash(relative).split('/').filter(Boolean)[0]?.toLowerCase()
  if (top === 'mods') content.mods++
  else if (top === 'resourcepacks') content.resourcePacks++
  else if (top === 'shaderpacks') content.shaders++
  else if (top === 'saves') content.worlds++
  else if (top === 'config' || top === 'defaultconfigs' || top === 'kubejs' || top === 'scripts') content.configurationFiles++
  else content.otherFiles++
}

function label(kind: ImportSourceKind): string {
  return ({ curseforge: 'CurseForge', modrinth: 'Modrinth', lunar: 'Lunar Client', prism: 'Prism / MultiMC', minecraft: 'Minecraft', generic: 'Minecraft profile' } as Record<ImportSourceKind, string>)[kind]
}

function loaderFromText(raw?: string): LoaderInfo {
  const value = String(raw ?? '').trim()
  const lower = value.toLowerCase()
  if (!value || lower === 'vanilla') return value ? { loader: 'vanilla' } : {}
  if (lower.includes('neoforge')) return { loader: 'neoforge', loaderVersion: value.replace(/^.*?neoforge[-_ ]?/i, '') || undefined }
  if (lower.includes('fabric')) return { loader: 'fabric', loaderVersion: value.replace(/^.*?fabric(?:-loader)?[-_ ]?/i, '') || undefined }
  if (lower.includes('forge')) return { loader: 'forge', loaderVersion: value.replace(/^.*?forge[-_ ]?/i, '') || undefined }
  if (lower.includes('quilt')) return { unsupportedLoader: 'Quilt' }
  return { unsupportedLoader: value }
}

function normaliseLoader(info: LoaderInfo, minecraftVersion?: string): LoaderInfo {
  if (info.loader === 'forge' && info.loaderVersion && minecraftVersion && !info.loaderVersion.startsWith(`${minecraftVersion}-`)) {
    return { ...info, loaderVersion: `${minecraftVersion}-${info.loaderVersion}` }
  }
  return info
}

function loaderFromMrpack(deps: Record<string, string>): LoaderInfo {
  if (deps['fabric-loader']) return { loader: 'fabric', loaderVersion: deps['fabric-loader'] }
  if (deps.neoforge) return { loader: 'neoforge', loaderVersion: deps.neoforge }
  if (deps.forge) return normaliseLoader({ loader: 'forge', loaderVersion: deps.forge }, deps.minecraft)
  if (deps['quilt-loader']) return { unsupportedLoader: 'Quilt' }
  return { loader: 'vanilla' }
}

async function entryBuffer(entry: ZipEntry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const asyncGetter = (entry as ZipEntry & { getDataAsync?: (callback: (data: Buffer, error?: Error) => void) => void }).getDataAsync
    if (!asyncGetter) {
      try { resolve(entry.getData()) } catch (error) { reject(error) }
      return
    }
    asyncGetter.call(entry, (data: Buffer, error?: Error) => error ? reject(error) : resolve(data))
  })
}

async function zipJson<T>(zip: AdmZip, filename: string): Promise<T | null> {
  const entry = zip.getEntries().find((item) => slash(item.entryName).toLowerCase() === filename.toLowerCase())
  if (!entry || entry.isDirectory || Number(entry.header.size || 0) > 5 * 1024 * 1024) return null
  try { return JSON.parse((await entryBuffer(entry)).toString('utf8')) as T } catch { return null }
}

function kindFromArchive(sourcePath: string, entries: ZipEntry[]): ImportSourceKind {
  const extension = path.extname(sourcePath).toLowerCase()
  const names = new Set(entries.map((entry) => slash(entry.entryName).toLowerCase()))
  if (extension === '.mrpack' || names.has('modrinth.index.json')) return 'modrinth'
  if (extension === '.dawnpack') return 'lunar'
  if (names.has('manifest.json')) return 'curseforge'
  return 'generic'
}

function contentPrefix(entries: ZipEntry[]): string {
  const scores = new Map<string, number>()
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const parts = slash(entry.entryName).split('/').filter(Boolean)
    for (let index = 0; index < Math.min(parts.length, 5); index++) {
      const current = parts[index]!.toLowerCase()
      if (!FOLDERS.has(current) && !ROOT_FILES.has(current)) continue
      const prefix = parts.slice(0, index).join('/')
      scores.set(prefix, (scores.get(prefix) ?? 0) + 1)
      break
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? ''
}

function previewEntries(entries: ZipEntry[], prefixes: string[]): ImportSourcePreview['content'] {
  const result = emptyContent()
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = slash(entry.entryName)
    for (const baseRaw of prefixes) {
      const base = slash(baseRaw).replace(/\/$/, '')
      const relative = base ? (name.startsWith(`${base}/`) ? name.slice(base.length + 1) : '') : name
      if (!relative) continue
      const safe = importable(relative)
      if (safe) count(result, safe)
      break
    }
  }
  return result
}

async function inspectArchive(sourcePath: string): Promise<ImportSourcePreview> {
  const stat = await fs.stat(sourcePath)
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error('This profile archive is too large to import safely.')
  let zip: AdmZip
  try { zip = new AdmZip(sourcePath) } catch { throw new Error('The selected file is not a readable Minecraft profile archive.') }
  const entries = zip.getEntries()
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('This profile contains too many files to import safely.')
  const expanded = entries.reduce((total, entry) => total + (entry.isDirectory ? 0 : Number(entry.header.size || 0)), 0)
  if (expanded > MAX_EXPANDED_BYTES) throw new Error('This profile expands beyond MegaClient’s safe import size limit.')
  if (entries.some((entry) => Number(entry.header.size || 0) > MAX_FILE_BYTES)) throw new Error('This profile contains an individual file that is too large to import safely.')

  const kind = kindFromArchive(sourcePath, entries)
  const warnings: string[] = []
  let name = path.basename(sourcePath, path.extname(sourcePath))
  let minecraftVersion: string | undefined
  let loaderInfo: LoaderInfo = {}
  let content = emptyContent()
  let referencedRemoteMods = 0

  if (kind === 'modrinth') {
    const index = await zipJson<MrpackIndex>(zip, 'modrinth.index.json')
    if (!index?.dependencies?.minecraft) throw new Error('This .mrpack is missing its Minecraft version metadata.')
    name = index.name?.trim() || name
    minecraftVersion = index.dependencies.minecraft
    loaderInfo = loaderFromMrpack(index.dependencies)
    for (const item of index.files ?? []) if (item.env?.client !== 'unsupported') count(content, item.path)
    const overrides = previewEntries(entries, ['overrides', 'client-overrides'])
    for (const key of Object.keys(content) as Array<keyof typeof content>) content[key] += overrides[key]
  } else if (kind === 'curseforge') {
    const manifest = await zipJson<CurseForgeManifest>(zip, 'manifest.json')
    if (!manifest) throw new Error('This CurseForge export is missing a readable manifest.json.')
    name = manifest.name?.trim() || name
    minecraftVersion = manifest.minecraft?.version
    const primary = manifest.minecraft?.modLoaders?.find((item) => item.primary) ?? manifest.minecraft?.modLoaders?.[0]
    loaderInfo = normaliseLoader(loaderFromText(primary?.id), minecraftVersion)
    referencedRemoteMods = manifest.files?.length ?? 0
    content = previewEntries(entries, [manifest.overrides || 'overrides'])
    if (referencedRemoteMods) warnings.push(`This CurseForge export references ${referencedRemoteMods} hosted mod file${referencedRemoteMods === 1 ? '' : 's'}. MegaClient imports files bundled in the ZIP; importing the installed CurseForge profile folder is the most complete local copy.`)
  } else {
    content = previewEntries(entries, [contentPrefix(entries)])
    if (kind === 'lunar') warnings.push('Lunar-exclusive built-in features, account data and cosmetics are not copied; compatible Minecraft profile files are imported.')
  }

  if (loaderInfo.unsupportedLoader) warnings.push(`${loaderInfo.unsupportedLoader} was detected. MegaClient currently creates Vanilla, Fabric, Forge and NeoForge instances.`)
  return { sourcePath, kind, sourceLabel: label(kind), name, minecraftVersion, loader: loaderInfo.loader, loaderVersion: loaderInfo.loaderVersion, unsupportedLoader: loaderInfo.unsupportedLoader, content, warnings, referencedRemoteMods }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) return null
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
  } catch { return null }
}

async function isDirectory(directory: string): Promise<boolean> {
  try { return (await fs.stat(directory)).isDirectory() } catch { return false }
}

async function scoreFolder(directory: string): Promise<number> {
  let score = 0
  for (const name of FOLDERS) if (await isDirectory(path.join(directory, name))) score += name === 'mods' ? 5 : 1
  for (const name of ROOT_FILES) try { if ((await fs.stat(path.join(directory, name))).isFile()) score++ } catch { /* ignore */ }
  return score
}

async function findContentRoot(root: string): Promise<string> {
  let best = root
  let bestScore = await scoreFolder(root)
  for (const simple of ['.minecraft', 'minecraft', 'game']) {
    const candidate = path.join(root, simple)
    const score = await scoreFolder(candidate)
    if (score > bestScore) { best = candidate; bestScore = score }
  }
  if (bestScore >= 5) return best
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }]
  let visited = 0
  while (queue.length && visited++ < 160) {
    const item = queue.shift()!
    if (item.depth >= 3) continue
    const entries = await fs.readdir(item.dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (['node_modules', 'logs', 'cache', 'webcache', 'assets', 'libraries', 'runtime', 'versions'].includes(entry.name.toLowerCase())) continue
      const child = path.join(item.dir, entry.name)
      const score = await scoreFolder(child)
      if (score > bestScore) { best = child; bestScore = score }
      queue.push({ dir: child, depth: item.depth + 1 })
    }
  }
  return best
}

async function countFolder(root: string): Promise<ImportSourcePreview['content']> {
  const result = emptyContent()
  for (const folder of FOLDERS) {
    const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) if (!entry.isSymbolicLink()) count(result, `${folder}/${entry.name}`)
  }
  for (const file of ROOT_FILES) try { if ((await fs.stat(path.join(root, file))).isFile()) count(result, file) } catch { /* ignore */ }
  return result
}

async function inspectFolder(sourcePath: string): Promise<ImportSourcePreview> {
  const root = await findContentRoot(sourcePath)
  const curse = await readJson(path.join(sourcePath, 'minecraftinstance.json')) ?? await readJson(path.join(root, 'minecraftinstance.json'))
  const prism = await readJson(path.join(sourcePath, 'mmc-pack.json')) ?? await readJson(path.join(root, 'mmc-pack.json'))
  const lower = sourcePath.toLowerCase()
  let kind: ImportSourceKind = curse || lower.includes('curseforge') ? 'curseforge' : prism || lower.includes('prismlauncher') || lower.includes('multimc') ? 'prism' : lower.includes('lunar') ? 'lunar' : path.basename(sourcePath).toLowerCase() === '.minecraft' ? 'minecraft' : 'generic'
  let name = path.basename(sourcePath) || 'Imported Minecraft profile'
  let minecraftVersion: string | undefined
  let loaderInfo: LoaderInfo = {}
  const warnings: string[] = []

  if (curse) {
    const installed = curse.installedModpack as Record<string, unknown> | undefined
    name = String(curse.name ?? installed?.name ?? name)
    minecraftVersion = String(curse.gameVersion ?? curse.minecraftVersion ?? '').trim() || undefined
    const base = curse.baseModLoader as Record<string, unknown> | string | undefined
    loaderInfo = normaliseLoader(loaderFromText(typeof base === 'string' ? base : String(base?.name ?? curse.modLoader ?? '')), minecraftVersion)
  }
  const components = Array.isArray(prism?.components) ? prism.components as Array<{ uid?: string; version?: string }> : []
  if (components.length) {
    minecraftVersion = components.find((item) => item.uid === 'net.minecraft')?.version ?? minecraftVersion
    const fabric = components.find((item) => item.uid === 'net.fabricmc.fabric-loader')
    const neo = components.find((item) => item.uid === 'net.neoforged')
    const forge = components.find((item) => item.uid === 'net.minecraftforge')
    const quilt = components.find((item) => item.uid === 'org.quiltmc.quilt-loader')
    if (fabric) loaderInfo = { loader: 'fabric', loaderVersion: fabric.version }
    else if (neo) loaderInfo = { loader: 'neoforge', loaderVersion: neo.version }
    else if (forge) loaderInfo = normaliseLoader({ loader: 'forge', loaderVersion: forge.version }, minecraftVersion)
    else if (quilt) loaderInfo = { unsupportedLoader: 'Quilt' }
    else loaderInfo = { loader: 'vanilla' }
  }
  if (!minecraftVersion) {
    const meta = await readJson(path.join(sourcePath, 'instance.json'))
    minecraftVersion = String(meta?.minecraftVersion ?? meta?.gameVersion ?? meta?.version ?? '').trim() || undefined
    if (!loaderInfo.loader && !loaderInfo.unsupportedLoader) loaderInfo = normaliseLoader(loaderFromText(String(meta?.loader ?? meta?.modLoader ?? meta?.loaderVersion ?? '')), minecraftVersion)
  }
  if (kind === 'lunar') warnings.push('MegaClient imports compatible Minecraft files from this Lunar profile. Lunar account data, cosmetics and launcher-only features are left alone.')
  if (loaderInfo.unsupportedLoader) warnings.push(`${loaderInfo.unsupportedLoader} was detected. Choose a supported loader when creating the imported instance.`)
  return { sourcePath, kind, sourceLabel: label(kind), name, minecraftVersion, loader: loaderInfo.loader, loaderVersion: loaderInfo.loaderVersion, unsupportedLoader: loaderInfo.unsupportedLoader, content: await countFolder(root), warnings, contentRoot: root }
}

export async function inspectImportSource(sourcePath: string): Promise<ImportSourcePreview> {
  if (!sourcePath) throw new Error('Choose something to import first.')
  const resolved = path.resolve(sourcePath)
  const stat = await fs.stat(resolved).catch(() => null)
  if (!stat) throw new Error('The selected profile can no longer be found.')
  return stat.isDirectory() ? inspectFolder(resolved) : inspectArchive(resolved)
}

function preserve(relative: string): boolean {
  const top = slash(relative).split('/')[0]?.toLowerCase()
  return top === 'config' || top === 'defaultconfigs' || top === 'kubejs' || top === 'scripts' || ROOT_FILES.has(top ?? '')
}

async function sha256File(file: string): Promise<string> {
  const digest = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try { for await (const chunk of handle.createReadStream({ autoClose: false })) digest.update(chunk as Buffer) } finally { await handle.close() }
  return digest.digest('hex')
}

async function destinationFor(root: string, relative: string, source?: string, buffer?: Buffer): Promise<{ path: string; skip: boolean }> {
  const initial = safePath(root, relative)
  await fs.mkdir(path.dirname(initial), { recursive: true })
  try {
    const stat = await fs.stat(initial)
    if (source) {
      const sourceStat = await fs.stat(source)
      if (sourceStat.size === stat.size && await sha256File(source) === await sha256File(initial)) return { path: initial, skip: true }
    } else if (buffer && stat.size === buffer.length) {
      const existing = await fs.readFile(initial)
      if (createHash('sha256').update(existing).digest('hex') === createHash('sha256').update(buffer).digest('hex')) return { path: initial, skip: true }
    }
    if (preserve(relative)) return { path: initial, skip: true }
  } catch { return { path: initial, skip: false } }
  const parsed = path.parse(initial)
  for (let index = 2; index < 1000; index++) {
    const candidate = path.join(parsed.dir, `${parsed.name}-imported-${index}${parsed.ext}`)
    try { await fs.access(candidate) } catch { return { path: candidate, skip: false } }
  }
  throw new Error(`Could not choose a safe destination for ${path.basename(relative)}.`)
}

async function copyFolder(root: string, destination: string, progress?: (event: ImportProgress) => void): Promise<{ copied: number; skipped: number }> {
  const jobs: Array<{ source: string; relative: string }> = []
  const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 12) return
    for (const entry of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (prefix || FOLDERS.has(entry.name.toLowerCase())) await walk(path.join(directory, entry.name), relative, depth + 1)
      } else if (entry.isFile()) {
        const safe = importable(relative)
        if (safe) jobs.push({ source: path.join(directory, entry.name), relative: safe })
      }
    }
  }
  await walk(root, '', 0)
  let copied = 0, skipped = 0
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]!
    const stat = await fs.stat(job.source)
    if (stat.size > MAX_FILE_BYTES) throw new Error(`Imported file is too large: ${job.relative}`)
    progress?.({ message: `Importing ${path.basename(job.relative)}`, progress: jobs.length ? index / jobs.length : 0 })
    const chosen = await destinationFor(destination, job.relative, job.source)
    if (chosen.skip) skipped++
    else { await fs.copyFile(job.source, chosen.path); copied++ }
    if (index % 20 === 0) await tick()
  }
  return { copied, skipped }
}

async function extractEntries(zip: AdmZip, destination: string, jobs: Array<{ entry: ZipEntry; relative: string }>, progress?: (event: ImportProgress) => void): Promise<{ copied: number; skipped: number }> {
  let copied = 0, skipped = 0
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index]!
    if (Number(job.entry.header.size || 0) > MAX_FILE_BYTES) throw new Error(`Imported file is too large: ${job.relative}`)
    progress?.({ message: `Importing ${path.basename(job.relative)}`, progress: jobs.length ? index / jobs.length : 0 })
    const buffer = await entryBuffer(job.entry)
    const chosen = await destinationFor(destination, job.relative, undefined, buffer)
    if (chosen.skip) skipped++
    else { await fs.writeFile(chosen.path, buffer); copied++ }
    buffer.fill(0)
    if (index % 10 === 0) await tick()
  }
  return { copied, skipped }
}

async function installMrpack(sourcePath: string, destination: string, progress?: (event: ImportProgress) => void): Promise<{ copied: number; skipped: number }> {
  const zip = new AdmZip(sourcePath)
  const index = await zipJson<MrpackIndex>(zip, 'modrinth.index.json')
  if (!index?.dependencies?.minecraft) throw new Error('This .mrpack is missing its Minecraft version metadata.')
  const files = (index.files ?? []).filter((item) => item.env?.client !== 'unsupported')
  if (files.reduce((sum, item) => sum + Math.max(0, Number(item.fileSize ?? 0)), 0) > MAX_EXPANDED_BYTES) throw new Error('This Modrinth pack is too large to import safely.')
  let copied = 0, skipped = 0
  for (let indexNumber = 0; indexNumber < files.length; indexNumber++) {
    const item = files[indexNumber]!
    const relative = slash(item.path)
    const safe = safePath(destination, relative)
    const url = item.downloads?.[0]
    if (!url) { skipped++; continue }
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || (!item.hashes?.sha512 && !item.hashes?.sha1)) throw new Error(`The profile contains an unverifiable download for ${path.basename(relative)}.`)
    try {
      if (item.hashes?.sha512 && await hashFile(safe, 'sha512') === item.hashes.sha512.toLowerCase()) { skipped++; continue }
      if (!item.hashes?.sha512 && item.hashes?.sha1 && await hashFile(safe, 'sha1') === item.hashes.sha1.toLowerCase()) { skipped++; continue }
    } catch { /* destination does not exist yet */ }
    const chosen = await destinationFor(destination, relative)
    if (chosen.skip) { skipped++; continue }
    progress?.({ message: `Downloading ${path.basename(relative)}`, progress: indexNumber / Math.max(1, files.length + 1) })
    await downloadFile(url, chosen.path, undefined, { maxBytes: Math.min(MAX_FILE_BYTES, Math.max(Number(item.fileSize ?? 0) * 2, 64 * 1024 * 1024)), timeoutMs: 180_000 })
    if (item.hashes?.sha512 && await hashFile(chosen.path, 'sha512') !== item.hashes.sha512.toLowerCase()) { await fs.rm(chosen.path, { force: true }); throw new Error(`Integrity check failed for ${relative}.`) }
    if (!item.hashes?.sha512 && item.hashes?.sha1 && await hashFile(chosen.path, 'sha1') !== item.hashes.sha1.toLowerCase()) { await fs.rm(chosen.path, { force: true }); throw new Error(`Integrity check failed for ${relative}.`) }
    copied++
  }
  const jobs: Array<{ entry: ZipEntry; relative: string }> = []
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const name = slash(entry.entryName)
    for (const prefix of ['overrides/', 'client-overrides/']) {
      if (!name.startsWith(prefix)) continue
      const safe = importable(name.slice(prefix.length))
      if (safe) jobs.push({ entry, relative: safe })
      break
    }
  }
  const overrides = await extractEntries(zip, destination, jobs, progress)
  return { copied: copied + overrides.copied, skipped: skipped + overrides.skipped }
}

async function installArchive(sourcePath: string, preview: ImportSourcePreview, destination: string, progress?: (event: ImportProgress) => void): Promise<{ copied: number; skipped: number }> {
  const zip = new AdmZip(sourcePath)
  const entries = zip.getEntries()
  let prefix = contentPrefix(entries)
  if (preview.kind === 'curseforge') prefix = slash((await zipJson<CurseForgeManifest>(zip, 'manifest.json'))?.overrides || 'overrides').replace(/\/$/, '')
  const jobs: Array<{ entry: ZipEntry; relative: string }> = []
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = slash(entry.entryName)
    const relative = prefix ? (name.startsWith(`${prefix}/`) ? name.slice(prefix.length + 1) : '') : name
    const safe = relative ? importable(relative) : null
    if (safe) jobs.push({ entry, relative: safe })
  }
  return extractEntries(zip, destination, jobs, progress)
}

function assertCompatible(preview: ImportSourcePreview, instance: LauncherInstance): void {
  if (preview.minecraftVersion && preview.minecraftVersion !== instance.minecraftVersion) throw new Error(`This profile is for Minecraft ${preview.minecraftVersion}, while ${instance.name} uses ${instance.minecraftVersion}.`)
  if (preview.loader && preview.loader !== 'vanilla' && preview.loader !== instance.loader) throw new Error(`This profile uses ${preview.loader}, while ${instance.name} uses ${instance.loader}.`)
}

export async function importMinecraftSetup(input: ImportRequest, progress?: (event: ImportProgress) => void): Promise<ImportResult> {
  const preview = await inspectImportSource(input.sourcePath)
  progress?.({ message: `Preparing ${preview.sourceLabel} import`, progress: 0.02 })
  let instance: LauncherInstance
  if (input.mode === 'existing') {
    if (!input.instanceId) throw new Error('Choose an existing instance first.')
    instance = getInstance(input.instanceId)
    assertCompatible(preview, instance)
  } else {
    const name = String(input.name || preview.name || 'Imported profile').trim().slice(0, 48)
    const minecraftVersion = String(preview.minecraftVersion || input.minecraftVersion || '').trim()
    const loader = preview.loader ?? input.loader
    const loaderVersion = preview.loaderVersion ?? input.loaderVersion
    if (!name) throw new Error('Give the imported instance a name.')
    if (!minecraftVersion) throw new Error('MegaClient could not detect the Minecraft version. Enter it before importing.')
    if (!loader) throw new Error(`Choose Vanilla, Fabric, Forge or NeoForge${preview.unsupportedLoader ? ` instead of ${preview.unsupportedLoader}` : ''}.`)
    if (loader !== 'vanilla' && !loaderVersion) throw new Error(`Enter the ${loader} loader version before importing.`)
    instance = await createInstance({ name, minecraftVersion, loader, loaderVersion, customClient: false })
  }

  const destination = instanceDirectory(instance.slug)
  await fs.mkdir(destination, { recursive: true })
  try {
    const stat = await fs.stat(preview.sourcePath)
    const result = stat.isDirectory()
      ? await copyFolder(preview.contentRoot || await findContentRoot(preview.sourcePath), destination, progress)
      : preview.kind === 'modrinth'
        ? await installMrpack(preview.sourcePath, destination, progress)
        : await installArchive(preview.sourcePath, preview, destination, progress)
    progress?.({ message: 'Import complete', progress: 1 })
    return { instance, copiedFiles: result.copied, skippedFiles: result.skipped, warnings: preview.warnings }
  } catch (error) {
    if (input.mode === 'new') {
      await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
      const data = store.getData()
      await store.setInstances(data.instances.filter((item) => item.id !== instance.id))
    }
    throw error
  }
}
