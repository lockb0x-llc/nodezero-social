#!/usr/bin/env node

import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function hashMilestoneQCohortIdentity(webId, key) {
  const normalizedWebId = String(webId).trim()
  const normalizedKey = String(key).trim()
  if (!normalizedKey) throw new Error('JSS_Q_COHORT_KEY is required.')
  if (!normalizedWebId) throw new Error('A WebID is required.')
  return createHmac('sha256', normalizedKey).update(normalizedWebId).digest('hex')
}

async function main() {
  const key = process.env.JSS_Q_COHORT_KEY ?? ''
  if (!key.trim()) throw new Error('JSS_Q_COHORT_KEY is required.')
  let input = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) input += chunk
  const webIds = input
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (webIds.length === 0) throw new Error('Provide one WebID per stdin line.')
  const hashes = webIds.map((webId) => hashMilestoneQCohortIdentity(webId, key))
  process.stdout.write(`${hashes.join(',')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
