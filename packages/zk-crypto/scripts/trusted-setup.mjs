#!/usr/bin/env node
/**
 * trusted-setup.mjs
 * Runs Groth16 trusted setup for poh and nullifier circuits.
 *
 * Uses the Hermez perpetual powers-of-tau (ptau) ceremony for Phase 1.
 * Performs a single Phase 2 contribution for the hackathon.
 *
 * Outputs:
 *   build/poh_final.zkey         – proving key
 *   build/poh_vk.json            – verification key (used to generate Rust struct)
 *   build/nullifier_final.zkey
 *   build/nullifier_vk.json
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { get } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'build')

mkdirSync(buildDir, { recursive: true })

const PTAU_FILE = path.join(buildDir, 'pot20_final.ptau')
// Hermez perpetual ceremony – 2^20 constraints
const PTAU_URL =
  'https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau'

async function download(url, dest) {
  if (existsSync(dest)) {
    console.log(`[setup] Using cached ${path.basename(dest)}`)
    return
  }
  console.log(`[setup] Downloading ${path.basename(dest)} (this may take a minute)…`)
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    get(url, (res) => {
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
    }).on('error', reject)
  })
}

function snarkjs(args) {
  execSync(`node node_modules/.bin/snarkjs ${args}`, { stdio: 'inherit', cwd: root })
}

await download(PTAU_URL, PTAU_FILE)

const circuits = ['poh', 'nullifier']
for (const c of circuits) {
  const r1cs = path.join(buildDir, `${c}.r1cs`)
  if (!existsSync(r1cs)) {
    console.error(`[setup] ${c}.r1cs not found. Run 'pnpm build:circuits' first.`)
    process.exit(1)
  }

  console.log(`\n[setup] Phase 2 setup for ${c}…`)
  snarkjs(`groth16 setup "${r1cs}" "${PTAU_FILE}" "${buildDir}/${c}_0.zkey"`)

  console.log(`[setup] Contributing randomness for ${c}…`)
  const entropy = `nodezero-hackathon-${c}-${Date.now()}`
  execSync(
    `echo "${entropy}" | node node_modules/.bin/snarkjs zkey contribute ` +
      `"${buildDir}/${c}_0.zkey" "${buildDir}/${c}_final.zkey" --name="NodeZero" -v`,
    { stdio: 'inherit', cwd: root }
  )

  console.log(`[setup] Exporting verification key for ${c}…`)
  snarkjs(`zkey export verificationkey "${buildDir}/${c}_final.zkey" "${buildDir}/${c}_vk.json"`)

  console.log(`[setup] ✓ ${c}: proving key + verification key exported.`)
}

console.log('\n[setup] Trusted setup complete. Artifacts in build/')
