#!/usr/bin/env node
/**
 * demo-poh.mjs — End-to-end Proof-of-Humanity demo
 *
 * Demonstrates the full ZK flow:
 *   1. Derive ZK identity from a Stellar key
 *   2. Build a Poseidon Merkle tree with test identities
 *   3. Generate a Groth16 proof (poh.circom circuit)
 *   4. Verify proof locally with snarkjs
 *   5. Submit proof to PoHVerifier on Stellar TestNet
 *   6. Print on-chain transaction hash
 *
 * Usage:
 *   node scripts/zk/demo-poh.mjs [--dry-run]
 *
 * Prerequisites:
 *   1. pnpm --filter @nodezero/zk-crypto build:circuits
 *   2. pnpm --filter @nodezero/zk-crypto build:setup
 *   3. stellar contract deploy ... (PoHVerifier deployed, ID in env)
 */

import {
  deriveIdentity,
  PoseidonMerkleTree,
  generatePoHProof,
  verifyPoHProof,
  proofToSorobanArgs,
  GLOBAL_SCOPE,
} from '../../packages/zk-crypto/src/index.js'

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Contract,
  xdr,
  BASE_FEE,
  rpc as StellarRpc,
} from '@stellar/stellar-sdk'

const DRY_RUN = process.argv.includes('--dry-run')

// ── Config ────────────────────────────────────────────────────────────────────

const STELLAR_SECRET = process.env.STELLAR_SECRET_KEY
  ?? 'SCZANGBA5YELC4RIKPLDWJMFLV2HSLIBNQZXAGHE5PONPIZJN5QPH3TH' // dev-only placeholder

const POH_VERIFIER_CONTRACT_ID = process.env.NZ_POH_VERIFIER_CONTRACT_ID ?? ''
const RPC_URL = process.env.NZ_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org'
const NETWORK_PASSPHRASE = Networks.TESTNET

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n[demo-poh] NodeZero.social — ZK Proof of Humanity demo\n')

  // 1. Derive ZK identity from Stellar key
  const keypair = Keypair.fromSecret(STELLAR_SECRET)
  console.log('[1] Stellar public key:', keypair.publicKey())

  const identity = await deriveIdentity(STELLAR_SECRET)
  console.log('[1] ZK commitment (leaf):', identity.commitment.toString(16).slice(0, 16) + '…')

  // 2. Build Merkle tree with 5 test identities + our identity
  console.log('\n[2] Building Poseidon Merkle tree (depth 20)…')
  const tree = new PoseidonMerkleTree(20)
  await tree.init()

  // Insert some dummy commitments to make it a real tree
  for (let i = 0n; i < 4n; i++) {
    await tree.insert(i + 1n) // dummy commitments
  }
  const ourIndex = await tree.insert(identity.commitment)
  console.log('[2] Identity inserted at leaf index:', ourIndex)

  const root = await tree.getRoot()
  const merkleProof = await tree.getProof(ourIndex)
  console.log('[2] Merkle root:', root.toString(16).slice(0, 16) + '…')

  // 3. Generate Groth16 proof
  console.log('\n[3] Generating Groth16 proof (this may take 10–30 seconds)…')
  const { proof, publicSignals, nullifier } = await generatePoHProof({
    identitySecret: identity.identitySecret,
    merkleProof,
    scope: GLOBAL_SCOPE,
  })
  console.log('[3] Nullifier:', nullifier.toString(16).slice(0, 16) + '…')
  console.log('[3] Public signals:', publicSignals)

  // 4. Verify locally
  console.log('\n[4] Verifying proof locally with snarkjs…')
  const valid = await verifyPoHProof(proof, publicSignals)
  console.log('[4] Local verification:', valid ? '✓ PASS' : '✗ FAIL')
  if (!valid) {
    console.error('[4] Proof failed local verification — aborting.')
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] Skipping on-chain submission.')
    console.log('[dry-run] Proof args (hex):', proofToSorobanArgs(proof, publicSignals))
    return
  }

  // 5. Submit proof to PoHVerifier on Stellar TestNet
  if (!POH_VERIFIER_CONTRACT_ID) {
    console.warn('\n[5] NZ_POH_VERIFIER_CONTRACT_ID not set — skipping on-chain step.')
    return
  }

  console.log('\n[5] Submitting proof to PoHVerifier…')
  const server = new StellarRpc.Server(RPC_URL)
  const account = await server.getAccount(keypair.publicKey())
  const { proofHex, rootHex, nullifierHex, scopeHex } = proofToSorobanArgs(proof, publicSignals)

  const contract = new Contract(POH_VERIFIER_CONTRACT_ID)
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(
      'verify_poh',
      xdr.ScVal.scvBytes(Buffer.from(proofHex, 'hex')),
      xdr.ScVal.scvBytes(Buffer.from(rootHex, 'hex')),
      xdr.ScVal.scvBytes(Buffer.from(nullifierHex, 'hex')),
      xdr.ScVal.scvBytes(Buffer.from(scopeHex, 'hex')),
    ))
    .setTimeout(30)
    .build()

  const prepared = await server.prepareTransaction(tx)
  prepared.sign(keypair)

  const response = await server.sendTransaction(prepared)
  console.log('[5] Transaction submitted:', response.hash)

  if (response.status === 'PENDING') {
    let pollResult
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000))
      pollResult = await server.getTransaction(response.hash)
      if (pollResult.status !== 'NOT_FOUND') break
    }
    console.log('[5] Transaction status:', pollResult?.status)
    if (pollResult?.status === 'SUCCESS') {
      console.log('\n✓ Proof of Humanity verified on-chain!')
      console.log('  Nullifier recorded. This identity cannot prove again for this scope.')
    }
  }
}

main().catch(err => {
  console.error('[demo-poh] Fatal error:', err)
  process.exit(1)
})
