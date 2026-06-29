// Solid Pod creation smoke against the self-hosted CSS server (MVP).
// Runs the CSS 7.x account JSON API flow:
//   GET /.account/ -> account.create -> password.create -> account.pod
//   -> account.clientCredentials
// Prints the created WebID, Pod URL, and client-credential id/secret.
//
// Uses Node's built-in fetch only (no third-party deps).
// Env:
//   CSS_BASE_URL   (required) e.g. https://<app>.<region>.azurecontainerapps.io/
//   POD_NAME       (optional) defaults to a random nodezero demo handle
//   POD_EMAIL      (optional) defaults to <name>@nodezero.test
//   POD_PASSWORD   (optional) defaults to a random strong password

const BASE = (process.env.CSS_BASE_URL || '').replace(/\/+$/, '')
if (!BASE) {
  console.error('CSS_BASE_URL is required')
  process.exit(1)
}

const rand = Math.random().toString(36).slice(2, 10)
const NAME = process.env.POD_NAME || `nzdemo${rand}`
const EMAIL = process.env.POD_EMAIL || `${NAME}@nodezero.test`
const PASSWORD = process.env.POD_PASSWORD || `Nz!${rand}${Math.random().toString(36).slice(2, 10)}`

const json = { 'content-type': 'application/json', accept: 'application/json' }

async function getControls(authorization) {
  const headers = { accept: 'application/json' }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(`${BASE}/.account/`, { headers })
  if (!res.ok) throw new Error(`index ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body.controls
}

async function postJson(url, authorization, payload) {
  const headers = { ...json }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

async function main() {
  console.log(`[1] discover controls @ ${BASE}/.account/`)
  const controls = await getControls()

  console.log('[2] account.create')
  const created = await postJson(controls.account.create, null, {})
  const token = created.authorization
  if (!token) throw new Error(`no authorization token in account.create response: ${JSON.stringify(created)}`)

  console.log('[3] re-fetch authorized controls')
  const ac = await getControls(token)

  console.log(`[4] password.create (${EMAIL})`)
  await postJson(ac.password.create, token, { email: EMAIL, password: PASSWORD })

  console.log(`[5] account.pod (name=${NAME})`)
  const pod = await postJson(ac.account.pod, token, { name: NAME })

  console.log('[6] re-fetch controls + read linked WebID')
  const ac2 = await getControls(token)
  const webIdRes = await fetch(ac2.account.webId, { headers: { accept: 'application/json', authorization: `CSS-Account-Token ${token}` } })
  const webIds = await webIdRes.json()
  const webId = Object.keys(webIds.webIdLinks || {})[0] || null

  console.log('[7] account.clientCredentials')
  const cc = await postJson(ac2.account.clientCredentials, token, { name: `nz-${NAME}`, webId })

  console.log('\n=== RESULT ===')
  console.log(JSON.stringify({
    podName: NAME,
    email: EMAIL,
    webId,
    pod,
    clientCredentialsId: cc.id,
    clientCredentialsSecretPresent: Boolean(cc.secret),
    clientCredentialsResource: cc.resource,
  }, null, 2))
}

main().catch((err) => {
  console.error('SMOKE_FAILED:', err.message)
  process.exit(1)
})
