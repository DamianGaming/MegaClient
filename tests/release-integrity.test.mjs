import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDecipheriv, createHash } from 'node:crypto'
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
  data.fill(0)
})

test('launch verifier and packaged resources match launcher metadata', () => {
  const service = sourceText('src/main/services/clientPayload.ts')
  const expected = capture(/EXPECTED_VERIFIER_SHA256 = '([a-f0-9]{64})'/, service)
  assert.equal(createHash('sha256').update(source('resources/client/launch-verifier.jar')).digest('hex'), expected)
  const builder = sourceText('electron-builder.config.cjs')
  assert.match(builder, /\{ from: 'resources\/client', to: 'resources\/client' \}/)
})

test('launcher, lockfile and client versions are consistent', () => {
  const pkg = JSON.parse(sourceText('package.json'))
  const lock = JSON.parse(sourceText('package-lock.json'))
  const service = sourceText('src/main/services/clientPayload.ts')
  assert.equal(pkg.version, '1.12.4')
  assert.equal(lock.version, pkg.version)
  assert.equal(lock.packages[''].version, pkg.version)
  assert.match(service, /PROTECTED_CLIENT_VERSION = '0\.14\.2'/)
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
