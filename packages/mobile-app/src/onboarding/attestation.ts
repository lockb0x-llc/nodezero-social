/**
 * @module onboarding/attestation
 *
 * Client-side production of the real Pod-ownership attestation (Phase D).
 *
 * Runs entirely on-device using the embedded Stellar secret (same trust
 * boundary as signing): it derives the ZK identity, generates a `pod_ownership`
 * Groth16 proof binding the WebID/Pod/Stellar/contract claim, and encrypts the
 * canonical claim under a Stellar-derived AES-256-GCM key for on-chain +
 * in-Pod recovery.
 *
 * The provisioner anchors the returned `accountCommitment` + `ciphertext` in the
 * user's Lockb0x (`set_attestation`). Login / return / peer checks later verify
 * the proof off-chain against that on-chain anchor (see zk-crypto
 * `verifyLoginAttestation`).
 */

import Constants from 'expo-constants'
import type { PodOwnershipClaim } from '@nodezero/zk-crypto/pod-ownership'
import { resolvePodOwnershipArtifacts } from './zkArtifacts'

/**
 * Fixed placeholders for the seamless (non-interactive) attestation claim. The
 * seamless flow has no server challenge, so these constants stand in for the
 * challenge fields. Both prover (here) and verifier (return login / peer) use
 * the same values so `claimHash` is reproducible from Pod facts alone.
 */
const SEAMLESS_CHALLENGE_ID = 'nz-seamless-v1'
const SEAMLESS_NONCE = 'nz-seamless-v1'
const SEAMLESS_EXPIRES_AT = 'nz-seamless-v1'

interface AttestationConfig {
  envProfile: string
  stellarNetworkPassphrase: string
  identityContractId: string
  lockboxFactoryContractId: string
  zkArtifactsUrl: string
  zkManifestUrl: string
}

const STAGING_WEB_HOSTS = new Set([
  'staging.nodezero.social',
  'mango-glacier-0abee9e0f.7.azurestaticapps.net',
])

function isStagingWebHost(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return false
  return STAGING_WEB_HOSTS.has(window.location.hostname.toLowerCase())
}

function getConfig(): AttestationConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>
  const hostFallbackEnabled = isStagingWebHost()
  const envProfile = extra.envProfile ?? 'local'
  const isStagingProfile = envProfile === 'staging-testnet' || (hostFallbackEnabled && envProfile === 'local')

  const identityContractId =
    extra.identityContractId ??
    (isStagingProfile ? 'CCHFYOKLGVTXEYYHWEFPI22FR26VRGG2CBBUTP6XPW3ZSIWIKEVQQ44K' : '')
  const lockboxFactoryContractId =
    extra.lockboxFactoryContractId ??
    (isStagingProfile ? 'CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB' : '')
  const zkArtifactsUrl =
    (extra.zkArtifactsUrl ??
      (isStagingProfile ? 'https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/' : ''))
      .replace(/\/+$/, '')
  const zkManifestUrl =
    (extra.zkManifestUrl ??
      (isStagingProfile
        ? 'https://stki7yquyjmnskg.blob.core.windows.net/zk-artifacts/zk-testnet-artifacts.json'
        : ''))
      .trim()

  return {
    envProfile: isStagingProfile ? 'staging-testnet' : envProfile,
    stellarNetworkPassphrase:
      extra.stellarNetworkPassphrase ??
      (isStagingProfile ? 'Test SDF Network ; September 2015' : ''),
    identityContractId,
    lockboxFactoryContractId,
    zkArtifactsUrl,
    zkManifestUrl,
  }
}

export interface SeamlessAttestationInput {
  /** The WebID returned by the provisioner (authoritative). */
  webId: string
  /** The Pod URL returned by the provisioner. */
  podUrl: string
  /** The member's Stellar public key (G...). */
  stellarPublicKey: string
  /** The embedded wallet secret (S...), used in-process for proof + encryption. */
  stellarSecret: string
}

export interface SeamlessAttestation {
  /** 32-byte hex `Poseidon(identitySecret)` — the on-chain identity anchor. */
  accountCommitmentHex: string
  /** Hex of the AES-256-GCM encrypted canonical claim (on-chain + Pod). */
  ciphertextHex: string
  /** SHA-256 of the ciphertext bytes, hex. */
  ciphertextSha256Hex: string
  /** [claimHash, accountCommitment, podBinding] decimal field elements. */
  publicSignals: string[]
  /** The claim that was proven and encrypted (for the Pod slot / return verify). */
  claim: PodOwnershipClaim
}

/**
 * Builds the canonical Pod-ownership claim from configuration + the provisioned
 * WebID/Pod. Both the prover and the verifier reconstruct this identically.
 */
export function buildSeamlessClaim(input: {
  webId: string
  podUrl: string
  stellarPublicKey: string
}): PodOwnershipClaim {
  const config = getConfig()
  return {
    envProfile: config.envProfile,
    stellarNetworkPassphrase: config.stellarNetworkPassphrase,
    webId: input.webId.trim(),
    podUrl: input.podUrl.trim(),
    stellarPublicKey: input.stellarPublicKey.trim(),
    identityContractId: config.identityContractId,
    lockboxFactoryContractId: config.lockboxFactoryContractId,
    challengeId: SEAMLESS_CHALLENGE_ID,
    nonce: SEAMLESS_NONCE,
    expiresAt: SEAMLESS_EXPIRES_AT,
  }
}

/**
 * Produces the on-device attestation: a `pod_ownership` Groth16 proof plus the
 * Stellar-encrypted claim ciphertext. Throws if ZK artifacts are unconfigured.
 */
export async function produceSeamlessAttestation(
  input: SeamlessAttestationInput,
): Promise<SeamlessAttestation> {
  const config = getConfig()
  if (!config.zkArtifactsUrl || !config.zkManifestUrl) {
    throw new Error('ZK artifact URLs are not configured (NZ_ZK_ARTIFACTS_URL, NZ_ZK_MANIFEST_URL).')
  }

  const claim = buildSeamlessClaim(input)

  // The ZK stack (snarkjs/circomlibjs/ffjavascript) relies on Node's `Buffer`.
  // Expo web does not guarantee a global Buffer in deferred chunks, so ensure it
  // is polyfilled before loading/using the proving code.
  const globalRef = globalThis as unknown as { Buffer?: unknown }
  if (typeof globalRef.Buffer === 'undefined') {
    const bufferModule = await import('buffer')
    globalRef.Buffer = bufferModule.Buffer
  }

  // Dynamically import the heavy ZK stack (snarkjs/circomlibjs) so it is a
  // deferred chunk loaded only when the user creates a node — keeping it out of
  // the app-boot bundle (avoids eager-load Buffer crashes on Expo web).
  const { buildPodOwnershipClaim, generatePodOwnershipProof } = await import('@nodezero/zk-crypto/pod-ownership')
  const { encryptAttestation, fieldToBytes32Hex } = await import('@nodezero/zk-crypto/attestation-cipher')

  const canonicalClaim = buildPodOwnershipClaim(claim)

  // Resolve the proving artifact URLs from the published manifest (same path
  // as custody provisioning) instead of hardcoding filenames, so artifact
  // bundle layout changes cannot silently break seamless onboarding.
  const artifactPaths = await resolvePodOwnershipArtifacts({
    zkArtifactsUrl: config.zkArtifactsUrl,
    zkManifestUrl: config.zkManifestUrl,
  })

  const proof = await generatePodOwnershipProof({
    stellarSecretKey: input.stellarSecret,
    claim,
    wasmPath: artifactPaths.wasmPath,
    zkeyPath: artifactPaths.zkeyPath,
  })

  const encrypted = await encryptAttestation(canonicalClaim, input.stellarSecret)

  return {
    accountCommitmentHex: fieldToBytes32Hex(proof.accountCommitment.toString()),
    ciphertextHex: encrypted.hex,
    ciphertextSha256Hex: encrypted.sha256Hex,
    publicSignals: proof.publicSignals,
    claim,
  }
}
