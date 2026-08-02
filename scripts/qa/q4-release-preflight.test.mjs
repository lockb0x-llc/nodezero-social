import { strict as assert } from 'node:assert'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const node = process.execPath
const script = resolve('scripts/qa/q4-release-preflight.mjs')

void test('rejects an unknown preflight phase before running release gates', () => {
  const result = spawnSync(node, [script, '--phase=unknown'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown phase 'unknown'/)
})

void test('candidate phase rejects a dirty release-preparation worktree', () => {
  const repository = mkdtempSync(join(tmpdir(), 'nodezero-q4-preflight-'))
  try {
    execFileSync('git', ['init', '-b', 'testnet'], { cwd: repository })
    execFileSync('git', ['config', 'user.email', 'q4-preflight@nodezero.invalid'], {
      cwd: repository,
    })
    execFileSync('git', ['config', 'user.name', 'Q4 Preflight'], { cwd: repository })
    writeFileSync(join(repository, 'tracked.txt'), 'initial\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repository })
    writeFileSync(join(repository, 'tracked.txt'), 'dirty\n')

    const result = spawnSync(node, [script, '--phase=candidate'], {
      cwd: repository,
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires a clean worktree/)
  } finally {
    rmSync(repository, { recursive: true, force: true })
  }
})

void test('candidate repository-state phase accepts a clean descendant before push', () => {
  const repository = mkdtempSync(join(tmpdir(), 'nodezero-q4-candidate-'))
  const remote = mkdtempSync(join(tmpdir(), 'nodezero-q4-remote-'))
  try {
    execFileSync('git', ['init', '--bare'], { cwd: remote })
    execFileSync('git', ['init', '-b', 'testnet'], { cwd: repository })
    execFileSync('git', ['config', 'user.email', 'q4-preflight@nodezero.invalid'], {
      cwd: repository,
    })
    execFileSync('git', ['config', 'user.name', 'Q4 Preflight'], { cwd: repository })
    writeFileSync(join(repository, 'tracked.txt'), 'initial\n')
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: repository })
    execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: repository })
    execFileSync('git', ['push', '-u', 'origin', 'testnet'], { cwd: repository })
    writeFileSync(join(repository, 'tracked.txt'), 'candidate\n')
    execFileSync('git', ['commit', '-am', 'candidate'], { cwd: repository })

    const remoteLine = execFileSync(
      'git',
      ['ls-remote', '--heads', 'origin', 'refs/heads/testnet'],
      { cwd: repository, encoding: 'utf8' }
    ).trim()
    const remoteHead = remoteLine.split(/\s+/)[0]
    const result = spawnSync('git', ['merge-base', '--is-ancestor', remoteHead, 'HEAD'], {
      cwd: repository,
    })
    assert.equal(result.status, 0)
  } finally {
    rmSync(repository, { recursive: true, force: true })
    rmSync(remote, { recursive: true, force: true })
  }
})
