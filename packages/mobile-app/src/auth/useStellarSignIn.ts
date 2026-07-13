/**
 * @module useStellarSignIn
 *
 * React hook that performs the three-step returning-user Stellar sign-in
 * sequence entirely on-device:
 *
 *  1. Request a short-lived challenge from the provisioner
 *     (`POST /v1/auth/stellar-challenge`).
 *  2. Sign the challenge payload with the device Stellar keypair via
 *     `WalletContext.signAttestationChallenge` — the private key never
 *     leaves the device.
 *  3. Exchange the signature for a short-lived `loginToken` from the
 *     provisioner (`POST /v1/auth/stellar-token`).
 *
 * The returned `{ loginToken, tokenVerifyUrl }` pair is passed to
 * `SolidContext.signIn` so the OIDC redirect URL carries `nz_stellar_token`
 * and `nz_stellar_token_verify` params.  The CSS `StellarLoginHandler` plugin
 * intercepts them in the login template, validates the token via the
 * provisioner, and creates the CSS account session — the user never sees the
 * CSS login UI.
 */

import { useCallback } from 'react'
import Constants from 'expo-constants'
import { useWallet } from '../contexts/WalletContext'

export interface StellarSignInToken {
  loginToken: string
  tokenVerifyUrl: string
}

interface StellarChallengeResponse {
  challengeId: string
  nonce: string
  stellarPublicKey: string
  webId: string
  expiresAt: string
}

interface StellarTokenResponse {
  loginToken: string
  tokenVerifyUrl: string
  expiresAt: string
}

const STELLAR_AUTH_AUDIENCE = 'nz-css-stellar-login-v1'
const REQUEST_TIMEOUT_MS = 12_000

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

function getProvisionerUrl(): string {
  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return (extra?.jssProvisionerUrl ?? '').trim().replace(/\/+$/, '')
}

/**
 * Returns an async function that, given the user's `webId`, performs the full
 * Stellar sign-in token flow and returns `{ loginToken, tokenVerifyUrl }`.
 *
 * Throws a descriptive `Error` on any failure so the caller can fall back to
 * the standard OIDC redirect.
 */
export function useStellarSignIn(): (webId: string) => Promise<StellarSignInToken> {
  const { signAttestationChallenge, walletInfo } = useWallet()

  return useCallback(async (webId: string): Promise<StellarSignInToken> => {
    const provisionerUrl = getProvisionerUrl()
    if (!provisionerUrl) {
      throw new Error('Provisioner URL is not configured — cannot perform Stellar sign-in.')
    }
    if (!walletInfo?.publicKey) {
      throw new Error('Stellar wallet is not ready — cannot perform Stellar sign-in.')
    }

    // --- Step 1: request a challenge ---
    const challengeResp = await fetchWithTimeout(`${provisionerUrl}/v1/auth/stellar-challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ stellarPublicKey: walletInfo.publicKey, webId }),
    })
    if (!challengeResp.ok) {
      const errText = await challengeResp.text().catch(() => '')
      throw new Error(`Stellar challenge request failed (${challengeResp.status}): ${errText}`)
    }
    const challenge = (await challengeResp.json()) as StellarChallengeResponse

    // --- Step 2: sign the challenge payload on-device ---
    // The signed payload matches what the provisioner verifies server-side.
    const signedPayload = JSON.stringify({
      nonce: challenge.nonce,
      stellarPublicKey: challenge.stellarPublicKey,
      audience: STELLAR_AUTH_AUDIENCE,
    })
    const { signatureBase64 } = await signAttestationChallenge(signedPayload)

    // --- Step 3: exchange signature for a login token ---
    const tokenResp = await fetchWithTimeout(`${provisionerUrl}/v1/auth/stellar-token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        stellarPublicKey: walletInfo.publicKey,
        signatureBase64,
      }),
    })
    if (!tokenResp.ok) {
      const errText = await tokenResp.text().catch(() => '')
      throw new Error(`Stellar token request failed (${tokenResp.status}): ${errText}`)
    }
    const tokenData = (await tokenResp.json()) as StellarTokenResponse

    return {
      loginToken: tokenData.loginToken,
      tokenVerifyUrl: tokenData.tokenVerifyUrl,
    }
  }, [signAttestationChallenge, walletInfo?.publicKey])
}
