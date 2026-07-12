import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
if (!source) {
  console.error('Usage: npm run client:protect -- "C:\\path\\to\\megaclient.jar"')
  process.exit(1)
}

const jarPath = path.resolve(source)
const jar = await fs.readFile(jarPath)
if (path.extname(jarPath).toLowerCase() !== '.jar' || jar.length < 1024) {
  throw new Error('The selected client payload must be a valid non-empty .jar file.')
}

const archive = new AdmZip(jar)
const entry = archive.getEntry('fabric.mod.json')
if (!entry) throw new Error('The selected JAR is missing fabric.mod.json.')
const metadata = JSON.parse(entry.getData().toString('utf8'))
if (metadata.id !== 'megaclient' || metadata.version !== '0.9.6') {
  throw new Error('The selected JAR must use mod ID megaclient and version 0.9.6 for this launcher build.')
}
if (metadata.environment !== 'client' || !metadata.entrypoints?.client?.length) {
  throw new Error('The selected JAR has no valid Fabric client entrypoint.')
}

const parts = ['MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', '26.2::0.9.6']
const key = createHash('sha256').update(parts.join('::'), 'utf8').digest()
const nonce = randomBytes(12)
const aad = Buffer.from('MegaClientPayload:v1', 'utf8')
const cipher = createCipheriv('aes-256-gcm', key, nonce)
cipher.setAAD(aad)
const encrypted = Buffer.concat([cipher.update(jar), cipher.final()])
const tag = cipher.getAuthTag()
const bundle = Buffer.concat([Buffer.from('MCB1', 'ascii'), nonce, encrypted, tag])
const hash = createHash('sha256').update(jar).digest('hex')

const bundlePath = path.join(projectRoot, 'resources', 'client', 'megaclient.bundle')
await fs.mkdir(path.dirname(bundlePath), { recursive: true })
await fs.writeFile(bundlePath, bundle)

const servicePath = path.join(projectRoot, 'src', 'main', 'services', 'clientPayload.ts')
let service = await fs.readFile(servicePath, 'utf8')
const pattern = /export const EXPECTED_CLIENT_JAR_SHA256 = '[a-f0-9]{64}'/
if (!pattern.test(service)) throw new Error('Could not update EXPECTED_CLIENT_JAR_SHA256 in clientPayload.ts.')
service = service.replace(pattern, `export const EXPECTED_CLIENT_JAR_SHA256 = '${hash}'`)
await fs.writeFile(servicePath, service, 'utf8')
jar.fill(0)

console.log(`[MegaClient] Protected ${path.basename(jarPath)}`)
console.log(`[MegaClient] Bundle: ${bundlePath}`)
console.log(`[MegaClient] SHA-256: ${hash}`)
console.log('[MegaClient] Run npm run client:verify and npm run build before packaging a release.')
