import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const publisher = path.resolve('scripts/push-release-tag.mjs')
const run = (command, args, cwd, env) => spawnSync(command, args, {
  cwd, env: { ...process.env, ...env }, encoding: 'utf8', windowsHide: true
})
const git = (cwd, ...args) => {
  const result = run('git', args, cwd)
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stdout} ${result.stderr}`)
  return result.stdout.trim()
}

test('release tag can safely retry after remote failure and never tag a different main commit', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'megaclient-release-tag-'))
  try {
    const remote = path.join(tmp, 'remote.git')
    const source = path.join(tmp, 'source')
    fs.mkdirSync(source)
    git(tmp, 'init', '--bare', remote)
    git(source, 'init')
    git(source, 'config', 'user.email', 'test@example.invalid')
    git(source, 'config', 'user.name', 'MegaClient Release Test')
    git(source, 'checkout', '-B', 'main')
    fs.writeFileSync(path.join(source, 'package.json'), '{"version":"1.12.22"}\n')
    git(source, 'add', 'package.json')
    git(source, 'commit', '-m', 'Release v1.12.22')
    const commit = git(source, 'rev-parse', 'HEAD')
    git(source, 'remote', 'add', 'origin', remote)
    git(source, 'push', 'origin', 'refs/heads/main:refs/heads/main')

    // A transient server-side error must not require a new version or a force push.
    if (process.platform !== 'win32') {
      const hook = path.join(remote, 'hooks', 'pre-receive')
      fs.writeFileSync(hook, '#!/bin/sh\nif [ ! -f rejected-once ]; then touch rejected-once; echo "Internal Server Error" >&2; exit 1; fi\nexit 0\n')
      fs.chmodSync(hook, 0o755)
    }
    const opts = ['--version', '1.12.22', '--expected-commit', commit, '--repo', source, '--branch', 'main']
    const env = { MEGACLIENT_RELEASE_TEST: '1', MEGACLIENT_TAG_RETRY_DELAY_MS: '0' }
    const first = run('node', [publisher, ...opts], source, env)
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
    assert.equal(git(tmp, '--git-dir', remote, 'rev-parse', 'refs/tags/v1.12.22'), commit)
    if (process.platform !== 'win32') assert.match(first.stdout, /attempt 2\/4/)

    const again = run('node', [publisher, ...opts], source, env)
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout, /Nothing needs pushing/)

    git(source, 'commit', '--allow-empty', '-m', 'Newer change')
    git(source, 'push', 'origin', 'refs/heads/main:refs/heads/main')
    const wrongMain = run('node', [publisher, ...opts], source, env)
    assert.notEqual(wrongMain.status, 0)
    assert.match(wrongMain.stderr, /Stopping to avoid tagging the wrong code/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
