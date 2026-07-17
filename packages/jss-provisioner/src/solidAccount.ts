/**
 * @module solidAccount
 *
 * Server-side Community Solid Server (CSS) account + Pod provisioning via the
 * CSS 7.x Account JSON API. Runs inside the JSS provisioner so secrets and the
 * CSS-Account-Token never reach the browser, and CORS is avoided.
 *
 * Flow: GET /.account/ (controls) -> account.create -> password.create
 *       -> account.pod -> read linked WebID -> account.clientCredentials.
 *
 * The CSS base URL is config-driven (JSS_SOLID_CSS_BASE_URL) so staging never
 * targets a production Pod host.
 */

export interface CreateSolidAccountInput {
  /** Pod handle / name, e.g. "alice". Determines the Pod path and WebID. */
  name: string
  /** Account login email. */
  email: string
  /** Account password (callers should derive this from the Stellar seed). */
  password: string
}

export interface CreateSolidAccountResult {
  webId: string
  podUrl: string
  clientCredentialsId: string
  clientCredentialsSecret: string
  clientCredentialsResource: string
}

export interface ClientCredentials {
  id: string
  secret: string
}

interface CssControls {
  account: { create: string; pod: string; clientCredentials: string; webId: string }
  password: { create: string; login: string }
}

const CSS_POD_LOCK_RETRY_ATTEMPTS = Number(process.env.JSS_SOLID_CSS_POD_LOCK_RETRY_ATTEMPTS ?? 3)
const CSS_POD_LOCK_RETRY_BASE_DELAY_MS = Number(process.env.JSS_SOLID_CSS_POD_LOCK_RETRY_BASE_DELAY_MS ?? 350)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isCssPodLockTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const lower = error.message.toLowerCase()
  return lower.includes('lock expired after') && lower.includes('/pod')
}

async function getControls(baseUrl: string, authorization?: string): Promise<CssControls> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(`${baseUrl}/.account/`, { headers })
  if (!res.ok) {
    throw new Error(`CSS index request failed (${res.status}): ${await res.text()}`)
  }
  const body = (await res.json()) as { controls: CssControls }
  return body.controls
}

async function postJson<T>(url: string, authorization: string | undefined, payload: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  if (authorization) headers.authorization = `CSS-Account-Token ${authorization}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload ?? {}) })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`CSS POST ${url} failed (${res.status}): ${text}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

async function createPodWithRetry(
  podEndpoint: string,
  token: string,
  name: string,
): Promise<{ pod?: string; webId?: string }> {
  const attempts = Math.max(1, CSS_POD_LOCK_RETRY_ATTEMPTS)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await postJson<{ pod?: string; webId?: string }>(podEndpoint, token, { name })
    } catch (error) {
      const isLastAttempt = attempt === attempts
      if (!isCssPodLockTimeoutError(error) || isLastAttempt) {
        if (isCssPodLockTimeoutError(error) && isLastAttempt) {
          throw new Error('Pod provisioning is temporarily busy. Please wait a few seconds and try again.')
        }
        throw error
      }
      await sleep(CSS_POD_LOCK_RETRY_BASE_DELAY_MS * attempt)
    }
  }

  // Unreachable because loop exits via return/throw; keeps TS control-flow exhaustive.
  throw new Error('Pod provisioning failed unexpectedly.')
}

/**
 * Creates a Solid account + Pod on the configured CSS server and returns the
 * WebID, Pod URL, and freshly minted client credentials.
 */
export async function createSolidAccount(
  baseUrl: string,
  input: CreateSolidAccountInput,
): Promise<CreateSolidAccountResult> {
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  const controls = await getControls(normalizedBase)
  const created = await postJson<{ authorization?: string }>(controls.account.create, undefined, {})
  const token = created.authorization
  if (!token) {
    throw new Error('CSS account.create did not return an authorization token.')
  }

  const authedControls = await getControls(normalizedBase, token)
  await postJson(authedControls.password.create, token, { email: input.email, password: input.password })
  const pod = await createPodWithRetry(authedControls.account.pod, token, input.name)

  const refreshed = await getControls(normalizedBase, token)
  const webIdRes = await fetch(refreshed.account.webId, {
    headers: { accept: 'application/json', authorization: `CSS-Account-Token ${token}` },
  })
  if (!webIdRes.ok) {
    throw new Error(`CSS webId lookup failed (${webIdRes.status}): ${await webIdRes.text()}`)
  }
  const webIdBody = (await webIdRes.json()) as { webIdLinks?: Record<string, string> }
  const webId = pod.webId ?? Object.keys(webIdBody.webIdLinks ?? {})[0]
  if (!webId) {
    throw new Error('CSS account.pod did not yield a linked WebID.')
  }

  const cc = await postJson<{ id?: string; secret?: string; resource?: string }>(
    refreshed.account.clientCredentials,
    token,
    { name: `nz-${input.name}`, webId },
  )
  if (!cc.id || !cc.secret) {
    throw new Error('CSS clientCredentials did not return an id/secret.')
  }

  return {
    webId,
    podUrl: pod.pod ?? `${normalizedBase}/${input.name}/`,
    clientCredentialsId: cc.id,
    clientCredentialsSecret: cc.secret,
    clientCredentialsResource: cc.resource ?? '',
  }
}

// ---------------------------------------------------------------------------
// Authenticated Pod writes (client_credentials + ES256 DPoP)
//
// CSS's OIDC token endpoint accepts the client_credentials grant and binds the
// issued access token to a DPoP key. The resource server rejects EdDSA DPoP
// proofs, so the per-request DPoP key is ES256 (P-256). These writes run
// server-side in the provisioner so the client secret never reaches the
// browser.
// ---------------------------------------------------------------------------

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

interface DpopSigner {
  proof: (htu: string, htm: string, ath?: string) => string
}

async function createDpopSigner(): Promise<DpopSigner> {
  const { generateKeyPairSync, sign, randomUUID } = await import('node:crypto')
  const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const pub = keyPair.publicKey.export({ format: 'jwk' }) as { crv?: string; kty?: string; x?: string; y?: string }
  const jwk = { crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y }

  return {
    proof(htu, htm, ath) {
      const header = { alg: 'ES256', typ: 'dpop+jwt', jwk }
      const payload: Record<string, unknown> = {
        htu,
        htm,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
      }
      if (ath) payload.ath = ath
      const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`
      const sig = sign('sha256', Buffer.from(signingInput), {
        key: keyPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      return `${signingInput}.${b64url(sig)}`
    },
  }
}

interface TokenExchangeResult {
  accessToken: string
  /** Epoch ms when the access token expires (best-effort from expires_in). */
  expiresAtMs: number
}

async function exchangeClientCredentials(
  baseUrl: string,
  credentials: ClientCredentials,
  signer: DpopSigner,
): Promise<TokenExchangeResult> {
  const tokenUrl = `${baseUrl}/.oidc/token`
  const basic = Buffer.from(
    `${encodeURIComponent(credentials.id)}:${encodeURIComponent(credentials.secret)}`,
  ).toString('base64')
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      dpop: signer.proof(tokenUrl, 'POST'),
    },
    body: 'grant_type=client_credentials&scope=webid',
  })
  const body = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!res.ok || !body.access_token) {
    throw new Error(`CSS token exchange failed (${res.status}): ${JSON.stringify(body)}`)
  }
  const expiresInSec = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 600
  return {
    accessToken: body.access_token,
    expiresAtMs: Date.now() + expiresInSec * 1000,
  }
}

export interface PodAccessToken {
  accessToken: string
  expiresAtMs: number
  /** Builds a per-request DPoP proof bound to this access token. */
  proof: (htu: string, htm: string) => string
}

/**
 * Exchanges stored client credentials for a live DPoP-bound access token.
 * This is the *only* way any component obtains Solid access — a failure here
 * means the session invariant does not hold and callers must fail closed.
 */
export async function mintPodAccessToken(
  baseUrl: string,
  credentials: ClientCredentials,
): Promise<PodAccessToken> {
  const { createHash } = await import('node:crypto')
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const signer = await createDpopSigner()
  const exchange = await exchangeClientCredentials(normalizedBase, credentials, signer)
  const ath = b64url(createHash('sha256').update(exchange.accessToken).digest())
  return {
    accessToken: exchange.accessToken,
    expiresAtMs: exchange.expiresAtMs,
    proof: (htu, htm) => signer.proof(htu, htm, ath),
  }
}

/**
 * Fail-closed Pod probe: verifies the minted token can actually read the Pod
 * root. Used at session issuance so a NodeZero session is never handed out
 * without live, working Solid access.
 */
export async function probePodAccess(token: PodAccessToken, podUrl: string): Promise<void> {
  const target = podUrl.endsWith('/') ? podUrl : `${podUrl}/`
  const res = await fetch(target, {
    method: 'HEAD',
    headers: {
      authorization: `DPoP ${token.accessToken}`,
      dpop: token.proof(target, 'HEAD'),
    },
  })
  if (!res.ok) {
    throw new Error(`Pod access probe failed (${res.status}) for ${target}`)
  }
}

/**
 * Writes (PUT) a document into an already-provisioned Pod using a fresh
 * client_credentials access token + ES256 DPoP proofs. Returns the resource URL.
 */
export async function writePodDocument(
  baseUrl: string,
  credentials: ClientCredentials,
  options: { resourceUrl: string; contentType: string; body: string },
): Promise<string> {
  const token = await mintPodAccessToken(baseUrl, credentials)

  const res = await fetch(options.resourceUrl, {
    method: 'PUT',
    headers: {
      authorization: `DPoP ${token.accessToken}`,
      dpop: token.proof(options.resourceUrl, 'PUT'),
      'content-type': options.contentType,
    },
    body: options.body,
  })
  if (!res.ok) {
    throw new Error(`CSS Pod PUT ${options.resourceUrl} failed (${res.status}): ${await res.text()}`)
  }
  return options.resourceUrl
}

/**
 * Persists the NodeZero account profile (WebID <-> Stellar pairing + on-chain
 * lockb0x references) as a JSON document inside the user's own Pod, so the
 * account data lives with the user from creation. Returns the document URL.
 */
export async function writePodAccountDocument(
  baseUrl: string,
  credentials: ClientCredentials,
  podUrl: string,
  account: Record<string, unknown>,
): Promise<string> {
  const normalizedPod = podUrl.replace(/\/+$/, '')
  const resourceUrl = `${normalizedPod}/nodezero-account.json`
  return writePodDocument(baseUrl, credentials, {
    resourceUrl,
    contentType: 'application/json',
    body: JSON.stringify(account, null, 2),
  })
}

/**
 * Allocates the NodeZero anchor "slot" in the user's WebID profile card by
 * PATCH-inserting RDF triples (SPARQL Update) that publish the on-chain
 * bindings — lockb0x contract, Stellar account, and ZK identity commitment.
 *
 * This makes the on-chain attestation discoverable directly from the WebID (the
 * canonical identity), so any party can verify the Pod ↔ Stellar ↔ lockb0x link
 * without trusting NodeZero. Triples are ADDED (INSERT DATA), preserving the
 * existing `foaf:Person` / `solid:oidcIssuer` profile.
 */
export async function patchPodProfileAnchor(
  baseUrl: string,
  credentials: ClientCredentials,
  webId: string,
  anchor: { lockboxContractId: string; stellarPublicKey: string; accountCommitmentHex: string },
): Promise<string> {
  const cardUrl = webId.split('#')[0]
  const token = await mintPodAccessToken(baseUrl, credentials)

  const lit = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  const sparql =
    `PREFIX nz: <https://nodezero.social/ns#>\n` +
    `INSERT DATA { <${webId}> ` +
    `nz:lockboxContract ${lit(anchor.lockboxContractId)} ; ` +
    `nz:stellarAccount ${lit(anchor.stellarPublicKey)} ; ` +
    `nz:accountCommitment ${lit(anchor.accountCommitmentHex)} ; ` +
    `nz:attestationAnchoredAt ${lit(new Date().toISOString())} . }`

  const res = await fetch(cardUrl, {
    method: 'PATCH',
    headers: {
      authorization: `DPoP ${token.accessToken}`,
      dpop: token.proof(cardUrl, 'PATCH'),
      'content-type': 'application/sparql-update',
    },
    body: sparql,
  })
  if (!res.ok) {
    throw new Error(`CSS Pod PATCH ${cardUrl} failed (${res.status}): ${await res.text()}`)
  }
  return cardUrl
}
