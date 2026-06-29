// Smoke test for the provisioner POST /v1/solid-account endpoint.
// Verifies the server-side CSS account+Pod creation path end-to-end.
// Built-in fetch only; no third-party deps.
//
// Env:
//   JSS_PROVISIONER_URL (required) e.g. https://...provisioner.azurewebsites.net

import crypto from 'node:crypto'

const BASE = (process.env.JSS_PROVISIONER_URL || '').replace(/\/+$/, '')
if (!BASE) {
  console.error('JSS_PROVISIONER_URL is required')
  process.exit(1)
}

async function main() {
  const rand = Math.random().toString(36).slice(2, 10)
  const name = `nzsvc${rand}`
  const stellarPublicKey = (process.env.STELLAR_PUBLIC || '').trim()
  const body = {
    name,
    email: `${name}@nodezero.test`,
    password: crypto.randomBytes(24).toString('base64url'),
    ...(stellarPublicKey ? { stellarPublicKey } : {}),
  }

  console.log(`POST ${BASE}/v1/solid-account (name=${name}${stellarPublicKey ? `, anchor=${stellarPublicKey}` : ''})`)
  const res = await fetch(`${BASE}/v1/solid-account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`endpoint failed (${res.status}): ${text}`)
  }
  const result = JSON.parse(text)

  console.log('\n=== RESULT ===')
  console.log(JSON.stringify({
    status: result.status,
    webId: result.webId,
    podUrl: result.podUrl,
    stellarPublicKey: result.stellarPublicKey,
    clientCredentialsId: result.clientCredentials?.id,
    clientCredentialsSecretPresent: Boolean(result.clientCredentials?.secret),
    lockbox: result.lockbox,
  }, null, 2))

  if (result.status !== 'ready' || !result.webId || !result.podUrl || !result.clientCredentials?.id) {
    throw new Error('endpoint did not return a complete account result')
  }
  if (stellarPublicKey) {
    if (!result.lockbox || result.lockbox.status !== 'ready' || !result.lockbox.userLockboxContractId) {
      throw new Error('anchoring requested but no per-user lockb0x was returned')
    }
    console.log(`\nANCHORED: userLockboxContractId=${result.lockbox.userLockboxContractId}`)
  }
  console.log('\nSOLID_ACCOUNT_ENDPOINT_OK')
}

main().catch((err) => {
  console.error('SOLID_ACCOUNT_ENDPOINT_FAILED:', err.message)
  process.exit(1)
})
