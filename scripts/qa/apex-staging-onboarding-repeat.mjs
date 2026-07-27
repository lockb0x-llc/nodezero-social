#!/usr/bin/env node

/**
 * Runs the headed apex-to-staging onboarding evidence journey sequentially.
 * Every iteration creates a new Testnet-only account and its own sanitized
 * evidence bundle, so this intentionally remains bounded and serial.
 *
 * Usage:
 *   NZ_E2E_ITERATIONS=3 pnpm qa:evidence:apex-staging-onboarding:repeat
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rawIterations = process.env.NZ_E2E_ITERATIONS ?? '3'
const iterations = Number(rawIterations)
const evidenceDir = resolve(process.env.NZ_ONBOARDING_EVIDENCE_DIR ?? 'docs/screenshots/onboarding')
const runnerPath = fileURLToPath(new URL('./apex-staging-onboarding-evidence.mjs', import.meta.url))

if (
  !/^\d+$/.test(rawIterations) ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  iterations > 10
) {
  throw new Error('NZ_E2E_ITERATIONS must be an integer from 1 through 10.')
}

function runIteration(index) {
  return new Promise((resolveIteration, rejectIteration) => {
    console.log(`[apex-staging-repeat] Starting iteration ${index}/${iterations}.`)
    const child = spawn(process.execPath, [runnerPath], {
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', rejectIteration)
    child.once('close', (code) => {
      if (code === 0) {
        resolveIteration()
        return
      }
      rejectIteration(
        new Error(`Iteration ${index}/${iterations} failed with exit code ${String(code)}.`)
      )
    })
  })
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  const startedAtUtc = new Date().toISOString()
  const completedIterations = []

  for (let index = 1; index <= iterations; index += 1) {
    await runIteration(index)
    completedIterations.push(index)
  }

  const summary = {
    schemaVersion: 1,
    startedAtUtc,
    completedAtUtc: new Date().toISOString(),
    iterationsRequested: iterations,
    iterationsCompleted: completedIterations,
    assertions: {
      allIterationsPassed: true,
      sequentialExecution: true,
    },
  }
  const stamp = Date.now().toString(36)
  await writeFile(
    resolve(evidenceDir, `${stamp}-repeat-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  )
  console.log(`[apex-staging-repeat] PASS: ${iterations} iteration(s) completed.`)
}

main().catch((error) => {
  console.error(`[apex-staging-repeat] FAIL: ${String(error?.stack || error)}`)
  process.exit(1)
})
