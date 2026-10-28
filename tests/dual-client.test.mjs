import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, createDecipheriv } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readProtectedClientCatalog } from '../scripts/client-catalog.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const text = (name) => readFileSync(path.join(root, name), 'utf8')
const bytes = (name) => readFileSync(path.join(root, name))
const hash = (value) => createHash('sha256').update(value).digest('hex')

function jarEntry(archive, entryName) {
  let end = -1
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 65557); i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) { end = i; break }
  }
  assert.ok(end >= 0, 'JAR central directory must exist')
  let position = archive.readUInt32LE(end + 16)
  for (let i = 0, count = archive.readUInt16LE(end + 10); i < count; i++) {
    assert.equal(archive.readUInt32LE(position), 0x02014b50)
    const method = archive.readUInt16LE(position + 10)
    const length = archive.readUInt32LE(position + 20)
    const nameLen = archive.readUInt16LE(position + 28)
    const extraLen = archive.readUInt16LE(position + 30)
    const commentLen = archive.readUInt16LE(position + 32)
    const name = archive.subarray(position + 46, position + 46 + nameLen).toString()
    if (name === entryName) {
      const local = archive.readUInt32LE(position + 42)
      assert.equal(archive.readUInt32LE(local), 0x04034b50)
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28)
      const compressed = archive.subarray(start, start + length)
      if (method === 0) return compressed
      if (method === 8) return inflateRawSync(compressed)
      assert.fail(`Unexpected ZIP method: ${method}`)
    }
    position += 46 + nameLen + extraLen + commentLen
  }
  assert.fail(`Missing JAR member ${entryName}`)
}

const clients = readProtectedClientCatalog(root)
test('both protected Minecraft versions are shipped independently', () => {
  assert.deepEqual(clients.map((item) => item.minecraftVersion).sort(), ['26.2', '26.3'])
  assert.notEqual(clients[0].bundle, clients[1].bundle)
  assert.notEqual(clients[0].clientSha256, clients[1].clientSha256)
  assert.notEqual(clients[0].verifier, clients[1].verifier)
})

for (const c of clients) {
  test(`protected client ${c.minecraftVersion} decrypts and matches its game-specific verifier`, () => {
    const bundle = bytes(`resources/client/${c.bundle}`)
    const verifier = bytes(`resources/client/${c.verifier}`)
    assert.equal(hash(verifier), c.verifierSha256)
    assert.equal(bundle.subarray(0, 4).toString(), 'MCB1')
    const key = createHash('sha256').update([
      'MGC-PAYLOAD-2026', '8e1c2d6af90b47bc', 'MegaStudios',
      `${c.minecraftVersion}::${c.clientVersion}`
    ].join('::')).digest()
    const decipher = createDecipheriv('aes-256-gcm', key, bundle.subarray(4, 16))
    decipher.setAAD(Buffer.from('MegaClientPayload:v1'))
    decipher.setAuthTag(bundle.subarray(-16))
    const jar = Buffer.concat([decipher.update(bundle.subarray(16, -16)), decipher.final()])
    try {
      assert.equal(hash(jar), c.clientSha256)
      const mod = JSON.parse(jarEntry(jar, 'fabric.mod.json').toString())
      const guard = JSON.parse(jarEntry(verifier, 'fabric.mod.json').toString())
      assert.equal(mod.id, 'megaclient')
      assert.equal(mod.version, c.clientVersion)
      assert.equal(mod.depends.minecraft, `~${c.minecraftVersion}`)
      assert.equal(mod.depends.fabricloader, `>=${c.minimumFabricLoader}`)
      assert.equal(mod.depends['fabric-api'], `>=${c.minimumFabricApi}+${c.minecraftVersion}`)
      assert.equal(mod.depends.java, '>=25')
      assert.equal(guard.depends.minecraft, `~${c.minecraftVersion}`)
      assert.equal(guard.depends.fabricloader, `>=${c.minimumFabricLoader}`)
      assert.equal(guard.depends.megaclient, `=${c.clientVersion}`)
      assert.ok(jarEntry(verifier, 'studio/megastudios/megaclient/launchguard/LaunchVerifier.class').includes(Buffer.from(c.clientVersion)))
      const clazz = jarEntry(jar, 'dev/velora/client/VeloraClient.class')
      assert.equal(clazz.readUInt32BE(0), 0xcafebabe)
      assert.equal(clazz.readUInt16BE(6), 69)
    } finally {
      jar.fill(0)
    }
  })
}

test('protected profiles are explicitly versioned, never silently switched back to 26.2', () => {
  const instances = text('src/main/services/instances.ts')
  const launcher = text('src/main/services/launcher.ts')
  const renderer = text('src/renderer/src/App.tsx')
  assert.match(instances, /if \(input\.customClient\) protectedClientFor\(minecraftVersion\)/)
  assert.match(launcher, /protectedClientFor\(instance\.minecraftVersion\)/)
  assert.match(launcher, /await validatePreparedClientPayload\(payload, instance\.minecraftVersion\)/)
  assert.doesNotMatch(launcher, /minecraftVersion: CLIENT_MINECRAFT_VERSION/)
  assert.match(renderer, /value: '26\.2'/)
  assert.match(renderer, /value: '26\.3'/)
  assert.match(renderer, /onChange=\{chooseProtectedVersion\}/)
})
