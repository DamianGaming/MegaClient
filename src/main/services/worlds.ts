import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { WorldSummary } from '../types'
import { getInstance } from './instances'
import { metadataDirectory, savesDirectory } from './paths'
import { downloadFile } from './net'

function safeName(value: string): string {
  const cleaned = value.replace(/[^a-z0-9 _.-]/gi, '').trim().replace(/[. ]+$/g, '')
  return cleaned.slice(0, 80) || 'Imported world'
}

function safeDestination(root: string, relative: string): string {
  const destination = path.resolve(root, relative)
  const base = path.resolve(root)
  if (destination !== base && !destination.startsWith(`${base}${path.sep}`)) throw new Error('The world archive contains an unsafe path.')
  return destination
}

async function uniqueDirectory(parent: string, requested: string): Promise<string> {
  const base = safeName(requested)
  for (let index = 0; index < 500; index++) {
    const candidate = path.join(parent, index ? `${base} (${index + 1})` : base)
    try { await fs.access(candidate) } catch { return candidate }
  }
  throw new Error('Could not create a unique folder for this world.')
}

export async function listWorlds(instanceId: string): Promise<WorldSummary[]> {
  const instance = getInstance(instanceId)
  const saves = savesDirectory(instance.slug)
  await fs.mkdir(saves, { recursive: true })
  const entries = await fs.readdir(saves, { withFileTypes: true })
  const worlds = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(saves, entry.name)
    try {
      await fs.access(path.join(directory, 'level.dat'))
      const stat = await fs.stat(directory)
      return { id: entry.name, name: entry.name, folderName: entry.name, modifiedAt: stat.mtime.toISOString() } satisfies WorldSummary
    } catch {
      return null
    }
  }))
  return worlds.filter((world): world is WorldSummary => Boolean(world)).sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))
}

export async function importWorldZip(instanceId: string, archivePath: string): Promise<WorldSummary> {
  const instance = getInstance(instanceId)
  if (path.extname(archivePath).toLowerCase() !== '.zip') throw new Error('Choose a ZIP archive containing a Minecraft world.')
  const archiveStat = await fs.stat(archivePath)
  if (archiveStat.size > 2 * 1024 * 1024 * 1024) throw new Error('This world archive is too large to import safely.')

  const archive = new AdmZip(archivePath)
  const entries = archive.getEntries()
  if (!entries.length || entries.length > 100_000) throw new Error('This world archive is empty or contains too many files.')
  const levelEntry = entries.find((entry) => !entry.isDirectory && /(^|\/)level\.dat$/i.test(entry.entryName.replaceAll('\\', '/')))
  if (!levelEntry) throw new Error('This ZIP does not contain a Minecraft level.dat file.')

  const normalLevelPath = levelEntry.entryName.replaceAll('\\', '/')
  const prefix = normalLevelPath.slice(0, -'level.dat'.length).replace(/\/$/, '')
  const suggested = prefix ? path.basename(prefix) : path.basename(archivePath, path.extname(archivePath))
  const saves = savesDirectory(instance.slug)
  await fs.mkdir(saves, { recursive: true })
  const destinationRoot = await uniqueDirectory(saves, suggested)
  await fs.mkdir(destinationRoot, { recursive: false })

  let totalSize = 0
  try {
    for (const entry of entries) {
      const normal = entry.entryName.replaceAll('\\', '/')
      if (prefix && normal !== prefix && !normal.startsWith(`${prefix}/`)) continue
      const relative = prefix ? normal.slice(prefix.length).replace(/^\//, '') : normal
      if (!relative) continue
      const destination = safeDestination(destinationRoot, relative)
      if (entry.isDirectory) {
        await fs.mkdir(destination, { recursive: true })
        continue
      }
      totalSize += entry.header.size
      if (totalSize > 4 * 1024 * 1024 * 1024) throw new Error('The extracted world is too large to import safely.')
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, entry.getData())
    }
    await fs.access(path.join(destinationRoot, 'level.dat'))
  } catch (error) {
    await fs.rm(destinationRoot, { recursive: true, force: true })
    throw error
  }

  const stat = await fs.stat(destinationRoot)
  return {
    id: path.basename(destinationRoot),
    name: path.basename(destinationRoot),
    folderName: path.basename(destinationRoot),
    modifiedAt: stat.mtime.toISOString()
  }
}

export async function downloadWorldZip(
  instanceId: string,
  sourceUrl: string,
  onProgress?: (message: string, progress?: number) => void
): Promise<WorldSummary> {
  const instance = getInstance(instanceId)
  let parsed: URL
  try { parsed = new URL(sourceUrl.trim()) } catch { throw new Error('Enter a valid world download link.') }
  if (parsed.protocol !== 'https:') throw new Error('World downloads must use a secure HTTPS link.')
  if (parsed.username || parsed.password) throw new Error('World download links cannot contain embedded sign-in details.')

  const tempDirectory = path.join(metadataDirectory(instance.slug), 'downloads')
  await fs.mkdir(tempDirectory, { recursive: true })
  const temp = path.join(tempDirectory, `world-${randomBytes(12).toString('hex')}.zip`)
  try {
    onProgress?.('Downloading world', 0)
    await downloadFile(parsed.toString(), temp, (downloaded, total) => {
      onProgress?.('Downloading world', total ? downloaded / total : undefined)
    }, { maxBytes: 2 * 1024 * 1024 * 1024, timeoutMs: 10 * 60_000 })
    onProgress?.('Installing world', 0.96)
    const installed = await importWorldZip(instanceId, temp)
    onProgress?.('World installed', 1)
    return installed
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined)
  }
}

export async function deleteWorld(instanceId: string, worldId: string): Promise<void> {
  const instance = getInstance(instanceId)
  const saves = savesDirectory(instance.slug)
  const destination = safeDestination(saves, worldId)
  await fs.rm(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
}

export async function worldFolder(instanceId: string, worldId?: string): Promise<string> {
  const instance = getInstance(instanceId)
  const saves = savesDirectory(instance.slug)
  await fs.mkdir(saves, { recursive: true })
  return worldId ? safeDestination(saves, worldId) : saves
}
