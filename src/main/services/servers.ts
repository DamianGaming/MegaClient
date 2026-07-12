import net from 'node:net'
import { promises as dns } from 'node:dns'

export interface PartnerServerStatus {
  online: boolean
  address: string
  host: string
  port: number
  latency?: number
  version?: string
  protocol?: number
  players?: { online: number; max: number; sample: string[] }
  motd?: string
  icon?: string
  checkedAt: string
  error?: string
}

const statusCache = new Map<string, { value: PartnerServerStatus; expiresAt: number }>()

function readVarInt(buffer: Buffer, offset = 0): { value: number; bytes: number } | null {
  let value = 0
  let position = 0
  let currentOffset = offset
  while (currentOffset < buffer.length) {
    const current = buffer[currentOffset]!
    value |= (current & 0x7f) << position
    currentOffset++
    if ((current & 0x80) === 0) return { value, bytes: currentOffset - offset }
    position += 7
    if (position >= 35) throw new Error('The server returned an invalid status packet.')
  }
  return null
}

function writeVarInt(value: number): Buffer {
  const bytes: number[] = []
  let current = value >>> 0
  do {
    let part = current & 0x7f
    current >>>= 7
    if (current !== 0) part |= 0x80
    bytes.push(part)
  } while (current !== 0)
  return Buffer.from(bytes)
}

function minecraftString(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(encoded.length), encoded])
}

function packet(payload: Buffer): Buffer {
  return Buffer.concat([writeVarInt(payload.length), payload])
}

function flattenDescription(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const object = value as { text?: unknown; extra?: unknown[]; translate?: unknown }
  const parts: string[] = []
  if (typeof object.text === 'string') parts.push(object.text)
  if (typeof object.translate === 'string' && !parts.length) parts.push(object.translate)
  if (Array.isArray(object.extra)) parts.push(...object.extra.map(flattenDescription))
  return parts.join('').replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim()
}

function parseAddress(address: string): { host: string; port?: number } {
  const trimmed = address.trim()
  if (!trimmed || trimmed.length > 255) throw new Error('The server address is invalid.')
  if (trimmed.startsWith('[')) {
    const match = trimmed.match(/^\[([^\]]+)](?::(\d{1,5}))?$/)
    if (!match) throw new Error('The server address is invalid.')
    const port = match[2] ? Number(match[2]) : undefined
    if (port != null && (port < 1 || port > 65535)) throw new Error('The server port is invalid.')
    return { host: match[1]!, port }
  }
  const lastColon = trimmed.lastIndexOf(':')
  if (lastColon > 0 && trimmed.indexOf(':') === lastColon) {
    const possiblePort = trimmed.slice(lastColon + 1)
    if (/^\d{1,5}$/.test(possiblePort)) {
      const port = Number(possiblePort)
      if (port < 1 || port > 65535) throw new Error('The server port is invalid.')
      return { host: trimmed.slice(0, lastColon), port }
    }
  }
  return { host: trimmed }
}

async function resolveTarget(address: string): Promise<{ displayHost: string; host: string; port: number }> {
  const parsed = parseAddress(address)
  if (parsed.port) return { displayHost: parsed.host, host: parsed.host, port: parsed.port }
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${parsed.host}`)
    const record = records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
    if (record) return { displayHost: parsed.host, host: record.name.replace(/\.$/, ''), port: record.port }
  } catch {
    // Most servers use the default port and do not publish an SRV record.
  }
  return { displayHost: parsed.host, host: parsed.host, port: 25565 }
}

async function queryStatus(address: string): Promise<PartnerServerStatus> {
  const target = await resolveTarget(address)
  const startedAt = performance.now()
  const response = await new Promise<any>((resolve, reject) => {
    const socket = net.createConnection({ host: target.host, port: target.port })
    const chunks: Buffer[] = []
    let total = 0
    let finished = false
    const finish = (error?: Error, value?: unknown): void => {
      if (finished) return
      finished = true
      socket.destroy()
      error ? reject(error) : resolve(value)
    }
    socket.setTimeout(5500, () => finish(new Error('The server did not respond in time.')))
    socket.once('error', (error) => finish(error))
    socket.once('connect', () => {
      const handshakePayload = Buffer.concat([
        writeVarInt(0),
        writeVarInt(47),
        minecraftString(target.displayHost),
        Buffer.from([(target.port >> 8) & 0xff, target.port & 0xff]),
        writeVarInt(1)
      ])
      socket.write(packet(handshakePayload))
      socket.write(packet(writeVarInt(0)))
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total > 2 * 1024 * 1024) return finish(new Error('The server status response was unexpectedly large.'))
      const buffer = Buffer.concat(chunks, total)
      const packetLength = readVarInt(buffer)
      if (!packetLength || buffer.length < packetLength.bytes + packetLength.value) return
      let offset = packetLength.bytes
      const packetId = readVarInt(buffer, offset)
      if (!packetId) return
      offset += packetId.bytes
      if (packetId.value !== 0) return finish(new Error('The server returned an unexpected status packet.'))
      const jsonLength = readVarInt(buffer, offset)
      if (!jsonLength) return
      offset += jsonLength.bytes
      if (buffer.length < offset + jsonLength.value) return
      try {
        finish(undefined, JSON.parse(buffer.subarray(offset, offset + jsonLength.value).toString('utf8')))
      } catch {
        finish(new Error('The server returned invalid status information.'))
      }
    })
  })

  const sample = Array.isArray(response.players?.sample)
    ? response.players.sample.slice(0, 8).map((item: any) => String(item?.name ?? '')).filter(Boolean)
    : []
  const favicon = typeof response.favicon === 'string' && response.favicon.startsWith('data:image/png;base64,')
    ? response.favicon
    : undefined

  return {
    online: true,
    address,
    host: target.displayHost,
    port: target.port,
    latency: Math.max(0, Math.round(performance.now() - startedAt)),
    version: typeof response.version?.name === 'string' ? response.version.name : undefined,
    protocol: typeof response.version?.protocol === 'number' ? response.version.protocol : undefined,
    players: {
      online: Number(response.players?.online ?? 0),
      max: Number(response.players?.max ?? 0),
      sample
    },
    motd: flattenDescription(response.description),
    icon: favicon,
    checkedAt: new Date().toISOString()
  }
}

export async function getPartnerServerStatus(address: string, force = false): Promise<PartnerServerStatus> {
  const key = address.trim().toLowerCase()
  const cached = statusCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now()) return cached.value
  try {
    const value = await queryStatus(address)
    statusCache.set(key, { value, expiresAt: Date.now() + 30_000 })
    return value
  } catch (error) {
    const value: PartnerServerStatus = {
      online: false,
      address,
      host: parseAddress(address).host,
      port: parseAddress(address).port ?? 25565,
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    }
    statusCache.set(key, { value, expiresAt: Date.now() + 12_000 })
    return value
  }
}
