import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDecipheriv, createHash } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (relative) => readFileSync(path.join(root, relative))
const sourceText = (relative) => source(relative).toString('utf8')
const capture = (expression, input) => {
  const result = input.match(expression)
  assert.ok(result, `Missing metadata: ${expression}`)
  return result[1]
}

// Extract a small entry using built-in Node APIs, keeping release tests usable
// before npm dependencies are installed. Both built-in JARs are standard ZIPs.
function jarEntry(archive, entryName) {
  let end = -1
  for (let index = archive.length - 22; index >= Math.max(0, archive.length - 65557); index--) {
    if (archive.readUInt32LE(index) === 0x06054b50) { end = index; break }
  }
  assert.ok(end >= 0, 'JAR has no ZIP end-of-central-directory marker')
  let position = archive.readUInt32LE(end + 16)
  const count = archive.readUInt16LE(end + 10)
  for (let index = 0; index < count; index++) {
    assert.equal(archive.readUInt32LE(position), 0x02014b50, 'Invalid JAR central directory')
    const method = archive.readUInt16LE(position + 10)
    const packedLength = archive.readUInt32LE(position + 20)
    const nameLength = archive.readUInt16LE(position + 28)
    const extraLength = archive.readUInt16LE(position + 30)
    const commentLength = archive.readUInt16LE(position + 32)
    const name = archive.subarray(position + 46, position + 46 + nameLength).toString('utf8')
    if (name === entryName) {
      const local = archive.readUInt32LE(position + 42)
      assert.equal(archive.readUInt32LE(local), 0x04034b50, 'Invalid local JAR entry')
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
      const compressed = archive.subarray(start, start + packedLength)
      if (method === 0) return compressed
      if (method === 8) return inflateRawSync(compressed)
      throw new Error(`Unsupported ZIP compression: ${method}`)
    }
    position += 46 + nameLength + extraLength + commentLength
  }
  assert.fail(`Missing JAR entry: ${entryName}`)
}

test('encrypted client decrypts to its expected content hash', () => {
  const service = sourceText('src/main/services/clientPayload.ts')
  const expected = capture(/EXPECTED_CLIENT_JAR_SHA256 = '([a-f0-9]{64})'/, service)
  const version = capture(/PROTECTED_CLIENT_VERSION = '([^']+)'/, service)
  const minecraft = capture(/PROTECTED_MINECRAFT_VERSION = '([^']+)'/, service)
  const bundle = source('resources/client/megaclient.bundle')
  assert.equal(bundle.subarray(0, 4).toString('ascii'), 'MCB1')
  const pieces = ['MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios', `${minecraft}::${version}`]
  const key = createHash('sha256').update(pieces.join('::')).digest()
  const iv = bundle.subarray(4, 16)
  const authTag = bundle.subarray(bundle.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from('MegaClientPayload:v1'))
  decipher.setAuthTag(authTag)
  const data = Buffer.concat([decipher.update(bundle.subarray(16, bundle.length - 16)), decipher.final()])
  assert.equal(data.subarray(0, 2).toString('ascii'), 'PK')
  assert.equal(createHash('sha256').update(data).digest('hex'), expected)
  const metadata = JSON.parse(jarEntry(data, 'fabric.mod.json').toString('utf8'))
  assert.equal(metadata.id, 'megaclient')
  assert.equal(metadata.version, version)
  assert.equal(metadata.depends.minecraft, `~${minecraft}`)
  assert.equal(metadata.depends.fabricloader, '>=0.19.3')
  assert.equal(metadata.depends.java, '>=25')
  assert.equal(metadata.depends['fabric-api'], '>=0.152.2+26.2')
  const classBytes = jarEntry(data, 'dev/velora/client/VeloraClient.class')
  assert.equal(classBytes.readUInt32BE(0), 0xcafebabe)
  assert.equal(classBytes.readUInt16BE(6), 69)
  data.fill(0)
})

test('launch verifier and packaged resources match launcher metadata', () => {
  const service = sourceText('src/main/services/clientPayload.ts')
  const expected = capture(/EXPECTED_VERIFIER_SHA256 = '([a-f0-9]{64})'/, service)
  assert.equal(createHash('sha256').update(source('resources/client/launch-verifier.jar')).digest('hex'), expected)
  const clientVersion = capture(/PROTECTED_CLIENT_VERSION = '([^']+)'/, service)
  const verifier = source('resources/client/launch-verifier.jar')
  const verifierMetadata = JSON.parse(jarEntry(verifier, 'fabric.mod.json').toString('utf8'))
  assert.equal(verifierMetadata.id, 'megaclient-launch-verifier')
  assert.equal(verifierMetadata.depends.megaclient, `=${clientVersion}`)
  const verifierClass = jarEntry(verifier, 'studio/megastudios/megaclient/launchguard/LaunchVerifier.class')
  assert.ok(verifierClass.includes(Buffer.from(clientVersion, 'utf8')), 'Verifier class must check this client version')
  assert.ok(!verifierClass.includes(Buffer.from('0.14.2')), 'Verifier must not retain the previous version')
  const builder = sourceText('electron-builder.config.cjs')
  assert.match(builder, /\{ from: 'resources\/client', to: 'resources\/client' \}/)
})

test('launcher, lockfile and client versions are consistent', () => {
  const pkg = JSON.parse(sourceText('package.json'))
  const lock = JSON.parse(sourceText('package-lock.json'))
  const service = sourceText('src/main/services/clientPayload.ts')
  assert.equal(pkg.version, '1.12.8')
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.match(service, /PROTECTED_CLIENT_VERSION = '0\.14\.3'/)
  assert.match(service, /PROTECTED_MINECRAFT_VERSION = '26\.2'/)
})

test('performance-focused UI and loader discovery remain wired', () => {
  const entry = sourceText('src/renderer/src/main.tsx')
  const app = sourceText('src/renderer/src/App.tsx')
  const loader = sourceText('src/main/services/versions.ts')
  assert.match(entry, /import '\.\/theme\.css'/)
  assert.match(app, /lazy\(\(\) => import\('\.\/Skin3DPreview'\)\)/)
  assert.match(app, /progressLastAppliedAt/)
  assert.match(loader, /entry\.loader\.stable/)
  assert.match(loader, /semver\.rcompare/)
})
