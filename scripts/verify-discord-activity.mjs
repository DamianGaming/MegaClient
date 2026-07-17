import fs from 'node:fs/promises'
import path from 'node:path'

const file = path.resolve('resources/discord/application-id.txt')
const value = (await fs.readFile(file, 'utf8').catch(() => '')).trim()

if (!/^\d{17,20}$/.test(value)) {
  console.error('[MegaClient] Discord activity is not configured for this release.')
  console.error('[MegaClient] Run configure-discord-activity.cmd and paste the Discord Application ID before publishing.')
  process.exit(1)
}

console.log(`[MegaClient] Discord activity configured for application ${value}.`)
