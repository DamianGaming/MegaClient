import { app, type BrowserWindow } from 'electron'
import type { Account } from 'eml-lib'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { MinecraftProfileCape, MinecraftProfileData, MinecraftProfileSkin } from '../types'
import { getValidAccount, refreshAccount } from './account'

interface ApiProfile {
  id?: string
  name?: string
  skins?: Array<{ id?: string; url?: string; state?: string; variant?: string }>
  capes?: Array<{ id?: string; url?: string; state?: string; alias?: string }>
}

interface ProfileCacheRecord {
  uuid: string
  fetchedAt: number
  data: MinecraftProfileData
}

interface AuthorisedResponse {
  account: Account
  response: Response
}

const PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SKINS_URL = `${PROFILE_URL}/skins`
const ACTIVE_CAPE_URL = `${PROFILE_URL}/capes/active`
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

  if (status === 401) return new Error(`Minecraft Services rejected the refreshed account while trying to ${action}. Sign out and sign in again.`)
  if (status === 403) return new Error(`Minecraft Services did not allow MegaClient to ${action}. Confirm this account owns Minecraft Java Edition, then sign in again.`)
  if (status === 409) return new Error(`Minecraft Services could not ${action} because the profile changed at the same time. Refresh the page and try again.`)
  if (status === 413) return new Error('The selected skin file is too large for Minecraft Services.')
  if (status === 415) return new Error('Minecraft Services did not recognise the selected file as a PNG skin.')
  if (status === 429) {
    const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined
    return new Error(`Minecraft Services is temporarily rate-limiting skin and cape requests.${seconds ? ` Try again in about ${seconds} seconds.` : ' Please wait a moment and try again.'}`)
  }
  return new Error(`Could not ${action} (HTTP ${status})${detail ? `: ${detail}` : '.'}`)
}

function normaliseSkins(items: ApiProfile['skins']): MinecraftProfileSkin[] {
  return (items ?? [])
    .filter((item): item is NonNullable<ApiProfile['skins']>[number] & { id: string; url: string } => Boolean(item.id && item.url))
    .map((item) => ({
      id: item.id,
      url: safeTextureUrl(item.url),
      state: (String(item.state).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive') as MinecraftProfileSkin['state'],
      variant: (String(item.variant).toUpperCase() === 'SLIM' ? 'slim' : 'classic') as MinecraftProfileSkin['variant']
    }))
    .filter((item) => Boolean(item.url))
}

function normaliseCapes(items: ApiProfile['capes']): MinecraftProfileCape[] {
  return (items ?? [])
    .filter((item): item is NonNullable<ApiProfile['capes']>[number] & { id: string; url: string } => Boolean(item.id && item.url))
    .map((item) => ({
      id: item.id,
      url: safeTextureUrl(item.url),
      state: (String(item.state).toUpperCase() === 'ACTIVE' ? 'active' : 'inactive') as MinecraftProfileCape['state'],
      alias: item.alias?.trim() || 'Minecraft cape'
    }))
    .filter((item) => Boolean(item.url))
}

function normaliseProfile(data: ApiProfile, fallback?: MinecraftProfileData): MinecraftProfileData {
  return {
    skins: Array.isArray(data.skins) ? normaliseSkins(data.skins) : fallback?.skins ?? [],
    capes: Array.isArray(data.capes) ? normaliseCapes(data.capes) : fallback?.capes ?? [],
    revision: Date.now()
  }
}

function parseProfileBody(body: string): ApiProfile | null {
  if (!body.trim()) return null
  try {
    const parsed = JSON.parse(body) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as ApiProfile
  } catch {
    return null
  }
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
  const record: ProfileCacheRecord = { uuid, fetchedAt: Date.now(), data: { ...data, revision: Date.now() } }
  memoryCache = record
  await fs.mkdir(path.dirname(cacheFile()), { recursive: true })
  await fs.writeFile(cacheFile(), JSON.stringify(record), 'utf8').catch(() => undefined)
  return record.data
}

async function authorisedFetch(
  mainWindow: BrowserWindow,
  initialAccount: Account,
  url: string,
  buildInit: () => RequestInit,
  timeoutMs: number
): Promise<AuthorisedResponse> {
  const send = (account: Account): Promise<Response> => {
    const init = buildInit()
    return fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        Authorization: `Bearer ${account.accessToken}`
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
  }

  let account = initialAccount
  let response = await send(account)
  if (response.status === 401) {
    account = await refreshAccount(mainWindow)
    response = await send(account)
  }
  return { account, response }
}

async function requestProfileForAccount(
  mainWindow: BrowserWindow,
  initialAccount: Account,
  force = false
): Promise<MinecraftProfileData> {
  const cached = await getCachedRecord(initialAccount.uuid)
  if (!force && cached && Date.now() - cached.fetchedAt < FRESH_CACHE_MS) return cached.data
  if (profileInFlight?.uuid === initialAccount.uuid) return profileInFlight.promise

  const promise = (async () => {
    const { account, response } = await authorisedFetch(mainWindow, initialAccount, PROFILE_URL, () => ({ method: 'GET' }), 20_000)
    const body = await response.text()

    if (!response.ok) {
      if (response.status === 429 && cached && Date.now() - cached.fetchedAt < STALE_CACHE_MS) return cached.data
      throw apiError('load your skin and capes', response.status, body, response.headers.get('retry-after'))
    }

    const payload = parseProfileBody(body)
    if (!payload) throw new Error('Minecraft Services returned an empty profile response. Please try refreshing again.')
    return saveCache(account.uuid, normaliseProfile(payload, cached?.data))
  })()

  profileInFlight = { uuid: initialAccount.uuid, promise }
  try {
    return await promise
  } finally {
    if (profileInFlight?.promise === promise) profileInFlight = null
  }
}

async function waitForCurrentProfileOperation(uuid: string): Promise<void> {
  if (profileInFlight?.uuid !== uuid) return
  await profileInFlight.promise.catch(() => undefined)
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('The selected file is not a valid PNG image.')
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function cleanUploadName(file: string): string {
  const base = path.basename(file).replace(/[^a-z0-9._-]+/gi, '_')
  return base.toLowerCase().endsWith('.png') ? base : `${base || 'skin'}.png`
}

function withCapeState(profile: MinecraftProfileData, capeId?: string): MinecraftProfileData {
  return {
    ...profile,
    revision: Date.now(),
    capes: profile.capes.map((cape) => ({
      ...cape,
      state: capeId && cape.id === capeId ? 'active' : 'inactive'
    }))
  }
}

async function refreshSkinAfterEmptyResponse(
  mainWindow: BrowserWindow,
  account: Account,
  fallback?: MinecraftProfileData
): Promise<MinecraftProfileData> {
  let latest = fallback
  for (const delayMs of [180, 450, 900]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      latest = await requestProfileForAccount(mainWindow, account, true)
      if (latest.skins.some((skin) => skin.state === 'active')) return latest
    } catch {
      // A successful upload should not be reported as failed only because the
      // follow-up profile refresh was briefly unavailable.
    }
  }
  if (latest) return saveCache(account.uuid, latest)
  throw new Error('The skin was accepted, but Minecraft Services has not returned the updated profile yet. Refresh the page in a moment.')
}

export async function getProfileData(mainWindow: BrowserWindow, force = false): Promise<MinecraftProfileData> {
  const account = await getValidAccount(mainWindow)
  return requestProfileForAccount(mainWindow, account, force)
}

export async function updateSkin(
  mainWindow: BrowserWindow,
  file: string,
  variant: 'classic' | 'slim'
): Promise<MinecraftProfileData> {
  if (!file || typeof file !== 'string') throw new Error('Choose a PNG skin before uploading.')
  if (variant !== 'classic' && variant !== 'slim') throw new Error('Choose either the classic or slim arm model.')

  const account = await getValidAccount(mainWindow)
  await waitForCurrentProfileOperation(account.uuid)
  const cached = await getCachedRecord(account.uuid)

  const bytes = await fs.readFile(file).catch(() => {
    throw new Error('MegaClient could not read the selected skin file. It may have been moved or removed.')
  })
  if (!bytes.length) throw new Error('The selected skin file is empty.')
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Minecraft skins must be smaller than 2 MB.')

  const { width, height } = readPngDimensions(bytes)
  if (width !== 64 || (height !== 64 && height !== 32)) {
    throw new Error(`Minecraft skins must be 64×64 or legacy 64×32 pixels. This image is ${width}×${height}.`)
  }

  const uploadName = cleanUploadName(file)
  const { account: activeAccount, response } = await authorisedFetch(
    mainWindow,
    account,
    SKINS_URL,
    () => {
      const form = new FormData()
      form.append('variant', variant)
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), uploadName)
      return { method: 'POST', body: form }
    },
    35_000
  )

  const body = await response.text()
  if (!response.ok) throw apiError('upload the skin', response.status, body, response.headers.get('retry-after'))

  const payload = parseProfileBody(body)
  if (payload && (Array.isArray(payload.skins) || Array.isArray(payload.capes))) {
    return saveCache(activeAccount.uuid, normaliseProfile(payload, cached?.data))
  }

  return refreshSkinAfterEmptyResponse(mainWindow, activeAccount, cached?.data)
}

export async function switchCape(mainWindow: BrowserWindow, capeId?: string): Promise<MinecraftProfileData> {
  const account = await getValidAccount(mainWindow)
  await waitForCurrentProfileOperation(account.uuid)

  const cached = await getCachedRecord(account.uuid)
  const current = cached?.data ?? await requestProfileForAccount(mainWindow, account, true)
  const activeCape = current.capes.find((cape) => cape.state === 'active')

  if (capeId) {
    const owned = current.capes.some((cape) => cape.id === capeId)
    if (!owned) throw new Error('That cape is not available on this Minecraft account. Refresh the cape list and try again.')
    if (activeCape?.id === capeId) return current
  } else if (!activeCape) {
    return current
  }

  const { account: activeAccount, response } = await authorisedFetch(
    mainWindow,
    account,
    ACTIVE_CAPE_URL,
    () => ({
      method: capeId ? 'PUT' : 'DELETE',
      headers: capeId ? { 'Content-Type': 'application/json' } : undefined,
      body: capeId ? JSON.stringify({ capeId }) : undefined
    }),
    25_000
  )

  const body = await response.text()
  if (!response.ok) {
    throw apiError(capeId ? 'activate the cape' : 'hide the cape', response.status, body, response.headers.get('retry-after'))
  }

  const payload = parseProfileBody(body)
  const merged = payload
    ? normaliseProfile(payload, current)
    : { ...current, revision: Date.now() }

  // The cape endpoint may return no body, or a profile whose CDN state has not
  // caught up yet. A successful response is authoritative, so reflect the
  // requested state immediately while preserving every owned skin and cape.
  return saveCache(activeAccount.uuid, withCapeState(merged, capeId))
}
