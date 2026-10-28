import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { readProtectedClientCatalog } from './client-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clients = readProtectedClientCatalog(root)
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

for (const config of clients) {
  const label = `Minecraft ${config.minecraftVersion}`
  const [bundle, verifier] = await Promise.all([
    fs.readFile(path.join(root, 'resources/client', config.bundle)),
    fs.readFile(path.join(root, 'resources/client', config.verifier))
  ])
  if (bundle.length < 48 || bundle.subarray(0, 4).toString('ascii') !== 'MCB1') {
    throw new Error(`${label}: the protected client bundle has an invalid header`)
  }
  if (sha256(verifier) !== config.verifierSha256) throw new Error(`${label}: launch verifier integrity mismatch`)
  const verifierArchive = new AdmZip(verifier)
  const verifierMod = verifierArchive.getEntry('fabric.mod.json')
  const verifierClass = verifierArchive.getEntry('studio/megastudios/megaclient/launchguard/LaunchVerifier.class')
  if (!verifierMod || !verifierClass) throw new Error(`${label}: launch verifier is incomplete`)
  const verifierMeta = JSON.parse(verifierMod.getData().toString('utf8'))
  if (verifierMeta.id !== 'megaclient-launch-verifier' ||
      verifierMeta.depends?.minecraft !== `~${config.minecraftVersion}` ||
      verifierMeta.depends?.fabricloader !== `>=${config.minimumFabricLoader}` ||
      verifierMeta.depends?.megaclient !== `=${config.clientVersion}` ||
      !verifierClass.getData().includes(Buffer.from(config.clientVersion, 'utf8'))) {
    throw new Error(`${label}: verifier has a mismatched game, loader or client version`)
  }

  const key = createHash('sha256').update([
    'MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios',
    `${config.minecraftVersion}::${config.clientVersion}`
  ].join('::')).digest()
  const nonce = bundle.subarray(4, 16)
  const tag = bundle.subarray(bundle.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(Buffer.from('MegaClientPayload:v1'))
  decipher.setAuthTag(tag)
  const client = Buffer.concat([decipher.update(bundle.subarray(16, -16)), decipher.final()])
  try {
    if (sha256(client) !== config.clientSha256) throw new Error(`${label}: client SHA-256 mismatch`)
    const archive = new AdmZip(client)
    const entry = archive.getEntry('fabric.mod.json')
    if (!entry) throw new Error(`${label}: client is missing fabric.mod.json`)
    const mod = JSON.parse(entry.getData().toString('utf8'))
    if (mod.id !== 'megaclient' || mod.version !== config.clientVersion || mod.environment !== 'client' ||
        !mod.entrypoints?.client?.includes('dev.velora.client.VeloraClient') ||
        mod.depends?.minecraft !== `~${config.minecraftVersion}` ||
        mod.depends?.fabricloader !== `>=${config.minimumFabricLoader}` ||
        !String(mod.depends?.['fabric-api'] ?? '').startsWith(`>=${config.minimumFabricApi}+${config.minecraftVersion}`) ||
        mod.depends?.java !== '>=25') {
      throw new Error(`${label}: bundled Fabric metadata does not match the launcher configuration`)
    }
    const classBytes = archive.getEntry('dev/velora/client/VeloraClient.class')?.getData()
    if (!classBytes || classBytes.readUInt32BE(0) !== 0xcafebabe || classBytes.readUInt16BE(6) !== 69) {
      throw new Error(`${label}: client entrypoint does not target the expected Java version`)
    }
    console.log(`[MegaClient] ${label}: protected client ${config.clientVersion} verified`)
    console.log(`[MegaClient] Client SHA-256: ${config.clientSha256}`)
    console.log(`[MegaClient] Verifier SHA-256: ${config.verifierSha256}`)
  } finally {
    client.fill(0)
    verifier.fill(0)
  }
}
