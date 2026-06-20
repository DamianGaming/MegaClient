import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY?.trim()

function repositoryFromGitRemote() {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' })
  if (result.status !== 0) return ''
  const remote = (result.stdout ?? '').trim()
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i)
  return match ? `${match[1]}/${match[2]}` : ''
}

const configuredEndpoint = process.env.MEGACLIENT_UPDATER_ENDPOINT?.trim()
const repository = repositoryFromGitRemote()
const endpoint = configuredEndpoint || (repository
  ? `https://github.com/${repository}/releases/latest/download/latest.json`
  : '')

if (!publicKey) {
  console.error('TAURI_UPDATER_PUBLIC_KEY is required to create a signed updater release configuration.')
  console.error('Run npm run release:setup to configure the permanent updater signing key.')
  process.exit(1)
}

if (!endpoint) {
  console.error('Could not determine the updater endpoint because no GitHub origin remote exists.')
  console.error('Run npm run release:setup, or set MEGACLIENT_UPDATER_ENDPOINT explicitly.')
  process.exit(1)
}

if (!endpoint.startsWith('https://')) {
  console.error('MEGACLIENT_UPDATER_ENDPOINT must use HTTPS.')
  process.exit(1)
}

const outputPath = resolve('src-tauri/tauri.release.conf.json')
const config = {
  bundle: {
    createUpdaterArtifacts: true
  },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [endpoint],
      windows: {
        installMode: 'passive'
      }
    }
  }
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
console.log(`Wrote updater release config to ${outputPath}`)
console.log(`Endpoint: ${endpoint}`)
