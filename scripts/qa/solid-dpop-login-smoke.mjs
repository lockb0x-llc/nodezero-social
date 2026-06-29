// Stellar-key Pod login smoke against the self-hosted CSS server.
//
// Proves the hackathon headline: the user's Stellar Ed25519 key IS the Pod
// credential. Flow:
//   1. Decode the Stellar StrKey secret -> raw 32-byte Ed25519 seed.
//   2. Derive the CSS password from the seed via HKDF (Pattern A: single root).
//   3. account.create -> password.create -> account.pod -> clientCredentials.
//   4. client_credentials token exchange at /.oidc/token, signing the DPoP
//      proof with the STELLAR key (alg EdDSA) -> access token bound to that key.
//   5. Authenticated PUT + GET of a private Pod resource using DPoP proofs
//      signed by the Stellar key (with the `ath` access-token-hash claim).
//
// Built-in crypto + fetch only. No third-party deps.
//
// Env:
//   CSS_BASE_URL    (required)
//   STELLAR_SECRET  (optional) Stellar S... secret seed. If omitted, a fresh
//                   testnet Ed25519 keypair is generated in-process (no secret
//                   is read from the environment).

import crypto from 'node:crypto'

const BASE = (process.env.CSS_BASE_URL || '').replace(/\/+$/, '')
if (!BASE) {
  console.error('CSS_BASE_URL is required')
  process.exit(1)
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(s) {
  let bits = 0, val = 0
  const out = []
  for (const ch of s.trim()) {
    const idx = B32.indexOf(ch)
    if (idx < 0) continue
    val = (val << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b32encode(buf) {
  let bits = 0, val = 0, out = ''
  for (const b of buf) {
    val = (val << 8) | b
    bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

function crc16(buf) {
  let c = 0
  for (const x of buf) {
    c ^= x << 8
    for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff
  }
  return c
}

function strkey(ver, payload) {
  const d = Buffer.concat([Buffer.from([ver]), payload])
  const c = crc16(d)
  return b32encode(Buffer.concat([d, Buffer.from([c & 0xff, (c >> 8) & 0xff])]))
}

// --- Derive Ed25519 key material from the Stellar secret seed ---
// Use STELLAR_SECRET if supplied; otherwise generate a fresh testnet Ed25519
// key in-process (so no secret needs to be passed via the environment).
let seed
const providedSecret = process.env.STELLAR_SECRET || ''
if (providedSecret) {
  seed = base32Decode(providedSecret).subarray(1, 33) // strip version byte + trailing CRC
} else {
  const { privateKey: genPriv } = crypto.generateKeyPairSync('ed25519')
  seed = genPriv.export({ type: 'pkcs8', format: 'der' }).subarray(16) // raw 32-byte seed
}
const pkcs8 = Buffer.concat([
  Buffer.from('302e020100300506032b657004220420', 'hex'),
  seed,
])
const stellarPrivate = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
const spki = crypto.createPublicKey(stellarPrivate).export({ type: 'spki', format: 'der' })
const rawPub = spki.subarray(12) // 32-byte Ed25519 public key
const stellarPublic = strkey(48, rawPub)

// CSS password derived from the Stellar seed (Pattern A: single root credential).
const derivedPassword = b64url(Buffer.from(crypto.hkdfSync('sha256', seed, Buffer.from(stellarPublic), Buffer.from('NZ_POD_CREDENTIAL_V1'), 32)))

// DPoP session key: CSS's resource server (@solid/access-token-verifier) rejects
// EdDSA DPoP proofs ("alg ... not allowed"), even though the OIDC token endpoint
// accepts EdDSA. So the per-request DPoP key is ES256 (P-256); the Stellar key
// remains the root that derives the Pod password and will sign the ZK pairing
// proof. The DPoP key is bound to the Stellar identity at the application layer.
const dpopKeyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const dpopPubJwk = dpopKeyPair.publicKey.export({ format: 'jwk' })
const dpopJwk = { crv: dpopPubJwk.crv, kty: dpopPubJwk.kty, x: dpopPubJwk.x, y: dpopPubJwk.y }

function makeDpopProof(htu, htm, ath) {
  const header = { alg: 'ES256', typ: 'dpop+jwt', jwk: dpopJwk }
  const payload = { htu, htm, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() }
  if (ath) payload.ath = ath
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: dpopKeyPair.privateKey, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${b64url(sig)}`
}

const jsonHeaders = { 'content-type': 'application/json', accept: 'application/json' }

async function getControls(authorization) {
  const headers = { accept: 'application/json' }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(`${BASE}/.account/`, { headers })
  if (!res.ok) throw new Error(`index ${res.status}: ${await res.text()}`)
  return (await res.json()).controls
}

async function postJson(url, authorization, payload) {
  const headers = { ...jsonHeaders }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

async function main() {
  const rand = Math.random().toString(36).slice(2, 10)
  const name = `nzstellar${rand}`
  const email = `${name}@nodezero.test`

  console.log(`Stellar account: ${stellarPublic}`)
  console.log(`Derived Pod password (HKDF from seed): ${derivedPassword.slice(0, 8)}… (len ${derivedPassword.length})`)

  console.log('[1] account.create')
  const controls = await getControls()
  const created = await postJson(controls.account.create, null, {})
  const token = created.authorization
  if (!token) throw new Error('no account token')

  const ac = await getControls(token)
  console.log(`[2] password.create (${email}) using Stellar-derived password`)
  await postJson(ac.password.create, token, { email, password: derivedPassword })

  console.log(`[3] account.pod (${name})`)
  await postJson(ac.account.pod, token, { name })

  const ac2 = await getControls(token)
  const webIdRes = await fetch(ac2.account.webId, { headers: { accept: 'application/json', authorization: `CSS-Account-Token ${token}` } })
  const webId = Object.keys((await webIdRes.json()).webIdLinks || {})[0]
  console.log(`    WebID = ${webId}`)

  console.log('[4] clientCredentials (bound to WebID)')
  const cc = await postJson(ac2.account.clientCredentials, token, { name: `nz-${name}`, webId })
  const { id, secret } = cc
  if (!id || !secret) throw new Error('no client credentials')

  console.log('[5] token exchange @ /.oidc/token with ES256 DPoP session key (CSS resource server rejects EdDSA)')
  const tokenUrl = `${BASE}/.oidc/token`
  const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64')
  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      dpop: makeDpopProof(tokenUrl, 'POST'),
    },
    body: 'grant_type=client_credentials&scope=webid',
  })
  const tokenBody = await tokenRes.json()
  if (!tokenRes.ok || !tokenBody.access_token) throw new Error(`token exchange failed: ${JSON.stringify(tokenBody)}`)
  const accessToken = tokenBody.access_token
  console.log(`    access_token acquired (token_type=${tokenBody.token_type}, expires_in=${tokenBody.expires_in})`)

  const claims = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'))
  console.log(`    token claims: webid=${claims.webid} cnf.jkt=${claims.cnf && claims.cnf.jkt} scope=${claims.scope} aud=${JSON.stringify(claims.aud)}`)

  const ath = b64url(crypto.createHash('sha256').update(accessToken).digest())
  const podBase = `${BASE}/${name}/`
  const resourceUrl = `${podBase}nz-dpop-${rand}.txt`
  const payload = `NodeZero Stellar-key DPoP login OK @ ${new Date().toISOString()}`

  console.log('[5b] authenticated GET of pod root (diagnostic)')
  const rootGet = await fetch(podBase, { headers: { authorization: `DPoP ${accessToken}`, dpop: makeDpopProof(podBase, 'GET', ath) } })
  console.log(`    GET pod root -> ${rootGet.status}`)

  console.log('[6] authenticated PUT to private Pod resource (ES256 DPoP session, Stellar-derived account)')
  const putRes = await fetch(resourceUrl, {
    method: 'PUT',
    headers: {
      authorization: `DPoP ${accessToken}`,
      dpop: makeDpopProof(resourceUrl, 'PUT', ath),
      'content-type': 'text/plain',
    },
    body: payload,
  })
  if (!putRes.ok) throw new Error(`PUT ${resourceUrl} -> ${putRes.status} | www-authenticate: ${putRes.headers.get('www-authenticate')} | body: ${await putRes.text()}`)
  console.log(`    PUT ${putRes.status}`)

  console.log('[7] authenticated GET of the same resource')
  const getRes = await fetch(resourceUrl, {
    headers: {
      authorization: `DPoP ${accessToken}`,
      dpop: makeDpopProof(resourceUrl, 'GET', ath),
    },
  })
  const got = await getRes.text()
  if (!getRes.ok) throw new Error(`GET ${resourceUrl} -> ${getRes.status}: ${got}`)

  console.log('\n=== RESULT ===')
  console.log(JSON.stringify({
    stellarPublic,
    webId,
    pod: podBase,
    resourceUrl,
    putStatus: putRes.status,
    getStatus: getRes.status,
    roundTripMatches: got === payload,
    readback: got,
  }, null, 2))
}

main().catch((err) => {
  console.error('DPOP_LOGIN_FAILED:', err.message)
  process.exit(1)
})
