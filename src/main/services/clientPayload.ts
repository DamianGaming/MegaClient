import { app } from 'electron'
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { readFabricModIdentity, verifyStagedClient } from './archiveChecks'
import { metadataDirectory, modsDirectory } from './paths'
import { protectedClientFor, PROTECTED_MINECRAFT_VERSIONS } from './protectedClientVersions'

const execFileAsync = promisify(execFile)
const MAGIC = Buffer.from('MCB1', 'ascii')
const AAD = Buffer.from('MegaClientPayload:v1', 'utf8')
export const EXPECTED_CLIENT_JAR_SHA256 = 'd780bb0595d7024139e00e827317e584e00fe70d492fc4d55908a2127293eb8c'
export const EXPECTED_VERIFIER_SHA256 = '37835a5c4dfb40ef1adf059c06780b18daa744298cdcb8238967c9f23b438537'
export const PROTECTED_CLIENT_VERSION = '0.14.3'
export const PROTECTED_MINECRAFT_VERSION = '26.2'
export const MINIMUM_PROTECTED_CLIENT_LOADER = '0.19.3'
export const PROTECTED_RUNTIME_PREFIX = 'mc-runtime-'

export interface PreparedClientPayload {
  jarPath: string
  verifierPath: string
  runtimeDirectory: string
  markerPath: string
  markerNonce: string
  sha256: string
  cleanup: () => Promise<void>
}

async function findBundledResource(fileName: string): Promise<string> {
  const candidates = [
    path.join(app.getAppPath(), 'resources', 'client', fileName),
    path.join(process.resourcesPath, 'app.asar', 'resources', 'client', fileName),
    path.join(process.resourcesPath, 'resources', 'client', fileName),
    path.join(process.resourcesPath, 'client', fileName)
  ]

  for (const candidate of [...new Set(candidates)]) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next development/packaged location.
    }
  }
  throw new Error(`The protected MegaClient resource ${fileName} is missing from the launcher installation.`)
}

function payloadKey(minecraftVersion: string, clientVersion: string): Buffer {
  const parts = ['MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', `${minecraftVersion}::${clientVersion}`]
  return createHash('sha256').update(parts.join('::'), 'utf8').digest()
}

async function hideAndRestrict(target: string, directory = false): Promise<void> {
  await fs.chmod(target, directory ? 0o700 : 0o600).catch(() => undefined)
  if (process.platform !== 'win32') return

  const username = process.env.USERNAME
  const domain = process.env.USERDOMAIN
  const principal = username ? (domain ? `${domain}\\${username}` : username) : undefined
  if (principal) {
    const permission = directory ? '(OI)(CI)F' : 'F'
    await execFileAsync('icacls.exe', [target, '/inheritance:r', '/grant:r', `${principal}:${permission}`], {
      windowsHide: true,
      timeout: 10_000
    }).catch(() => undefined)
  }
  // Fabric may ignore Windows hidden/system JARs during its normal mods scan.
  // Only private marker directories are hidden from ordinary Explorer views; runtime JARs keep restrictive ACLs
  // but remain ordinary readable files for Fabric Loader.
  if (directory) {
    await execFileAsync('attrib.exe', ['+H', target], { windowsHide: true }).catch(() => undefined)
  }
}

async function unhide(target: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileAsync('attrib.exe', ['-H', '-S', target], { windowsHide: true }).catch(() => undefined)
  }
}


// Cache metadata for unchanged unrelated mods; large Fabric packs otherwise cause
// repeated whole-JAR reads every launch just to discover that they are unrelated.
// Changed size/mtime always invalidates the cache, and protected IDs are never cached.
const unrelatedJarCache = new Map<string, { size: number; mtimeMs: number }>()

async function removeLegacyOrConflictingClients(directory: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const candidates = names.filter((name) => name.toLowerCase().endsWith('.jar') && !name.startsWith(PROTECTED_RUNTIME_PREFIX))
  let checked = 0
  for (const name of candidates) {
    const file = path.join(directory, name)
    try {
      const stat = await fs.stat(file)
      const cached = unrelatedJarCache.get(file)
      if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) continue
      const modId = await readFabricModIdentity(file)
      if (modId !== 'megaclient' && modId !== 'megaclient-launch-verifier') {
        unrelatedJarCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs })
        continue
      }
      unrelatedJarCache.delete(file)
      const hash = createHash('sha256').update(await fs.readFile(file)).digest('hex')
      if (modId === 'megaclient' && !PROTECTED_MINECRAFT_VERSIONS.some((version) => protectedClientFor(version).clientSha256 === hash)) {
        throw new Error(`Another enabled mod (${name}) uses the protected megaclient mod ID. Remove it before launching MegaClient.`)
      }
      await unhide(file)
      await fs.rm(file, { force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      if (error instanceof Error && error.message.includes('uses the protected megaclient mod ID')) throw error
      // Unreadable third-party JARs are handled by Fabric's normal diagnostics.
    } finally {
      checked++
      if (checked === candidates.length || checked % 8 === 0) onProgress?.(checked, candidates.length)
    }
  }
  while (unrelatedJarCache.size > 1200) {
    const first = unrelatedJarCache.keys().next().value
    if (!first) break
    unrelatedJarCache.delete(first)
  }
}

async function pruneStaleRuntimeFiles(directory: string): Promise<void> {
  const names = await fs.readdir(directory).catch(() => [] as string[])
  const cutoff = Date.now() - 6 * 60 * 60_000
  await Promise.all(names
    .filter((name) => name.startsWith(PROTECTED_RUNTIME_PREFIX) && name.endsWith('.jar'))
    .map(async (name) => {
      const file = path.join(directory, name)
      const stat = await fs.stat(file).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) {
        await unhide(file)
        await fs.rm(file, { force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
      }
    }))
}

async function pruneStaleMarkerDirectories(base: string): Promise<void> {
  const names = await fs.readdir(base).catch(() => [] as string[])
  const cutoff = Date.now() - 6 * 60 * 60_000
  await Promise.all(names
    .filter((name) => name.startsWith('session-'))
    .map(async (name) => {
      const directory = path.join(base, name)
      const stat = await fs.stat(directory).catch(() => null)
      if (stat && stat.mtimeMs < cutoff) {
        await unhide(directory)
        await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => undefined)
      }
    }))
}

export async function cleanupStaleProtectedClientArtifacts(instanceSlugs: string[]): Promise<void> {
  const uniqueSlugs = [...new Set(instanceSlugs.map((slug) => slug.trim()).filter(Boolean))]
  let cursor = 0
  const workerCount = Math.min(3, uniqueSlugs.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < uniqueSlugs.length) {
      const slug = uniqueSlugs[cursor++]!
      await Promise.all([
        pruneStaleRuntimeFiles(modsDirectory(slug)),
        pruneStaleMarkerDirectories(path.join(metadataDirectory(slug), 'protected-runtime'))
      ])
    }
  }))
}

async function bestEffortWipe(file: string): Promise<void> {
  try {
    const stat = await fs.stat(file)
    if (stat.isFile() && stat.size > 0) {
      const handle = await fs.open(file, 'r+')
      try {
        const block = Buffer.alloc(Math.min(stat.size, 1024 * 1024))
        let position = 0
        while (position < stat.size) {
          const length = Math.min(block.length, stat.size - position)
          randomBytes(length).copy(block, 0, 0, length)
          await handle.write(block, 0, length, position)
          position += length
        }
        await handle.sync()
        block.fill(0)
      } finally {
        await handle.close()
      }
    }
  } catch {
    // Temporary files are still removed when an overwrite is unavailable.
  }
}


function normaliseJvmPath(file: string): string {
  return path.resolve(file).replaceAll('\\', '/')
}

export async function prepareClientPayload(instanceSlug: string, minecraftVersion: string, onProgress?: (done: number, total: number) => void): Promise<PreparedClientPayload> {
  const client = protectedClientFor(minecraftVersion)
  const [bundle, verifier] = await Promise.all([
    fs.readFile(await findBundledResource(client.bundle)),
    fs.readFile(await findBundledResource(client.verifier))
  ])
  if (bundle.length < 48 || !bundle.subarray(0, 4).equals(MAGIC)) {
    verifier.fill(0)
    throw new Error('The bundled MegaClient payload is invalid or damaged.')
  }
  if (createHash('sha256').update(verifier).digest('hex') !== client.verifierSha256) {
    verifier.fill(0)
    throw new Error('The MegaClient launch verifier failed its integrity check.')
  }

  const nonce = bundle.subarray(4, 16)
  const encryptedWithTag = bundle.subarray(16)
  const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16)
  const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', payloadKey(client.minecraftVersion, client.clientVersion), nonce)
  decipher.setAAD(AAD)
  decipher.setAuthTag(tag)
  const jar = Buffer.concat([decipher.update(encrypted), decipher.final()])

  const hash = createHash('sha256').update(jar).digest('hex')
  if (hash !== client.clientSha256) {
    jar.fill(0)
    verifier.fill(0)
    throw new Error('MegaClient payload integrity verification failed.')
  }

  // Fabric's ordinary instance mods scan is the most reliable loading path.
  // These randomly named files exist only in this isolated instance while the
  // game is running; the encrypted bundle remains the only at-rest copy.
  const mods = modsDirectory(instanceSlug)
  const markerBase = path.join(metadataDirectory(instanceSlug), 'protected-runtime')
  await Promise.all([
    fs.mkdir(mods, { recursive: true }),
    fs.mkdir(markerBase, { recursive: true, mode: 0o700 })
  ])
  await hideAndRestrict(markerBase, true)
  await pruneStaleRuntimeFiles(mods)
  await removeLegacyOrConflictingClients(mods, onProgress)
  await pruneStaleMarkerDirectories(markerBase)

  const runtimeDirectory = await fs.mkdtemp(path.join(markerBase, 'session-'))
  await hideAndRestrict(runtimeDirectory, true)
  const token = randomBytes(18).toString('hex')
  const jarPath = path.join(mods, `${PROTECTED_RUNTIME_PREFIX}${token}.jar`)
  const verifierPath = path.join(mods, `${PROTECTED_RUNTIME_PREFIX}${randomBytes(18).toString('hex')}.jar`)
  const markerPath = path.join(runtimeDirectory, `${randomBytes(18).toString('hex')}.state`)
  const markerNonce = randomBytes(32).toString('hex')
  const manifestPath = path.join(runtimeDirectory, 'session.json')

  try {
    await Promise.all([
      fs.writeFile(jarPath, jar, { mode: 0o600, flag: 'wx' }),
      fs.writeFile(verifierPath, verifier, { mode: 0o600, flag: 'wx' })
    ])
    jar.fill(0)
    verifier.fill(0)
    await Promise.all([hideAndRestrict(jarPath), hideAndRestrict(verifierPath)])
    await fs.writeFile(manifestPath, JSON.stringify({
      createdAt: new Date().toISOString(),
      client: path.basename(jarPath),
      verifier: path.basename(verifierPath),
      clientSha256: client.clientSha256,
      verifierSha256: client.verifierSha256
    }), { mode: 0o600, flag: 'wx' })
    await hideAndRestrict(manifestPath)
    await verifyStagedClient(jarPath, verifierPath, hash, client.clientSha256, client.verifierSha256,
      client.clientVersion, client.minecraftVersion, client.minimumFabricLoader, client.javaClassVersion)
  } catch (error) {
    jar.fill(0)
    verifier.fill(0)
    await Promise.all([unhide(jarPath), unhide(verifierPath), unhide(runtimeDirectory)])
    await Promise.all([
      fs.rm(jarPath, { force: true }).catch(() => undefined),
      fs.rm(verifierPath, { force: true }).catch(() => undefined),
      fs.rm(runtimeDirectory, { recursive: true, force: true }).catch(() => undefined)
    ])
    throw error
  }

  let cleaned = false
  return {
    jarPath: normaliseJvmPath(jarPath),
    verifierPath: normaliseJvmPath(verifierPath),
    runtimeDirectory,
    markerPath: normaliseJvmPath(markerPath),
    markerNonce,
    sha256: hash,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await Promise.all([unhide(jarPath), unhide(verifierPath), unhide(runtimeDirectory)])
      await Promise.all([bestEffortWipe(jarPath), bestEffortWipe(verifierPath), bestEffortWipe(markerPath), bestEffortWipe(manifestPath)])
      await Promise.all([
        fs.rm(jarPath, { force: true, maxRetries: 8, retryDelay: 350 }).catch(() => undefined),
        fs.rm(verifierPath, { force: true, maxRetries: 8, retryDelay: 350 }).catch(() => undefined),
        fs.rm(runtimeDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 350 }).catch(() => undefined)
      ])
    }
  }
}


export async function validatePreparedClientPayload(payload: PreparedClientPayload, minecraftVersion: string): Promise<void> {
  const client = protectedClientFor(minecraftVersion)
  await verifyStagedClient(payload.jarPath, payload.verifierPath, payload.sha256,
    client.clientSha256, client.verifierSha256,
    client.clientVersion, client.minecraftVersion,
    client.minimumFabricLoader, client.javaClassVersion)
}
