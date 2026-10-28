import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import { readProtectedClientCatalog } from './client-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = process.argv[2]
if (!source) throw new Error('Usage: npm run client:protect -- "C:\\path\\to\\megaclient.jar"')
const jarPath = path.resolve(source)
if (path.extname(jarPath).toLowerCase() !== '.jar') throw new Error('Select a .jar file.')
const jar = await fs.readFile(jarPath)
if (jar.length < 1024) throw new Error('The selected client JAR is empty or damaged.')

const archive = new AdmZip(jar)
const entry = archive.getEntry('fabric.mod.json')
if (!entry) throw new Error('Client JAR has no fabric.mod.json')
const metadata = JSON.parse(entry.getData().toString('utf8'))
const gameVersion = String(metadata.depends?.minecraft ?? '').replace(/^~/, '')
const config = readProtectedClientCatalog(root).find((item) => item.minecraftVersion === gameVersion)
if (!config) throw new Error(`The launcher does not support protected Minecraft ${gameVersion}.`)
if (metadata.id !== 'megaclient' || metadata.version !== config.clientVersion ||
    metadata.depends.fabricloader !== `>=${config.minimumFabricLoader}` ||
    metadata.depends['fabric-api'] !== `>=${config.minimumFabricApi}+${gameVersion}`) {
  throw new Error(`The supplied client is not the configured MegaClient ${config.clientVersion} for Minecraft ${gameVersion}.`)
}
const verifier = new AdmZip(await fs.readFile(path.join(root, 'resources/client', config.verifier)))
const verifierMetadata = JSON.parse(verifier.getEntry('fabric.mod.json')?.getData()?.toString('utf8') ?? '{}')
const verifierClass = verifier.getEntry('studio/megastudios/megaclient/launchguard/LaunchVerifier.class')?.getData()
if (verifierMetadata.depends?.minecraft !== `~${gameVersion}` ||
    verifierMetadata.depends?.megaclient !== `=${config.clientVersion}` ||
    !verifierClass?.includes(Buffer.from(config.clientVersion))) {
  throw new Error(`Bundled verifier for Minecraft ${gameVersion} is incompatible with this client.`)
}
const key = createHash('sha256').update([
  'MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', `${gameVersion}::${config.clientVersion}`
].join('::')).digest()
const nonce = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', key, nonce)
cipher.setAAD(Buffer.from('MegaClientPayload:v1'))
const encrypted = Buffer.concat([cipher.update(jar), cipher.final()])
const bundle = Buffer.concat([Buffer.from('MCB1'), nonce, encrypted, cipher.getAuthTag()])
const hash = createHash('sha256').update(jar).digest('hex')

const catalogFile = path.join(root, 'src/main/services/protectedClientVersions.ts')
let catalog = await fs.readFile(catalogFile, 'utf8')
const entryPattern = new RegExp(`(  '${gameVersion.replaceAll('.', '\\.')}': \\{[\\s\\S]*?clientSha256: ')[a-f0-9]{64}(')`)
if (!entryPattern.test(catalog)) throw new Error('Cannot update client checksum in protected client catalogue')
catalog = catalog.replace(entryPattern, `$1${hash}$2`)
// Keep the original 26.2 legacy export synchronized for existing tooling/tests.
if (gameVersion === '26.2') {
  const serviceFile = path.join(root, 'src/main/services/clientPayload.ts')
  const service = await fs.readFile(serviceFile, 'utf8')
  await fs.writeFile(serviceFile, service.replace(/(EXPECTED_CLIENT_JAR_SHA256 = ')[a-f0-9]{64}(')/, `$1${hash}$2`))
}
await fs.writeFile(path.join(root, 'resources/client', config.bundle), bundle)
await fs.writeFile(catalogFile, catalog)
jar.fill(0)
console.log(`[MegaClient] Protected Minecraft ${gameVersion} client ${config.clientVersion}; SHA-256 ${hash}`)
console.log('[MegaClient] Run npm run client:verify, npm run test:release and npm run build before release.')
