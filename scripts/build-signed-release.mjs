import { npmTool, runTool } from './command-utils.mjs'

const env = {
  ...process.env,
  VITE_UPDATER_ENABLED: 'true'
}

try {
  runTool(npmTool, ['run', 'updater:config'], { env })
  runTool(npmTool, [
    'exec',
    'tauri',
    '--',
    'build',
    '--features',
    'signed-updater',
    '--config',
    'src-tauri/tauri.release.conf.json'
  ], { env })
} catch (error) {
  console.error(`Signed release build failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
