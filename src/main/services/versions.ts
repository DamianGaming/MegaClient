import { XMLParser } from 'fast-xml-parser'
import { fetchJson, fetchWithTimeout } from './net'
import type { LoaderType } from '../types'

interface MojangManifest {
  latest: { release: string; snapshot: string }
  versions: Array<{ id: string; type: string; url: string; releaseTime: string }>
}

interface FabricLoaderEntry { loader: { version: string; stable: boolean } }

let cachedManifest: MojangManifest | null = null
let cachedAt = 0

export async function getMinecraftVersions(includeSnapshots: boolean): Promise<Array<{ id: string; type: string }>> {
  if (!cachedManifest || Date.now() - cachedAt > 10 * 60_000) {
    cachedManifest = await fetchJson<MojangManifest>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    cachedAt = Date.now()
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
  if (loader === 'fabric') {
    const entries = await fetchJson<FabricLoaderEntry[]>(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`)
    return entries.map((entry) => entry.loader.version)
  }

  const url = loader === 'forge'
    ? 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'
    : 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'
  const xml = await (await fetchWithTimeout(url)).text()
  const parser = new XMLParser({ ignoreAttributes: false })
  const parsed = parser.parse(xml) as { metadata?: { versioning?: { versions?: { version?: string | string[] } } } }
  const raw = parsed.metadata?.versioning?.versions?.version ?? []
  const versions = Array.isArray(raw) ? raw : [raw]

  if (loader === 'forge') {
    return versions.filter((version) => version.startsWith(`${minecraftVersion}-`)).reverse()
  }

  const neoPrefix = minecraftVersion.startsWith('1.') ? minecraftVersion.slice(2) : minecraftVersion
  return versions.filter((version) => version === neoPrefix || version.startsWith(`${neoPrefix}.`) || version.startsWith(`${neoPrefix}-`)).reverse()
}
