#!/usr/bin/env node
/**
 * compile-circuits.mjs
 * Compiles NodeZero circuits to R1CS + WASM using circom CLI.
 * Requires circom >= 2.1.6 to be installed: https://docs.circom.io/getting-started/installation/
 */

import { execSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const circuitsDir = path.join(root, 'circuits')
const buildDir = path.join(root, 'build')

mkdirSync(buildDir, { recursive: true })

const circuits = ['poh', 'nullifier', 'pod_ownership']

for (const circuit of circuits) {
  const src = path.join(circuitsDir, `${circuit}.circom`)
  console.log(`\n[zk-crypto] Compiling ${circuit}.circom…`)
  execSync(
    `circom "${src}" --r1cs --wasm --sym -o "${buildDir}" -l "${root}"`,
    { stdio: 'inherit', cwd: root }
  )
  console.log(`[zk-crypto] ✓ ${circuit}.circom → build/${circuit}.r1cs + build/${circuit}_js/`)
}

console.log('\n[zk-crypto] All circuits compiled successfully.')
