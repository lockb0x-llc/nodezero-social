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

interface CssControls {
  account: { create: string; pod: string; clientCredentials: string; webId: string }
  password: { create: string; login: string }
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
  const pod = await postJson<{ pod?: string; webId?: string }>(authedControls.account.pod, token, { name: input.name })

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
