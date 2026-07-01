/**
 * @module attestationAnchor
 *
 * Phase E — anchors a member's ZK identity commitment + encrypted attestation
 * ciphertext into their Lockb0x by invoking `set_attestation` as the Deployer
 * (the lockbox operator in the Deployer-anchored model).
 *
 * Zero runtime dependencies: uses the shared `stellar` CLI helpers only.
 */

import { ensureDeployerFunded } from './deployerTopup.js'
import { getDeployerSourceAccount, NETWORK, resolvePublicKey, runStellar } from './stellarCli.js'

const DEFAULT_RPC_URL = process.env.JSS_STELLAR_RPC_URL ?? process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE =
  process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
  process.env.NZ_STELLAR_NETWORK_PASSPHRASE ??
  (NETWORK === 'testnet'
    ? 'Test SDF Network ; September 2015'
    : 'Public Global Stellar Network ; September 2015')

const HEX32 = /^[0-9a-f]{64}$/i
const HEX_EVEN = /^[0-9a-f]*$/i

export interface AnchorAttestationResult {
  lockboxContractId: string
  operator: string
  txOutput: string
}

/**
 * Invokes `Lockb0x.set_attestation(caller=Deployer, account_commitment, ciphertext)`.
 * Fail-closed: throws when the Deployer is unconfigured/underfunded or the
 * inputs are malformed. The Deployer must be the lockbox operator.
 *
 * @param lockboxContractId - The user's Lockb0x contract (C...).
 * @param accountCommitmentHex - 32-byte hex `Poseidon(identitySecret)`.
 * @param ciphertextHex - hex of the AES-GCM attestation ciphertext.
 */
export async function anchorAttestation(
  lockboxContractId: string,
  accountCommitmentHex: string,
  ciphertextHex: string,
): Promise<AnchorAttestationResult> {
  const lockbox = (lockboxContractId ?? '').trim()
  if (!/^C[A-Z0-9]{55}$/.test(lockbox)) {
    throw new Error('lockboxContractId must be a valid Soroban contract id (C...).')
  }
  const commitment = (accountCommitmentHex ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (!HEX32.test(commitment)) {
    throw new Error('accountCommitment must be 32-byte hex.')
  }
  const ciphertext = (ciphertextHex ?? '').trim().toLowerCase().replace(/^0x/, '')
  if (ciphertext.length === 0 || ciphertext.length % 2 !== 0 || !HEX_EVEN.test(ciphertext)) {
    throw new Error('ciphertext must be non-empty even-length hex.')
  }
  // Contract caps at 4096 bytes; reject early (2 hex chars per byte).
  if (ciphertext.length > 4096 * 2) {
    throw new Error('ciphertext exceeds the 4096-byte on-chain cap.')
  }

  const deployerAlias = getDeployerSourceAccount()
  if (!deployerAlias) {
    throw new Error('Deployer source account is not configured (JSS_DEPLOYER_SOURCE_ACCOUNT).')
  }

  // Ensure the Deployer can pay the invocation gas.
  await ensureDeployerFunded()
  const deployerPublicKey = await resolvePublicKey(deployerAlias)

  const txOutput = await runStellar([
    'contract',
    'invoke',
    '--id',
    lockbox,
    '--rpc-url',
    DEFAULT_RPC_URL,
    '--network-passphrase',
    NETWORK_PASSPHRASE,
    '--source-account',
    deployerAlias,
    '--',
    'set_attestation',
    '--caller',
    deployerPublicKey,
    '--account_commitment',
    commitment,
    '--ciphertext',
    ciphertext,
  ]).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`set_attestation invocation failed for ${lockbox}: ${message}`)
  })

  return { lockboxContractId: lockbox, operator: deployerPublicKey, txOutput }
}
