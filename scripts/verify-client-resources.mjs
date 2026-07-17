import { createDecipheriv, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundlePath = path.join(root, 'resources', 'client', 'megaclient.bundle')
const verifierPath = path.join(root, 'resources', 'client', 'launch-verifier.jar')
const servicePath = path.join(root, 'src', 'main', 'services', 'clientPayload.ts')
const EXPECTED_VERIFIER_SHA256 = '0fc6775b6991b2a6810e7933a915f6ba3982d6559e12fd43035b66173cc268dc'
const EXPECTED_ID = 'megaclient'
const EXPECTED_VERSION = '0.11.11'

const service = await fs.readFile(servicePath, 'utf8')
const expectedClient = service.match(/EXPECTED_CLIENT_JAR_SHA256\s*=\s*'([a-f0-9]{64})'/)?.[1]
if (!expectedClient) throw new Error('Could not read EXPECTED_CLIENT_JAR_SHA256 from clientPayload.ts.')

const [bundle, verifier] = await Promise.all([fs.readFile(bundlePath), fs.readFile(verifierPath)])
if (bundle.length < 48 || bundle.subarray(0, 4).toString('ascii') !== 'MCB1') {
  throw new Error('megaclient.bundle has an invalid header.')
}
const verifierHash = createHash('sha256').update(verifier).digest('hex')
if (verifierHash !== EXPECTED_VERIFIER_SHA256) {
  throw new Error(`Launch verifier integrity mismatch: ${verifierHash}`)
}

const keyParts = ['MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', '26.2::0.11.11']
const key = createHash('sha256').update(keyParts.join('::'), 'utf8').digest()
const nonce = bundle.subarray(4, 16)
const encryptedWithTag = bundle.subarray(16)
const tag = encryptedWithTag.subarray(encryptedWithTag.length - 16)
const encrypted = encryptedWithTag.subarray(0, encryptedWithTag.length - 16)
const decipher = createDecipheriv('aes-256-gcm', key, nonce)
decipher.setAAD(Buffer.from('MegaClientPayload:v1', 'utf8'))
decipher.setAuthTag(tag)
const jar = Buffer.concat([decipher.update(encrypted), decipher.final()])
const clientHash = createHash('sha256').update(jar).digest('hex')
if (clientHash !== expectedClient) throw new Error(`Protected client integrity mismatch: ${clientHash}`)

const archive = new AdmZip(jar)
const metadataEntry = archive.getEntry('fabric.mod.json')
if (!metadataEntry) throw new Error('Protected client is missing fabric.mod.json.')
const metadata = JSON.parse(metadataEntry.getData().toString('utf8'))
if (metadata.id !== EXPECTED_ID || metadata.version !== EXPECTED_VERSION) {
  throw new Error(`Protected client metadata must be ${EXPECTED_ID} ${EXPECTED_VERSION}.`)
}
if (metadata.environment !== 'client' || !metadata.entrypoints?.client?.length) {
  throw new Error('Protected client metadata has no valid client entrypoint.')
}
jar.fill(0)
verifier.fill(0)

console.log(`[MegaClient] Protected client verified: ${EXPECTED_ID} ${EXPECTED_VERSION}`)
console.log(`[MegaClient] Client SHA-256: ${clientHash}`)
console.log(`[MegaClient] Verifier SHA-256: ${verifierHash}`)
