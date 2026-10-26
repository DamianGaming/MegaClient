import { XMLParser } from 'fast-xml-parser'
import semver from 'semver'
import { fetchJson, fetchWithTimeout } from './net'
import type { LoaderType } from '../types'

interface MojangManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; url: string; releaseTime: string }>
}

interface FabricLoaderEntry { loader: { version: string; stable: boolean } }

let cachedManifest: MojangManifest | null = null
let cachedAt = 0
const loaderVersionCache = new Map<string, { value: string[]; expiresAt: number }>()
const LOADER_CACHE_TTL = 30 * 60_000

export async function getMinecraftVersions(includeSnapshots: boolean): Promise<Array<{ id: string; type: string }>> {
  if (!cachedManifest || Date.now() - cachedAt > 10 * 60_000) {
    try {
      cachedManifest = await fetchJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
      cachedAt = Date.now()
    } catch (error) {
      // A short offline period should not erase the last working version list.
      if (!cachedManifest) throw error
    }
  }
  const cutoff = cachedManifest.versions.find((version) => version.id === '1.8.9')?.releaseTime
  const minimumTime = cutoff ? Date.parse(cutoff) : Date.parse('2015-12-09T00:00:00Z')
  return cachedManifest.versions
    .filter((version) => Date.parse(version.releaseTime) >= minimumTime)
    .filter((version) => includeSnapshots || version.type === 'release')
    .map(({ id, type }) => ({ id, type }))
}

export async function getLoaderVersions(loader: LoaderType, minecraftVersion: string): Promise<string[]> {
  if (loader === 'vanilla') return []
  const cacheKey = `${loader}:${minecraftVersion}`
  const cached = loaderVersionCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return [...cached.value]

  let versions: string[]
  try {
    if (loader === 'fabric') {
      const entries = await fetchJson<FabricLoaderEntry[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`)
      // Prefer the newest compatible stable loader from Fabric's live metadata.
      // Existing instances keep their explicitly selected loader version.
      const stable = entries.filter((entry) => entry.loader.stable).map((entry) => entry.loader.version)
      const previews = entries.filter((entry) => !entry.loader.stable).map((entry) => entry.loader.version)
      const newestFirst = (a: string, b: string): number => semver.rcompare(semver.coerce(a) ?? '0.0.0', semver.coerce(b) ?? '0.0.0')
      versions = [...new Set(stable)].sort(newestFirst).concat([...new Set(previews)].sort(newestFirst))
    } else {
      const url = loader === 'forge'
        ? 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
        : 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
      const xml = await (await fetchWithTimeout(url)).text()
      const parser = new XMLParser({ ignoreAttributes: false })
      const parsed = parser.parse(xml) as { metadata?: { versioning?: { versions?: { version?: string | string[] } } } }
      const raw = parsed.metadata?.versioning?.versions?.version ?? []
      const available = Array.isArray(raw) ? raw : [raw]

      if (loader === 'forge') {
        versions = available.filter((version) => version.startsWith(`${minecraftVersion}-`)).reverse()
      } else {
        const neoPrefix = minecraftVersion.startsWith('1.') ? minecraftVersion.slice(2) : minecraftVersion
        versions = available.filter((version) => version === neoPrefix || version.startsWith(`${neoPrefix}.`) || version.startsWith(`${neoPrefix}-`)).reverse()
      }
    }
  } catch (error) {
    if (!cached) throw error
    return [...cached.value]
  }

  loaderVersionCache.set(cacheKey, { value: versions, expiresAt: Date.now() + LOADER_CACHE_TTL })
  if (loaderVersionCache.size > 120) {
    for (const [key, entry] of loaderVersionCache) {
      if (entry.expiresAt <= Date.now() || loaderVersionCache.size > 90) loaderVersionCache.delete(key)
    }
  }
  return [...versions]
}
