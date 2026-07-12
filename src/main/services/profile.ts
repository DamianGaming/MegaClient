import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MinecraftProfileCape, MinecraftProfileData, MinecraftProfileSkin } from '../types'
import { getValidAccount } from './account'

interface ApiProfile {
  skins?: Array<{ id?: string; url?: string; state?: string; variant?: string }>
  capes?: Array<{ id?: string; url?: string; state?: string; alias?: string }>
}

interface ProfileCacheRecord {
  uuid: string
  fetchedAt: number
  data: MinecraftProfileData
}

const FRESH_CACHE_MS = 5 * 60_000
const STALE_CACHE_MS = 24 * 60 * 60_000
let memoryCache: ProfileCacheRecord | null = null
let profileInFlight: { uuid: string; promise: Promise<MinecraftProfileData> } | null = null

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'minecraft-profile-cache.json')
}

function safeTextureUrl(value?: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' && url.hostname.toLowerCase() === 'textures.minecraft.net') {
      url.protocol = 'https:'
    }
    if (url.protocol !== 'https:') return ''
    return url.toString()
  } catch {
    return ''
  }
}

function apiError(action: string, status: number, body: string, retryAfter?: string | null): Error {
  let detail = body.trim()
  try {
    const parsed = JSON.parse(body) as { errorMessage?: string; error?: string; path?: string }
    detail = parsed.errorMessage ?? parsed.error ?? detail
  } catch {
    // Keep the text returned by Minecraft Services.
  }
  if (status === 401 || status === 403) return new Error(`Minecraft Services rejected the account while trying to ${action}. Sign out and sign in again.`)
  if (status === 429) {
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
    return new Error(`Minecraft Services is temporarily rate-limiting skin and cape requests.${seconds ? ` Try again in about ${seconds} seconds.` : ' Please wait a moment and try again.'}`)
  }
  return new Error(`Could not ${action} (HTTP ${status})${detail ? `: ${detail}` : '.'}`)
}

function normaliseProfile(data: ApiProfile): MinecraftProfileData {
  const skins: MinecraftProfileSkin[] = (data.skins ?? [])
    .filter((item): item is typeof item & { id: string; url: string } => Boolean(item.id && item.url))
    .map((item) => ({
      id: item.id,
      url: safeTextureUrl(item.url),
      state: (String(item.state).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive') as MinecraftProfileSkin['state'],
      variant: (String(item.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic') as MinecraftProfileSkin['variant']
    }))
    .filter((item) => Boolean(item.url))

  const capes: MinecraftProfileCape[] = (data.capes ?? [])
    .filter((item): item is typeof item & { id: string; url: string } => Boolean(item.id && item.url))
    .map((item) => ({
      id: item.id,
      url: safeTextureUrl(item.url),
      state: (String(item.state).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive') as MinecraftProfileCape['state'],
      alias: item.alias?.trim() || 'Minecraft cape'
    }))
    .filter((item) => Boolean(item.url))

  return { skins, capes, revision: Date.now() }
}

async function readDiskCache(uuid: string): Promise<ProfileCacheRecord | null> {
  try {
    const record = JSON.parse(await fs.readFile(cacheFile(), 'utf8')) as ProfileCacheRecord
    if (record.uuid !== uuid || !record.data || !Number.isFinite(record.fetchedAt)) return null
    return record
  } catch {
    return null
  }
}

async function getCachedRecord(uuid: string): Promise<ProfileCacheRecord | null> {
  if (memoryCache?.uuid === uuid) return memoryCache
  const disk = await readDiskCache(uuid)
  if (disk) memoryCache = disk
  return disk
}

async function saveCache(uuid: string, data: MinecraftProfileData): Promise<MinecraftProfileData> {
  const record: ProfileCacheRecord = { uuid, fetchedAt: Date.now(), data }
  memoryCache = record
  await fs.mkdir(path.dirname(cacheFile()), { recursive: true })
  await fs.writeFile(cacheFile(), JSON.stringify(record), 'utf8').catch(() => undefined)
  return data
}

async function requestProfile(token: string, uuid: string, force = false): Promise<MinecraftProfileData> {
  const cached = await getCachedRecord(uuid)
  if (!force && cached && Date.now() - cached.fetchedAt < FRESH_CACHE_MS) return cached.data
  if (profileInFlight?.uuid === uuid) return profileInFlight.promise

  const promise = (async () => {
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000)
    })

    if (!response.ok) {
      const body = await response.text()
      if (response.status === 429 && cached && Date.now() - cached.fetchedAt < STALE_CACHE_MS) {
        return cached.data
      }
      throw apiError('load your skin and capes', response.status, body, response.headers.get('retry-after'))
    }

    return saveCache(uuid, normaliseProfile(await response.json() as ApiProfile))
  })()
  profileInFlight = { uuid, promise }

  try {
    return await promise
  } finally {
    if (profileInFlight?.promise === promise) profileInFlight = null
  }
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('The selected file is not a valid PNG image.')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function getProfileData(mainWindow: BrowserWindow, force = false): Promise<MinecraftProfileData> {
  const account = await getValidAccount(mainWindow)
  return requestProfile(account.accessToken, account.uuid, force)
}

export async function updateSkin(
  mainWindow: BrowserWindow,
  file: string,
  variant: 'classic' | 'slim'
): Promise<MinecraftProfileData> {
  const account = await getValidAccount(mainWindow)
  const bytes = await fs.readFile(file)
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Minecraft skins must be smaller than 2 MB.')
  const { width, height } = readPngDimensions(bytes)
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Minecraft skins must be 64×64 or legacy 64×32 pixels. This image is ${width}×${height}.`)
  }

  const form = new FormData()
  form.append('variant', variant)
  form.append('file', new Blob([bytes], { type: 'image/png' }), path.basename(file) || 'skin.png')
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.accessToken}` },
    body: form,
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw apiError('upload the skin', response.status, await response.text(), response.headers.get('retry-after'))

  const body = await response.text()
  if (body.trim()) {
    try {
      return saveCache(account.uuid, normaliseProfile(JSON.parse(body) as ApiProfile))
    } catch {
      // Some successful responses contain no complete profile. Refresh below.
    }
  }

  memoryCache = null
  return requestProfile(account.accessToken, account.uuid, true)
}

export async function switchCape(mainWindow: BrowserWindow, capeId?: string): Promise<MinecraftProfileData> {
  const account = await getValidAccount(mainWindow)
  const response = await fetch('https://api.minecraftservices.com/minecraft/profile/capes/active', {
    method: capeId ? 'PUT' : 'DELETE',
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      ...(capeId ? { 'Content-Type': 'application/json' } : {})
    },
    body: capeId ? JSON.stringify({ capeId }) : undefined,
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw apiError(capeId ? 'activate the cape' : 'hide the cape', response.status, await response.text(), response.headers.get('retry-after'))

  const body = await response.text()
  if (body.trim()) {
    try {
      return saveCache(account.uuid, normaliseProfile(JSON.parse(body) as ApiProfile))
    } catch {
      // Use an optimistic cached update below.
    }
  }

  const cached = await getCachedRecord(account.uuid)
  if (cached) {
    const next: MinecraftProfileData = {
      ...cached.data,
      revision: Date.now(),
      capes: cached.data.capes.map((cape) => ({
        ...cape,
        state: capeId && cape.id === capeId ? 'active' : 'inactive'
      }))
    }
    return saveCache(account.uuid, next)
  }

  return requestProfile(account.accessToken, account.uuid, true)
}
