/**
 * @module seamlessSignup
 *
 * In-app "Create Your Node" flow that provisions a Solid account + Pod via the
 * NodeZero provisioner `POST /v1/solid-account` endpoint. There is no browser
 * redirect and no password anywhere in the contract: the CSS account password
 * is generated and discarded server-side, and the response carries a ready
 * NodeZero session — the user lands in the app already authenticated.
 *
 * The user's preferred notification email is captured here so a later Azure
 * Email Communication Services integration can reach them. The Stellar public
 * key is forwarded so the provisioner anchors the WebID<->Stellar pairing in a
 * per-user lockb0x on-chain.
 */

import Constants from 'expo-constants'
import type { SessionLockboxInfo, SessionTokens } from '../contexts/NodeZeroSessionContext'

export interface SeamlessSignupConfig {
  enabled: boolean
  provisionerUrl: string
}

export interface CreateNodeInput {
  /** Desired Pod handle, e.g. "alice". Normalised server-side. */
  handle: string
  /** User's preferred notification email (also used as the CSS login email). */
  notificationEmail: string
  /** Stellar public key to anchor the WebID pairing on-chain. */
  stellarPublicKey?: string
  /** 32-byte hex identity commitment (Poseidon(identitySecret)) to anchor on-chain. */
  accountCommitmentHex?: string
  /** Hex of the Stellar-encrypted attestation claim ciphertext. */
  ciphertextHex?: string
  /** Serialized 256-byte Groth16 `pod_ownership` proof for Lockb0x Bridge v3. */
  proofHex?: string
  /** SHA-256 of the proof and public signals for Lockb0x Bridge v3. */
  proofHashHex?: string
  /** Ordered `pod_ownership` public signals: claim, account commitment, Pod binding. */
  publicSignals?: string[]
  /** Versioned bridge circuit identifier. */
  circuitVersion?: number
}

export interface CreateNodeResult {
  status: string
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  accountDocumentUrl: string | null
  /** Ready NodeZero session — fail-closed verified before issuance. */
  session: SessionTokens
  lockbox: (SessionLockboxInfo & {
    status: string
    userLockboxContractId: string | null
    factoryContractId: string | null
    proofRootHex?: string
  }) | null
  attestation: {
    accountCommitmentHex: string
    ciphertextSha256Hex: string
  } | null
}

interface CheckEmailResult {
  exists?: boolean
}

const CHECK_EMAIL_TIMEOUT_MS = 8000

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return fetch(url, init)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

function isStagingOnboardingHost(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return false

  const host = window.location.hostname.toLowerCase()
  return host === 'staging.nodezero.social' || host === 'mango-glacier-0abee9e0f.7.azurestaticapps.net'
}

export function getSeamlessSignupConfig(): SeamlessSignupConfig {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const hostFallbackEnabled = isStagingOnboardingHost()
  const enabled = (appExtra?.seamlessOnboardingEnabled ?? '').trim().toLowerCase() === 'true'
  const provisionerUrl = (appExtra?.jssProvisionerUrl ?? '').trim().replace(/\/+$/, '')
  const fallbackProvisionerUrl = hostFallbackEnabled
    ? 'https://nodezero-social-staging-testnet-provisioner.azurewebsites.net'
    : ''
  return {
    enabled: (enabled || hostFallbackEnabled) && (provisionerUrl.length > 0 || fallbackProvisionerUrl.length > 0),
    provisionerUrl: provisionerUrl.length > 0 ? provisionerUrl : fallbackProvisionerUrl,
  }
}

export function getProvisionerBaseUrl(): string {
  return getSeamlessSignupConfig().provisionerUrl
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

  // Fail-closed: a valid Stellar public key is mandatory. Without it the
  // provisioner cannot anchor the WebID<->Stellar pairing on-chain, which
  // previously produced an un-anchored account. Require it before submitting.
  const stellarPublicKey = (input.stellarPublicKey ?? '').trim()
  if (!/^G[A-Z2-7]{55}$/.test(stellarPublicKey)) {
    throw new Error('Your wallet is still initializing. Wait a moment and try again.')
  }

  const body: Record<string, string> = {
    name: handle,
    email,
    stellarPublicKey,
  }

  // Include the on-device attestation (identity commitment + encrypted claim)
  // so the provisioner anchors it in the lockb0x during account creation.
  const accountCommitmentHex = (input.accountCommitmentHex ?? '').trim()
  const ciphertextHex = (input.ciphertextHex ?? '').trim()
  if (accountCommitmentHex && ciphertextHex) {
    body.accountCommitmentHex = accountCommitmentHex
    body.ciphertextHex = ciphertextHex
  }

  const proofHex = (input.proofHex ?? '').trim().toLowerCase().replace(/^0x/, '')
  const proofHashHex = (input.proofHashHex ?? '').trim().toLowerCase().replace(/^0x/, '')
  const publicSignals = input.publicSignals ?? []
  if (proofHex || proofHashHex || publicSignals.length > 0) {
    if (!/^[0-9a-f]{512}$/.test(proofHex)) {
      throw new Error('Bridge proof must be a 256-byte hex value.')
    }
    if (!/^[0-9a-f]{64}$/.test(proofHashHex) || publicSignals.length !== 3) {
      throw new Error('Bridge proof hash and three public signals are required.')
    }
    if (!publicSignals.every((signal) => /^\d+$/.test(signal.trim()))) {
      throw new Error('Bridge public signals must be decimal field elements.')
    }
    body.proofHex = proofHex
    body.proofHashHex = proofHashHex
    body.publicSignals = JSON.stringify(publicSignals.map((signal) => signal.trim()))
    body.circuitVersion = String(input.circuitVersion ?? 1)
  }

  const res = await fetch(`${config.provisionerUrl}/v1/solid-account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'include',
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

/**
 * Best-effort server-side duplicate-email precheck.
 *
 * Returns:
 * - `true` when the provisioner can confirm the email is already registered.
 * - `false` when the provisioner can confirm it is not known as registered.
 * - `null` when precheck is unavailable (endpoint missing, transient failure, etc).
 */
export async function checkSeamlessEmailExists(email: string): Promise<boolean | null> {
  const config = getSeamlessSignupConfig()
  if (!config.enabled || !config.provisionerUrl) return null

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
    return null
  }

  try {
    const res = await fetchWithTimeout(
      `${config.provisionerUrl}/v1/solid-account/check-email`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      },
      CHECK_EMAIL_TIMEOUT_MS,
    )

    if (res.status === 404 || res.status === 405 || res.status === 501) {
      return null
    }
    if (!res.ok) {
      return null
    }

    const parsed = (await res.json()) as CheckEmailResult
    return typeof parsed.exists === 'boolean' ? parsed.exists : null
  } catch {
    return null
  }
}
