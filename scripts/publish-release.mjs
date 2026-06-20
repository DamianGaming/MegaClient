import {
  cargoTool,
  captureTool,
  ghTool,
  gitTool,
  npmTool,
  requireTool,
  runTool
} from './command-utils.mjs'

const version = process.argv[2]?.trim()

function assertRequiredSecrets(repo) {
  const result = captureTool(ghTool, ['secret', 'list', '--repo', repo, '--json', 'name', '--jq', '.[].name'])
  if (!result.ok) {
    throw new Error(`Could not inspect GitHub Actions secrets for ${repo}. Run npm run release:setup first.`)
  }

  const names = new Set(result.stdout.split(/\r?\n/).filter(Boolean))
  for (const name of ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_UPDATER_PUBLIC_KEY']) {
    if (!names.has(name)) {
      throw new Error(`Missing GitHub secret ${name}. Run npm run release:setup first.`)
    }
  }
}

function connectToExistingRepositoryHistory(repo) {
  if (captureTool(gitTool, ['rev-parse', '--verify', 'HEAD']).ok) return

  const branchResult = captureTool(ghTool, [
    'repo',
    'view',
    repo,
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name'
  ])
  const defaultBranch = branchResult.stdout || 'main'

  const remoteBranch = captureTool(gitTool, [
    'ls-remote',
    '--exit-code',
    '--heads',
    'origin',
    `refs/heads/${defaultBranch}`
  ])

  if (!remoteBranch.ok) {
    runTool(gitTool, ['branch', '-M', defaultBranch])
    return
  }

  console.log(`\nConnecting this folder to the existing ${repo}/${defaultBranch} history...`)

  // A freshly created local repository can have no remote-tracking refs yet.
  // `git fetch origin main` may resolve an equally named tag and leave only
  // FETCH_HEAD, so fetch the branch with an explicit source/destination
  // refspec and then reset to that unambiguous remote-tracking ref.
  const remoteRef = `refs/remotes/origin/${defaultBranch}`
  runTool(gitTool, [
    'fetch',
    '--no-tags',
    'origin',
    `+refs/heads/${defaultBranch}:${remoteRef}`
  ])

  // Keep the extracted project files in the working tree while attaching HEAD
  // to the existing remote history. The release commit becomes a normal
  // fast-forward update instead of an unrelated-history push.
  runTool(gitTool, ['reset', '--mixed', remoteRef, '--'])
  runTool(gitTool, ['branch', '-M', defaultBranch])
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
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('Provide a version, for example: npm run release -- 2.3.3')
  }

  requireTool(gitTool, 'Git')
  requireTool(ghTool, 'GitHub CLI')
  requireTool(npmTool, 'npm')
  requireTool(cargoTool, 'Rust/Cargo')

  if (!captureTool(ghTool, ['auth', 'status']).ok) {
    throw new Error('GitHub CLI is not signed in. Run gh auth login, then try again.')
  }
  if (!captureTool(gitTool, ['rev-parse', '--is-inside-work-tree']).ok) {
    throw new Error('This folder is not a Git repository. Run npm run release:setup first.')
  }

  const repoResult = captureTool(ghTool, [
    'repo',
    'view',
    '--json',
    'nameWithOwner,visibility',
    '--jq',
    '.nameWithOwner + "|" + .visibility'
  ])
  if (!repoResult.ok) {
    throw new Error('No GitHub repository is connected. Run npm run release:setup first.')
  }

  const [repo, visibility] = repoResult.stdout.split('|')
  if (visibility?.toUpperCase() !== 'PUBLIC') {
    throw new Error('The GitHub repository must be public for the current updater endpoint to work.')
  }

  assertRequiredSecrets(repo)
  connectToExistingRepositoryHistory(repo)
  ensureGitIdentity(repo)

  const tag = `v${version}`
  if (captureTool(gitTool, ['rev-parse', tag]).ok) {
    throw new Error(`Local tag ${tag} already exists.`)
  }
  if (captureTool(gitTool, ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`]).ok) {
    throw new Error(`Remote tag ${tag} already exists. Use a higher version number.`)
  }

  console.log(`\nPreparing MegaClient ${version} for ${repo}...`)
  runTool(npmTool, ['run', 'version:set', '--', version])
  runTool(npmTool, ['ci'])
  runTool(npmTool, ['run', 'release:verify'])
  runTool(npmTool, ['run', 'check'])
  runTool(cargoTool, ['check', '--manifest-path', './src-tauri/Cargo.toml'])

  runTool(gitTool, ['add', '-A'])
  const staged = captureTool(gitTool, ['diff', '--cached', '--quiet'])
  if (!staged.ok) {
    runTool(gitTool, ['commit', '-m', `Release MegaClient ${version}`])
  } else {
    console.log('\nNo source changes needed; releasing the current commit.')
  }

  const branch = captureTool(gitTool, ['branch', '--show-current']).stdout || 'main'
  runTool(gitTool, ['push', '-u', 'origin', branch])
  runTool(gitTool, ['tag', '-a', tag, '-m', `MegaClient ${version}`])
  runTool(gitTool, ['push', 'origin', tag])

  console.log('\nRelease started successfully.')
  console.log(`Build progress: https://github.com/${repo}/actions`)
  console.log(`Release page:   https://github.com/${repo}/releases/tag/${tag}`)
  console.log('GitHub Actions will build, sign, create latest.json, and publish the Windows installer automatically.\n')
}

main().catch(error => {
  console.error(`\nRelease failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
