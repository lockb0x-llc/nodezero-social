/**
 * @module useStellarSignIn
 *
 * Returning-user sign-in: the Stellar keypair is the user's only credential.
 *
 *  1. `POST /v1/auth/stellar-challenge` with the device public key.
 *  2. Sign the challenge payload on-device (`signAttestationChallenge`) —
 *     the private key never leaves the device.
 *  3. `POST /v1/auth/stellar-token` — the provisioner verifies the signature,
 *     resolves the stored client credentials, mints a live Solid token,
 *     probes the Pod, and only then returns a NodeZero session.
 *
 * The caller passes the result to `NodeZeroSessionContext.adoptSession`.
 * There is no browser↔CSS interaction anywhere in this flow.
 */

import { useCallback } from 'react'
import { useWallet } from '../contexts/WalletContext'
import { getProvisionerUrl, type AdoptSessionInput, type SessionLockboxInfo, type SessionTokens } from '../contexts/NodeZeroSessionContext'

interface StellarChallengeResponse {
  challengeId: string
  nonce: string
  stellarPublicKey: string
  expiresAt: string
}

interface StellarLoginResponse {
  session: SessionTokens
  webId: string
  podUrl: string
  lockbox?: SessionLockboxInfo | null
  accounts?: Array<{ webId: string; podUrl: string }>
  error?: string
  code?: string
}

const STELLAR_AUTH_AUDIENCE = 'nz-css-stellar-login-v1'
const REQUEST_TIMEOUT_MS = 12_000

/** Thrown when the provisioner has no account for this keypair. */
export class NoAccountError extends Error {
  constructor() {
    super('No NodeZero account exists for this device key. Create your node to continue.')
    this.name = 'NoAccountError'
  }
}

export class AccountSelectionRequiredError extends Error {
  readonly accounts: Array<{ webId: string; podUrl: string }>

  constructor(accounts: Array<{ webId: string; podUrl: string }>) {
    super('Multiple NodeZero accounts were found for this device key. Choose one to continue.')
    this.name = 'AccountSelectionRequiredError'
    this.accounts = accounts
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  if (typeof AbortController === 'undefined') return fetch(url, init)
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

/**
 * Returns an async function that performs the full Stellar sign-in and
 * resolves to an `AdoptSessionInput` ready for `adoptSession`.
 *
 * Fail-closed: every failure throws; there is no fallback auth path.
 */
export function useStellarSignIn(): (options?: { webId?: string }) => Promise<AdoptSessionInput> {
  const { signAttestationChallenge, walletInfo } = useWallet()

  return useCallback(async (options?: { webId?: string }): Promise<AdoptSessionInput> => {
    const provisionerUrl = getProvisionerUrl()
    if (!provisionerUrl) {
      throw new Error('Provisioner URL is not configured — cannot sign in.')
    }
    if (!walletInfo?.publicKey) {
      throw new Error('Stellar wallet is not ready — cannot sign in.')
    }

    // --- Step 1: request a challenge ---
    const challengeResp = await fetchWithTimeout(`${provisionerUrl}/v1/auth/stellar-challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ stellarPublicKey: walletInfo.publicKey }),
    })
    if (!challengeResp.ok) {
      const errText = await challengeResp.text().catch(() => '')
      throw new Error(`Sign-in challenge failed (${challengeResp.status}): ${errText}`)
    }
    const challenge = (await challengeResp.json()) as StellarChallengeResponse

    // --- Step 2: sign the challenge payload on-device ---
    const signedPayload = JSON.stringify({
      nonce: challenge.nonce,
      stellarPublicKey: challenge.stellarPublicKey,
      audience: STELLAR_AUTH_AUDIENCE,
    })
    const { signatureBase64 } = await signAttestationChallenge(signedPayload)

    // --- Step 3: exchange signature for a NodeZero session ---
    const loginResp = await fetchWithTimeout(`${provisionerUrl}/v1/auth/stellar-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        stellarPublicKey: walletInfo.publicKey,
        signatureBase64,
        webId: options?.webId,
      }),
    })
    const payload = (await loginResp.json().catch(() => ({}))) as StellarLoginResponse
    if (!loginResp.ok) {
      if (payload.code === 'no_account') {
        throw new NoAccountError()
      }
      if (payload.code === 'account_selection_required' && Array.isArray(payload.accounts) && payload.accounts.length > 0) {
        throw new AccountSelectionRequiredError(payload.accounts)
      }
      throw new Error(payload.error ?? `Sign-in failed (${loginResp.status}).`)
    }
    if (!payload.session?.accessToken || !payload.webId || !payload.podUrl) {
      throw new Error('Sign-in did not return a complete session.')
    }

    return {
      session: payload.session,
      webId: payload.webId,
      podUrl: payload.podUrl,
      lockbox: payload.lockbox ?? null,
    }
  }, [signAttestationChallenge, walletInfo?.keyId, walletInfo?.publicKey])
}
