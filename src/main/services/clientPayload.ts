import { app } from 'electron'
import { createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { metadataDirectory, modsDirectory } from './paths'

const execFileAsync = promisify(execFile)
const MAGIC = Buffer.from('MCB1', 'ascii')
const AAD = Buffer.from('MegaClientPayload:v1', 'utf8')
export const EXPECTED_CLIENT_JAR_SHA256 = 'cba1cb5623b88194f87f38eec9642b3bc137c938bf4735f9ae72f787b849c8e8'
const EXPECTED_VERIFIER_SHA256 = '0fc6775b6991b2a6810e7933a915f6ba3982d6559e12fd43035b66173cc268dc'
export const PROTECTED_CLIENT_VERSION = '0.11.11'
export const PROTECTED_MINECRAFT_VERSION = '26.2'
export const MINIMUM_PROTECTED_CLIENT_LOADER = '0.19.3'
const KEY_PARTS = ['MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', `${PROTECTED_MINECRAFT_VERSION}::${PROTECTED_CLIENT_VERSION}`] as const
const EXPECTED_CLIENT_CLASS_VERSION = 69 // Java 25
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

function payloadKey(): Buffer {
  return createHash('sha256').update(KEY_PARTS.join('::'), 'utf8').digest()
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


async function removeLegacyOrConflictingClients(directory: string): Promise<void> {
  const names = await fs.readdir(directory).catch(() => [] as string[])
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.jar') || name.startsWith(PROTECTED_RUNTIME_PREFIX)) continue
    const file = path.join(directory, name)
    try {
      const archive = new AdmZip(file)
      const entry = archive.getEntry('fabric.mod.json')
      if (!entry) continue
      const metadata = JSON.parse(entry.getData().toString('utf8')) as { id?: string }
      if (metadata.id !== 'megaclient' && metadata.id !== 'megaclient-launch-verifier') continue
      const hash = createHash('sha256').update(await fs.readFile(file)).digest('hex')
      if (metadata.id === 'megaclient' && hash !== EXPECTED_CLIENT_JAR_SHA256) {
        throw new Error(`Another enabled mod (${name}) uses the protected megaclient mod ID. Remove it before launching MegaClient.`)
      }
      await unhide(file)
      await fs.rm(file, { force: true, maxRetries: 5, retryDelay: 200 })
    } catch (error) {
      if (error instanceof Error && error.message.includes('uses the protected megaclient mod ID')) throw error
      // Unreadable third-party JARs are handled by Fabric's normal diagnostics.
    }
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

function verifyFabricMetadata(jarPath: string): void {
  const archive = new AdmZip(jarPath)
  const metadataEntry = archive.getEntry('fabric.mod.json')
  if (!metadataEntry) throw new Error('The protected MegaClient JAR is missing fabric.mod.json.')
  const metadata = JSON.parse(metadataEntry.getData().toString('utf8')) as {
    id?: string
    version?: string
    environment?: string
    entrypoints?: { client?: string[] }
    depends?: Record<string, string>
  }
  if (metadata.id !== 'megaclient' || metadata.version !== PROTECTED_CLIENT_VERSION) {
    throw new Error(`The protected client metadata does not match MegaClient ${PROTECTED_CLIENT_VERSION}.`)
  }
  if (metadata.environment !== 'client' || !metadata.entrypoints?.client?.includes('dev.velora.client.VeloraClient')) {
    throw new Error('The protected MegaClient JAR has no valid client entrypoint.')
  }
  if (metadata.depends?.minecraft !== `~${PROTECTED_MINECRAFT_VERSION}` || metadata.depends?.fabricloader !== `>=${MINIMUM_PROTECTED_CLIENT_LOADER}`) {
    throw new Error('The protected MegaClient JAR has unexpected Minecraft or Fabric requirements.')
  }

  const clientClass = archive.getEntry('dev/velora/client/VeloraClient.class')?.getData()
  if (!clientClass || clientClass.length < 8 || clientClass.readUInt32BE(0) !== 0xcafebabe) {
    throw new Error('The protected MegaClient entrypoint class is missing or invalid.')
  }
  if (clientClass.readUInt16BE(6) !== EXPECTED_CLIENT_CLASS_VERSION) {
    throw new Error('The protected MegaClient JAR was not compiled for the expected Java 25 runtime.')
  }
  if (!archive.getEntry('velora.client.mixins.json')) {
    throw new Error('The protected MegaClient JAR is missing its required mixin configuration.')
  }
}

function normaliseJvmPath(file: string): string {
  return path.resolve(file).replaceAll('\\', '/')
}

export async function prepareClientPayload(instanceSlug: string): Promise<PreparedClientPayload> {
  const [bundle, verifier] = await Promise.all([
    fs.readFile(await findBundledResource('megaclient.bundle')),
    fs.readFile(await findBundledResource('launch-verifier.jar'))
  ])
  if (bundle.length < 48 || !bundle.subarray(0, 4).equals(MAGIC)) {
    verifier.fill(0)
    throw new Error('The bundled MegaClient payload is invalid or damaged.')
  }
  if (createHash('sha256').update(verifier).digest('hex') !== EXPECTED_VERIFIER_SHA256) {
    verifier.fill(0)
    throw new Error('The MegaClient launch verifier failed its integrity check.')
  }

  const nonce = bundle.subarray(4, 16)
  const encryptedWithTag = bundle.subarray(16)
  const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16)
  const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', payloadKey(), nonce)
  decipher.setAAD(AAD)
  decipher.setAuthTag(tag)
  const jar = Buffer.concat([decipher.update(encrypted), decipher.final()])

  const hash = createHash('sha256').update(jar).digest('hex')
  if (hash !== EXPECTED_CLIENT_JAR_SHA256) {
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
  await removeLegacyOrConflictingClients(mods)
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
      clientSha256: EXPECTED_CLIENT_JAR_SHA256,
      verifierSha256: EXPECTED_VERIFIER_SHA256
    }), { mode: 0o600, flag: 'wx' })
    await hideAndRestrict(manifestPath)
    verifyFabricMetadata(jarPath)

    const [writtenClient, writtenVerifier] = await Promise.all([fs.readFile(jarPath), fs.readFile(verifierPath)])
    const writtenHash = createHash('sha256').update(writtenClient).digest('hex')
    const writtenVerifierHash = createHash('sha256').update(writtenVerifier).digest('hex')
    writtenClient.fill(0)
    writtenVerifier.fill(0)
    if (writtenHash !== EXPECTED_CLIENT_JAR_SHA256) throw new Error('The prepared MegaClient runtime JAR failed verification.')
    if (writtenVerifierHash !== EXPECTED_VERIFIER_SHA256) throw new Error('The prepared MegaClient launch verifier failed verification.')
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


export function validatePreparedClientPayloadSync(payload: PreparedClientPayload): void {
  const client = readFileSync(payload.jarPath)
  const verifier = readFileSync(payload.verifierPath)
  try {
    const clientHash = createHash('sha256').update(client).digest('hex')
    const verifierHash = createHash('sha256').update(verifier).digest('hex')
    if (clientHash !== EXPECTED_CLIENT_JAR_SHA256 || clientHash !== payload.sha256) {
      throw new Error('The staged MegaClient runtime changed before Fabric could start.')
    }
    if (verifierHash !== EXPECTED_VERIFIER_SHA256) {
      throw new Error('The staged MegaClient verifier changed before Fabric could start.')
    }
    if (!payload.jarPath.toLowerCase().endsWith('.jar') || !payload.verifierPath.toLowerCase().endsWith('.jar')) {
      throw new Error('The protected runtime files no longer have valid Fabric JAR names.')
    }
    verifyFabricMetadata(payload.jarPath)
  } finally {
    client.fill(0)
    verifier.fill(0)
  }
}
