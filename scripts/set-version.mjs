import { readFile, writeFile } from 'node:fs/promises'

const version = process.argv[2]?.trim()
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Usage: npm run version:set -- 2.3.3')
  process.exit(1)
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const packageJson = await readJson('package.json')
packageJson.version = version
await writeJson('package.json', packageJson)

const packageLock = await readJson('package-lock.json')
packageLock.version = version
if (packageLock.packages?.['']) packageLock.packages[''].version = version
await writeJson('package-lock.json', packageLock)

const tauriConfig = await readJson('src-tauri/tauri.conf.json')
tauriConfig.version = version
await writeJson('src-tauri/tauri.conf.json', tauriConfig)

const cargoPath = 'src-tauri/Cargo.toml'
const cargo = await readFile(cargoPath, 'utf8')
const cargoPattern = /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+("\s*\n)/
if (!cargoPattern.test(cargo)) throw new Error('Could not find the package version in src-tauri/Cargo.toml')
const updatedCargo = cargo.replace(cargoPattern, `$1${version}$2`)
await writeFile(cargoPath, updatedCargo, 'utf8')

const appPath = 'src/App.tsx'
const appSource = await readFile(appPath, 'utf8')
const appPattern = /<TitleBar version="\d+\.\d+\.\d+(?:-[^"]+)?" \/>/
if (!appPattern.test(appSource)) throw new Error('Could not find the loading-screen version in src/App.tsx')
const updatedApp = appSource.replace(appPattern, `<TitleBar version="${version}" />`)
await writeFile(appPath, updatedApp, 'utf8')

const apiPath = 'src/lib/api.ts'
const apiSource = await readFile(apiPath, 'utf8')
const apiPattern = /appVersion: '\d+\.\d+\.\d+(?:-[^']+)?'/
if (!apiPattern.test(apiSource)) throw new Error('Could not find the preview version in src/lib/api.ts')
const updatedApi = apiSource.replace(apiPattern, `appVersion: '${version}'`)
await writeFile(apiPath, updatedApi, 'utf8')

console.log(`MegaClient version synchronized to ${version}`)
