import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { captureTool, ghTool, gitTool, npmTool, runTool } from './command-utils.mjs'

function secretNames(repo) {
  const result = captureTool(ghTool, ['secret', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name'])
  return new Set(result.ok ? result.stdout.split(/\r?\n/).filter(Boolean) : [])
}

function ensureGitIdentity(repo) {
  const name = captureTool(gitTool, ['config', 'user.name']).stdout
  const email = captureTool(gitTool, ['config', 'user.email']).stdout
  if (name && email) return

  const login = captureTool(ghTool, ['api', 'user', '--jq', '.login']).stdout || repo.split('/')[0]
  if (!name) runTool(gitTool, ['config', 'user.name', login])
  if (!email) runTool(gitTool, ['config', 'user.email', `${login}@users.noreply.github.com`])
}

async function main() {
  console.log('\nMegaClient release setup\n')

  if (!captureTool(ghTool, ['auth', 'status']).ok) {
    console.log('GitHub CLI is not signed in. A browser sign-in will open now.')
    runTool(ghTool, ['auth', 'login'])
  }

  if (!captureTool(gitTool, ['rev-parse', '--is-inside-work-tree']).ok) {
    console.log('Creating a local Git repository...')
    runTool(gitTool, ['init'])
    runTool(gitTool, ['branch', '-M', 'main'])
  }

  let rl = createInterface({ input, output })
  let repo = captureTool(ghTool, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).stdout

  if (!repo) {
    repo = (await rl.question('GitHub repository (example: YourName/MegaClient): ')).trim()
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      rl.close()
      throw new Error('Repository must be written as owner/name.')
    }

    const existing = captureTool(ghTool, ['repo', 'view', repo, '--json', 'nameWithOwner'])
    if (!existing.ok) {
      const create = (await rl.question(`Repository ${repo} does not exist. Create it as public? [Y/n]: `)).trim().toLowerCase()
      if (create && create !== 'y' && create !== 'yes') {
        rl.close()
        throw new Error('A public GitHub repository is required for the built-in updater.')
      }
      runTool(ghTool, ['repo', 'create', repo, '--public', '--source=.', '--remote=origin'])
    } else if (!captureTool(gitTool, ['remote', 'get-url', 'origin']).ok) {
      runTool(gitTool, ['remote', 'add', 'origin', `https://github.com/${repo}.git`])
    }
  }

  const repoInfo = captureTool(ghTool, ['repo', 'view', repo, '--json', 'visibility', '--jq', '.visibility'])
  if (!repoInfo.ok) {
    rl.close()
    throw new Error(`Could not access GitHub repository ${repo}.`)
  }
  if (repoInfo.stdout.toUpperCase() !== 'PUBLIC') {
    rl.close()
    throw new Error('The repository is private. This launcher uses a public GitHub Releases updater endpoint, so make the repository public first.')
  }

  ensureGitIdentity(repo)

  const currentSecrets = secretNames(repo)
  const hasPrivate = currentSecrets.has('TAURI_SIGNING_PRIVATE_KEY')
  const hasPublic = currentSecrets.has('TAURI_UPDATER_PUBLIC_KEY')
  let replaceKeys = true

  if (hasPrivate && hasPublic) {
    console.log(`Updater keys are already configured for ${repo}.`)
    const replace = (await rl.question('Replace the existing updater keys? [y/N]: ')).trim().toLowerCase()
    replaceKeys = replace === 'y' || replace === 'yes'
  }

  if (replaceKeys) {
    const defaultPrivate = join(homedir(), '.tauri', 'megaclient.key')
    const defaultPublic = `${defaultPrivate}.pub`
    let privatePath = (await rl.question(`Private updater key path [${defaultPrivate}]: `)).trim() || defaultPrivate
    let publicPath = (await rl.question(`Public updater key path [${defaultPublic}]: `)).trim() || defaultPublic

    if (!existsSync(privatePath) || !existsSync(publicPath)) {
      console.log('\nThe key files were not found.')
      console.log('IMPORTANT: If an older MegaClient release already updates automatically, you must locate and reuse its original key.')
      const firstRelease = (await rl.question('Is this the first-ever updater release, so a new key is safe? [y/N]: ')).trim().toLowerCase()
      if (firstRelease !== 'y' && firstRelease !== 'yes') {
        rl.close()
        throw new Error('Setup stopped so the updater trust chain is not accidentally broken.')
      }

      privatePath = defaultPrivate
      publicPath = defaultPublic
      console.log('\nGenerating the permanent updater key. Store its password safely.')
      rl.close()
      runTool(npmTool, ['exec', 'tauri', '--', 'signer', 'generate', '-w', privatePath])
      rl = createInterface({ input, output })
    }

    if (!existsSync(privatePath) || !existsSync(publicPath)) {
      rl.close()
      throw new Error('Updater key generation did not create both key files.')
    }

    console.log(`\nSaving updater keys to GitHub repository ${repo}...`)
    runTool(ghTool, ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY', '--repo', repo], {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: readFileSync(privatePath, 'utf8')
    })
    runTool(ghTool, ['secret', 'set', 'TAURI_UPDATER_PUBLIC_KEY', '--repo', repo], {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: readFileSync(publicPath, 'utf8')
    })
  }

  const passwordAnswer = (await rl.question('Does your updater key have a password? [y/N]: ')).trim().toLowerCase()
  rl.close()
  if (passwordAnswer === 'y' || passwordAnswer === 'yes') {
    console.log('Enter the updater key password when GitHub CLI asks for the secret value.')
    runTool(ghTool, ['secret', 'set', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '--repo', repo])
  } else if (currentSecrets.has('TAURI_SIGNING_PRIVATE_KEY_PASSWORD')) {
    // An empty/missing password is correct for an unencrypted updater key.
    // Only delete the secret when it actually exists, avoiding a harmless
    // GitHub CLI 404 that looks like setup failed.
    runTool(ghTool, ['secret', 'delete', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', '--repo', repo], {
      allowFailure: true,
      log: false,
      stdio: 'ignore'
    })
  }

  console.log('\nRelease setup complete.')
  console.log('To publish, use one command such as:')
  console.log('npm run release -- 2.3.5\n')
}

main().catch(error => {
  console.error(`\nRelease setup failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
