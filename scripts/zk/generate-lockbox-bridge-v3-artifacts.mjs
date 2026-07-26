#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const packageRoot = path.join(repoRoot, 'packages', 'zk-crypto')
const outputDir = path.join(packageRoot, 'build', 'lockb0x_bridge_v3')
const manifestPath = path.join(repoRoot, 'deployments', 'zk-testnet-lockbox-bridge-v3-artifacts.json')
const expectedCircomVersion = process.env.ZK_V3_CIRCOM_VERSION ?? '2.2.2'
const circuitVersion = 3
const ptauPower = Number(process.env.ZK_V3_PTAU_POWER ?? '11')
const snarkjsCli = path.join(packageRoot, 'node_modules', 'snarkjs', 'cli.js')

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: packageRoot,
    stdio: 'inherit',
    ...options,
  })
}

async function hashFile(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

async function artifact(file) {
  const stat = await fs.stat(file)
  return {
    file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
    bytes: stat.size,
    sha256: await hashFile(file),
  }
}

function circomVersion() {
  const output = execFileSync('circom', ['--version'], { encoding: 'utf8' })
  return output.match(/([0-9]+\.[0-9]+\.[0-9]+)/)?.[1]
}

async function main() {
  const detectedVersion = circomVersion()
  if (detectedVersion !== expectedCircomVersion) {
    throw new Error(`Circom ${expectedCircomVersion} is required for V3 artifacts; detected ${detectedVersion ?? 'unknown'}.`)
  }
  if (!Number.isInteger(ptauPower) || ptauPower < 11 || ptauPower > 20) {
    throw new Error('ZK_V3_PTAU_POWER must be an integer between 11 and 20.')
  }

  await fs.rm(outputDir, { recursive: true, force: true })
  await fs.mkdir(outputDir, { recursive: true })

  const circuit = path.join(packageRoot, 'circuits', 'pod_stellar_bridge_v3.circom')
  run('circom', [circuit, '--r1cs', '--wasm', '--sym', '-o', outputDir, '-l', packageRoot])

  const r1cs = path.join(outputDir, 'pod_stellar_bridge_v3.r1cs')
  const ptau0 = path.join(outputDir, `pot${ptauPower}_0000.ptau`)
  const ptau1 = path.join(outputDir, `pot${ptauPower}_0001.ptau`)
  const ptauFinal = path.join(outputDir, `pot${ptauPower}_final.ptau`)
  const zkey0 = path.join(outputDir, 'pod_stellar_bridge_v3_0000.zkey')
  const zkey = path.join(outputDir, 'pod_stellar_bridge_v3_final.zkey')
  const vk = path.join(outputDir, 'pod_stellar_bridge_v3_vk.json')
  run(process.execPath, [snarkjsCli, 'powersoftau', 'new', 'bn128', String(ptauPower), ptau0])
  run(process.execPath, [snarkjsCli, 'powersoftau', 'contribute', ptau0, ptau1])
  run(process.execPath, [snarkjsCli, 'powersoftau', 'prepare', 'phase2', ptau1, ptauFinal])
  run(process.execPath, [snarkjsCli, 'groth16', 'setup', r1cs, ptauFinal, zkey0])
  run(process.execPath, [snarkjsCli, 'zkey', 'contribute', zkey0, zkey])
  run(process.execPath, [snarkjsCli, 'zkey', 'export', 'verificationkey', zkey, vk])

  const files = [
    r1cs,
    path.join(outputDir, 'pod_stellar_bridge_v3.sym'),
    path.join(outputDir, 'pod_stellar_bridge_v3_js', 'pod_stellar_bridge_v3.wasm'),
    ptauFinal,
    zkey,
    vk,
  ]
  const artifacts = await Promise.all(files.map(artifact))
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      network: 'testnet',
      protocolMajor: 27,
      circuit: 'pod_stellar_bridge_v3',
      circuitVersion,
      ptauPower,
      publicSignals: ['claimHash', 'accountCommitment', 'podBinding'],
      circomVersion: detectedVersion,
      snarkjsVersion: '0.7.5',
      generatedAt: new Date().toISOString(),
      artifacts,
    }, null, 2) + '\n',
  )
  console.log(`Wrote V3 Testnet artifact manifest: ${manifestPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})