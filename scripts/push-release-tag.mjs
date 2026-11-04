#!/usr/bin/env node
/**
 * Idempotent release-tag publisher for the already-pushed commit.
 * A GitHub HTTP 500 during `git push` may leave main published but the tag missing.
 * Never force a remote ref or silently tag a newer/different commit.
 */
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import path from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, all) => {
  if (index % 2 === 0) items.push([value, all[index + 1]])
  return items
}, []))

const version = args['--version']
const expected = args['--expected-commit']?.toLowerCase()
const repo = path.resolve(args['--repo'] ?? process.cwd())
const branch = args['--branch'] ?? 'main'
const tag = `v${version}`
const delay = Number.isSafeInteger(Number(process.env.MEGACLIENT_TAG_RETRY_DELAY_MS))
  ? Math.max(0, Math.min(30_000, Number(process.env.MEGACLIENT_TAG_RETRY_DELAY_MS)))
  : 4_000

if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !/^[a-f0-9]{40}$/.test(expected ?? '') || !/^[\w./-]+$/.test(branch) || branch.includes('..')) {
  console.error('Expected --version 1.12.22 --expected-commit <40-character SHA> [--repo path] [--branch main].')
  process.exit(2)
}

function git(...command) {
  const result = spawnSync('git', command, { cwd: repo, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
  return { ok: !result.error && result.status === 0, text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(), error: result.error }
}
function checked(...command) {
  const result = git(...command)
  if (!result.ok) throw new Error(`git ${command.join(' ')} failed: ${result.text || result.error || 'unknown error'}`)
  return result.text
}
function remoteRef(ref) {
  const result = git('ls-remote', 'origin', ref)
  if (!result.ok) throw new Error(`Could not check ${ref} on GitHub: ${result.text || result.error || 'unknown error'}`)
  const match = result.text.split(/\r?\n/).find((line) => line.endsWith(`\t${ref}`))
  return match ? match.split(/\s+/)[0]?.toLowerCase() : null
}
function remoteTagCommit() {
  // Peel annotated tags as well as lightweight tags.
  return remoteRef(`refs/tags/${tag}^{}`) ?? remoteRef(`refs/tags/${tag}`)
}
function sleep(ms) {
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

try {
  if (checked('rev-parse', '--is-inside-work-tree') !== 'true') throw new Error('Publisher path is not a Git working tree.')
  const origin = checked('remote', 'get-url', 'origin')
  const validGithub = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(?:DamianGaming\/MegaClient)(?:\.git)?\/?$/i.test(origin)
  if (!validGithub && process.env.MEGACLIENT_RELEASE_TEST !== '1') {
    throw new Error(`Unexpected origin (${origin}); refusing to publish to a different repository.`)
  }
  if (!git('cat-file', '-e', `${expected}^{commit}`).ok) throw new Error(`Local publisher clone does not have commit ${expected}.`)

  const main = remoteRef(`refs/heads/${branch}`)
  if (main !== expected) {
    throw new Error(`Remote ${branch} is ${main ?? 'missing'}, not expected commit ${expected}. Stopping to avoid tagging the wrong code.`)
  }

  const existing = remoteTagCommit()
  if (existing) {
    if (existing !== expected) throw new Error(`${tag} already exists but points to ${existing}; refusing to overwrite it.`)
    console.log(`${tag} is already on GitHub at ${expected}. Nothing needs pushing.`)
    process.exit(0)
  }

  const local = git('rev-parse', '--verify', `refs/tags/${tag}^{commit}`)
  if (local.ok && local.text.toLowerCase() !== expected) {
    console.log(`Removing the stale *local-only* ${tag} tag (remote tag is missing).`)
    checked('tag', '-d', tag)
  }
  if (!local.ok || local.text.toLowerCase() !== expected) checked('tag', tag, expected)

  for (let attempt = 1; attempt <= 4; attempt++) {
    console.log(`Pushing ${tag} (attempt ${attempt}/4)...`)
    const result = git('push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`)
    if (result.text) console.log(result.text)
    let published = null
    try { published = remoteTagCommit() } catch (error) { console.warn(`Remote verification warning: ${error.message}`) }
    if (published && published !== expected) throw new Error(`Remote tag points to unexpected commit ${published}.`)
    if (published === expected) {
      console.log(`SUCCESS: GitHub has ${tag} at ${expected}. GitHub Actions can now build the release.`)
      process.exit(0)
    }
    if (attempt < 4) {
      console.warn('Tag not confirmed on GitHub. Will retry without force.');
      sleep(delay * attempt)
    }
  }
  throw new Error(`GitHub still has not accepted ${tag}. Source commit is already on main; check GitHub status and retry the tag only.`)
} catch (error) {
  console.error(`RELEASE TAG ERROR: ${error.message}`)
  process.exit(1)
}
