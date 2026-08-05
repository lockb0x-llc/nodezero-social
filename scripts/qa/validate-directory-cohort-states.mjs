#!/usr/bin/env node

function parseState(name) {
  const raw = process.env[name] ?? ''
  const state = JSON.parse(raw)
  if (!Array.isArray(state.cookies) || state.cookies.length === 0) {
    throw new Error(`${name} must contain cookies.`)
  }
  const session = state.cookies.find((cookie) => cookie?.name === '__Host-nz_browser_session')
  if (!session || typeof session.value !== 'string' || !session.value) {
    throw new Error(`${name} is missing the NodeZero browser session cookie.`)
  }
  return session.value
}

const configured = (process.env.JSS_Q_COHORT_HASHES ?? '')
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
if (
  configured.length !== 2 ||
  configured[0] === configured[1] ||
  configured.some((value) => !/^[0-9a-f]{64}$/.test(value))
) {
  throw new Error('Exactly two distinct lowercase SHA-256 cohort hashes are required.')
}
const accountA = parseState('DIRECTORY_ACCOUNT_A_STORAGE_STATE')
const accountB = parseState('DIRECTORY_ACCOUNT_B_STORAGE_STATE')
const control = parseState('DIRECTORY_NON_COHORT_STORAGE_STATE')
if (new Set([accountA, accountB, control]).size !== 3) {
  throw new Error('Directory E2E storage states must contain three distinct browser sessions.')
}
process.stdout.write('Directory cohort storage states validated.\n')
