import { readFile, access } from 'node:fs/promises'

const fail = message => {
  console.error(`Release verification failed: ${message}`)
  process.exitCode = 1
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'))
const tauriConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
const cargo = await readFile('src-tauri/Cargo.toml', 'utf8')
const cargoVersion = cargo.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1]
const versions = new Map([
  ['package.json', packageJson.version],
  ['package-lock.json', packageLock.version],
  ['package-lock root package', packageLock.packages?.['']?.version],
  ['src-tauri/tauri.conf.json', tauriConfig.version],
  ['src-tauri/Cargo.toml', cargoVersion]
])

const expected = packageJson.version
for (const [file, version] of versions) {
  if (version !== expected) fail(`${file} has ${version ?? 'no version'}, expected ${expected}`)
}

if (tauriConfig.identifier !== 'studio.megastudios.megaclient') {
  fail('the application identifier changed; that would create a separate installation/update identity')
}

const lockText = await readFile('package-lock.json', 'utf8')
if (/applied-caas|internal\.api\.openai/i.test(lockText)) fail('package-lock.json still contains an internal registry URL')
if (!lockText.includes('https://registry.npmjs.org/')) fail('package-lock.json is not pinned to the public npm registry')

for (const path of [
  '.github/workflows/release.yml',
  'scripts/create-updater-config.mjs',
  'scripts/release-setup.mjs',
  'scripts/publish-release.mjs',
  'src/hooks/useLauncherUpdater.ts',
  'src/lib/updater.ts',
  'src-tauri/capabilities/default.json'
]) {
  await access(path).catch(() => fail(`${path} is missing`))
}

const capabilities = JSON.parse(await readFile('src-tauri/capabilities/default.json', 'utf8'))
for (const permission of ['updater:default', 'process:default']) {
  if (!capabilities.permissions?.includes(permission)) fail(`missing capability ${permission}`)
}

const workflow = await readFile('.github/workflows/release.yml', 'utf8')
for (const token of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY', 'updaterJsonPreferNsis', 'releaseDraft: false']) {
  if (!workflow.includes(token)) fail(`release workflow does not reference ${token}`)
}

if (!process.exitCode) console.log(`Release verification passed for MegaClient ${expected}`)
