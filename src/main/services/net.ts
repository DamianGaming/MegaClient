import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const USER_AGENT = 'MegaClient/1.7.1 (MegaStudios Minecraft Launcher)'

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) }
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Request failed (${response.status})${text ? `: ${text.slice(0, 240)}` : ''}`)
    }
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('The request timed out. Please try again.')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  return (await fetchWithTimeout(url, init)).json() as Promise<T>
}

export async function downloadFile(
  url: string,
  destination: string,
  onProgress?: (downloaded: number, total: number) => void,
  options: { maxBytes?: number; timeoutMs?: number } = {}
): Promise<void> {
  const response = await fetchWithTimeout(url, {}, options.timeoutMs ?? 120000)
  const total = Number(response.headers.get('content-length') ?? 0)
  if (options.maxBytes && total > options.maxBytes) throw new Error('The download is larger than MegaClient can safely install.')
  const body = response.body
  if (!body) throw new Error('The download returned no data.')
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temp = `${destination}.${process.pid}.${Date.now()}.download`
  const handle = await fs.open(temp, 'wx')
  let downloaded = 0
  try {
    const reader = body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      downloaded += value.byteLength
      if (options.maxBytes && downloaded > options.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('The download exceeded MegaClient’s safe size limit.')
      }
      await handle.write(value)
      onProgress?.(downloaded, total)
    }
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw error
  }
  await handle.close()
  await fs.rm(destination, { force: true }).catch(() => undefined)
  await fs.rename(temp, destination)
}

export async function hashFile(file: string, algorithm: 'sha1' | 'sha512'): Promise<string> {
  const hash = createHash(algorithm)
  const handle = await fs.open(file, 'r')
  try {
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) hash.update(chunk as Buffer)
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}
