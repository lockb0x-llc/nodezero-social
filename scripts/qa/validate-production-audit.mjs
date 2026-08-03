#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const isWindows = process.platform === 'win32'
const pnpmCli = isWindows
  ? join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  : null
if (isWindows && !existsSync(pnpmCli)) throw new Error(`Unable to resolve pnpm CLI at ${pnpmCli}.`)
const command = isWindows ? process.execPath : 'pnpm'
const args = [...(isWindows ? [pnpmCli] : []), 'audit', '--prod', '--json']
const result = spawnSync(command, args, { encoding: 'utf8', shell: false })
if (result.error) throw result.error

let audit
try {
  audit = JSON.parse(result.stdout)
} catch {
  process.stderr.write(result.stderr)
  throw new Error('Unable to parse pnpm production audit output.')
}

const vulnerabilities = audit.metadata?.vulnerabilities
for (const severity of ['high', 'critical']) {
  if (vulnerabilities?.[severity] !== 0) {
    const affected = Object.values(audit.advisories ?? {})
      .filter((advisory) => advisory.severity === severity)
      .map((advisory) => advisory.module_name)
      .filter((name, index, names) => names.indexOf(name) === index)
    throw new Error(
      `Production audit contains ${vulnerabilities?.[severity]} ${severity} advisories: ${affected.join(', ')}`
    )
  }
}

console.log(
  `[qa:production-audit] PASS: ${vulnerabilities?.low ?? 0} low, ${vulnerabilities?.moderate ?? 0} moderate, 0 high, 0 critical`
)
