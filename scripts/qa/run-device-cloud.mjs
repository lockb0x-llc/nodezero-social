#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'

const endpoint = (process.env.NZ_DEVICE_CLOUD_ENDPOINT ?? '').replace(/\/$/, '')
const token = process.env.NZ_DEVICE_CLOUD_TOKEN ?? ''
const commit = (process.env.NZ_DEVICE_EXPECTED_SHA ?? '').trim()
const appUrl = (process.env.NZ_DEVICE_EXPECTED_URL ?? 'https://staging.nodezero.social').replace(/\/$/, '')
const outputPath = process.env.NZ_DEVICE_CLOUD_OUTPUT ?? 'device-evidence/browser-tab.json'
const timeoutMs = Number(process.env.NZ_DEVICE_CLOUD_TIMEOUT_MS ?? 45 * 60_000)

if (!endpoint || !token) throw new Error('NZ_DEVICE_CLOUD_ENDPOINT and NZ_DEVICE_CLOUD_TOKEN are required.')
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('NZ_DEVICE_EXPECTED_SHA must be a full commit SHA.')

const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  accept: 'application/json',
}
const dispatch = await fetch(`${endpoint}/runs`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    schemaVersion: 1,
    commit,
    appUrl,
    envProfile: 'staging-testnet',
    lanes: [
      { platform: 'ios', mode: 'browser-tab', browser: 'safari', versions: ['current', 'previous'] },
      { platform: 'android', mode: 'browser-tab', browser: 'chrome', devices: ['pixel', 'samsung'] },
    ],
  }),
})
if (!dispatch.ok) throw new Error(`Device-cloud dispatch failed (${dispatch.status}).`)
const dispatched = await dispatch.json()
if (typeof dispatched.runId !== 'string' || !dispatched.runId) throw new Error('Device-cloud dispatch returned no runId.')

const deadline = Date.now() + timeoutMs
while (Date.now() < deadline) {
  const response = await fetch(`${endpoint}/runs/${encodeURIComponent(dispatched.runId)}`, { headers })
  if (!response.ok) throw new Error(`Device-cloud status failed (${response.status}).`)
  const status = await response.json()
  if (status.status === 'failed') throw new Error(`Device-cloud run failed: ${String(status.reason ?? 'unknown failure')}`)
  if (status.status === 'completed') {
    if (status.evidence?.commit !== commit) throw new Error('Device-cloud evidence SHA does not match the candidate.')
    await writeFile(outputPath, `${JSON.stringify(status.evidence, null, 2)}\n`, 'utf8')
    console.log(`[device-cloud] PASS: ${dispatched.runId}`)
    process.exit(0)
  }
  await new Promise((resolve) => setTimeout(resolve, 15_000))
}

throw new Error(`Device-cloud run ${dispatched.runId} timed out.`)