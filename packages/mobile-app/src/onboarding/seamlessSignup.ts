/**
 * @module seamlessSignup
 *
 * In-app "Create Your Node" flow that provisions a Solid account + Pod via the
 * NodeZero provisioner `POST /v1/solid-account` endpoint, with no browser
 * redirect. Gated behind the `seamlessOnboardingEnabled` app config flag; when
 * disabled the legacy redirect flow (see signupBridge) is used instead.
 *
 * The user's preferred notification email is captured here so a later Azure
 * Email Communication Services integration can reach them. The Stellar public
 * key is forwarded so the provisioner anchors the WebID<->Stellar pairing in a
 * per-user lockb0x on-chain.
 */

import Constants from 'expo-constants'

export interface SeamlessSignupConfig {
  enabled: boolean
  provisionerUrl: string
}

export interface CreateNodeInput {
  /** Desired Pod handle, e.g. "alice". Normalised server-side. */
  handle: string
  /** User's preferred notification email (also used as the CSS login email). */
  notificationEmail: string
  /** Stellar public key to anchor the WebID pairing on-chain (optional). */
  stellarPublicKey?: string
}

export interface CreateNodeResult {
  status: string
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  accountDocumentUrl: string | null
  clientCredentials: { id: string; secret: string; resource: string }
  lockbox: {
    status: string
    userLockboxContractId: string | null
    factoryContractId: string | null
    proofRootHex?: string
  } | null
}

export function getSeamlessSignupConfig(): SeamlessSignupConfig {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const enabled = (appExtra?.seamlessOnboardingEnabled ?? '').trim().toLowerCase() === 'true'
  const provisionerUrl = (appExtra?.jssProvisionerUrl ?? '').trim().replace(/\/+$/, '')
  return { enabled: enabled && provisionerUrl.length > 0, provisionerUrl }
}

function generatePassword(): string {
  const bytes = new Uint8Array(24)
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/**
 * Provisions a Solid account + Pod (and on-chain anchor) via the provisioner.
 * Throws on validation or provisioning failure.
 */
export async function createSeamlessNode(input: CreateNodeInput): Promise<CreateNodeResult> {
  const config = getSeamlessSignupConfig()
  if (!config.enabled) {
    throw new Error('Seamless onboarding is not enabled in this build.')
  }

  const handle = normalizeHandle(input.handle)
  if (!handle) {
    throw new Error('Choose a node handle using letters and numbers.')
  }
  const email = input.notificationEmail.trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Enter a valid notification email address.')
  }

  const body: Record<string, string> = {
    name: handle,
    email,
    password: generatePassword(),
  }
  if (input.stellarPublicKey && /^G[A-Z2-7]{55}$/.test(input.stellarPublicKey)) {
    body.stellarPublicKey = input.stellarPublicKey
  }

  const res = await fetch(`${config.provisionerUrl}/v1/solid-account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let message = `Node creation failed (${res.status}).`
    try {
      const parsed = JSON.parse(text) as { error?: string }
      if (parsed.error) message = parsed.error
    } catch {
      // keep default message
    }
    throw new Error(message)
  }

  return JSON.parse(text) as CreateNodeResult
}
