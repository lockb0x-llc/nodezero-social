#!/usr/bin/env node
/**
 * trusted-setup.mjs
 * Runs Groth16 trusted setup for NodeZero circuits.
 *
 * Uses the Hermez perpetual powers-of-tau (ptau) ceremony for Phase 1.
 * Performs a single Phase 2 contribution for the hackathon.
 *
 * Outputs:
 *   build/poh_final.zkey         – proving key
 *   build/poh_vk.json            – verification key (used to generate Rust struct)
 *   build/nullifier_final.zkey
 *   build/nullifier_vk.json
 *   build/pod_ownership_final.zkey
 *   build/pod_ownership_vk.json
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { get } from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'build')

mkdirSync(buildDir, { recursive: true })

const PTAU_POWER = Number(process.env.ZK_PTAU_POWER ?? 14)
const PTAU_FILE = path.join(buildDir, `pot${PTAU_POWER}_final.ptau`)
// Hermez perpetual ceremony – 2^20 constraints. If unavailable, generate a
// local fallback sized by ZK_PTAU_POWER (default 14, enough for current circuits).
const PTAU_URL =
  'https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_20.ptau'

async function download(url, dest) {
  if (existsSync(dest)) {
    const header = readFileSync(dest).subarray(0, 64).toString('utf8').trim().toLowerCase()
    if (header.startsWith('<!doctype') || header.startsWith('<html') || header.includes('not found')) {
      console.log(`[setup] Removing invalid cached ${path.basename(dest)}`)
      rmSync(dest, { force: true })
    } else {
      console.log(`[setup] Using cached ${path.basename(dest)}`)
      return
    }
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
  execSync(`snarkjs ${args}`, { stdio: 'inherit', cwd: root })
}

function isInvalidPtau(filePath) {
  if (!existsSync(filePath)) return true
  const stat = statSync(filePath)
  if (stat.size < 1024) return true
  const header = readFileSync(filePath).subarray(0, 128).toString('utf8').trim().toLowerCase()
  return header.startsWith('<?xml') || header.startsWith('<!doctype') || header.startsWith('<html') || header.includes('accessdenied') || header.includes('not found')
}

function generateLocalPtau(dest) {
  const ptau0 = path.join(buildDir, `pot${PTAU_POWER}_0000.ptau`)
  const ptau1 = path.join(buildDir, `pot${PTAU_POWER}_0001.ptau`)
  console.log('[setup] Generating local powers-of-tau fallback for hackathon/dev use...')
  snarkjs(`powersoftau new bn128 ${PTAU_POWER} "${ptau0}" -v`)
  execSync(
    `echo "nodezero-local-ptau-${Date.now()}" | snarkjs powersoftau contribute "${ptau0}" "${ptau1}" --name="NodeZero local" -v`,
    { stdio: 'inherit', cwd: root }
  )
  snarkjs(`powersoftau prepare phase2 "${ptau1}" "${dest}" -v`)
}

await download(PTAU_URL, PTAU_FILE)
if (isInvalidPtau(PTAU_FILE)) {
  console.log(`[setup] Downloaded ${path.basename(PTAU_FILE)} is not usable.`)
  rmSync(PTAU_FILE, { force: true })
  generateLocalPtau(PTAU_FILE)
}

const defaultCircuits = ['poh', 'nullifier', 'pod_ownership']
const circuits = (process.env.ZK_CIRCUITS ?? '')
  .split(',')
  .map((circuit) => circuit.trim())
  .filter(Boolean)
const selectedCircuits = circuits.length > 0 ? circuits : defaultCircuits
for (const c of selectedCircuits) {
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
    `echo "${entropy}" | snarkjs zkey contribute ` +
      `"${buildDir}/${c}_0.zkey" "${buildDir}/${c}_final.zkey" --name="NodeZero" -v`,
    { stdio: 'inherit', cwd: root }
  )

  console.log(`[setup] Exporting verification key for ${c}…`)
  snarkjs(`zkey export verificationkey "${buildDir}/${c}_final.zkey" "${buildDir}/${c}_vk.json"`)

  console.log(`[setup] ✓ ${c}: proving key + verification key exported.`)
}

console.log('\n[setup] Trusted setup complete. Artifacts in build/')
