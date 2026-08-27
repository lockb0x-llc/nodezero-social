import { strict as assert } from 'node:assert'
import { webcrypto } from 'node:crypto'
import { test } from 'node:test'
import {
  StatusL2Adapter,
  StatusL2Error,
  type AgentCapabilityEscrowParams,
} from './StatusL2Adapter.js'

function createAdapter(customJsonRpc?: (method: string, params: unknown[]) => Promise<unknown>): StatusL2Adapter {
  return new StatusL2Adapter({
    network: 'status-testnet',
    crypto: webcrypto as unknown as Crypto,
    ...(customJsonRpc ? { customJsonRpc } : {}),
  })
}

void test('creates and funds an escrow agreement with valid parameters', async () => {
  const adapter = createAdapter()
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600
  const params: AgentCapabilityEscrowParams = {
    agreementId: 'agreement-001',
    providerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amountWei: '1000000000000000000', // 1 ETH
    deadlineEpochSec: futureDeadline,
    deliverableDigestHex: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  }

  const result = await adapter.createEscrowAgreement(params)
  assert.equal(result.status, 'Funded')
  assert.equal(result.agreementId, 'agreement-001')
  assert.ok(result.txHash.startsWith('0x'))

  const status = await adapter.getEscrowStatus('agreement-001')
  assert.ok(status)
  assert.equal(status?.state, 'Funded')
  assert.equal(status?.amountWei, '1000000000000000000')
  assert.equal(status?.provider, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
})

void test('rejects invalid inputs on escrow creation', async () => {
  const adapter = createAdapter()
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600

  await assert.rejects(
    adapter.createEscrowAgreement({
      agreementId: '',
      providerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amountWei: '1000',
      deadlineEpochSec: futureDeadline,
    }),
    (error: unknown) => error instanceof StatusL2Error && error.code === 'invalid_agreement_id',
  )

  await assert.rejects(
    adapter.createEscrowAgreement({
      agreementId: 'valid-id',
      providerAddress: 'not-an-address',
      amountWei: '1000',
      deadlineEpochSec: futureDeadline,
    }),
    (error: unknown) => error instanceof StatusL2Error && error.code === 'invalid_provider',
  )

  await assert.rejects(
    adapter.createEscrowAgreement({
      agreementId: 'valid-id',
      providerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amountWei: '1000',
      deadlineEpochSec: Math.floor(Date.now() / 1000) - 10,
    }),
    (error: unknown) => error instanceof StatusL2Error && error.code === 'deadline_expired',
  )
})

void test('releases escrow funds upon matching deliverable digest verification', async () => {
  const adapter = createAdapter()
  const futureDeadline = Math.floor(Date.now() / 1000) + 3600
  const digest = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff'

  await adapter.createEscrowAgreement({
    agreementId: 'agreement-settle-1',
    providerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amountWei: '500000000000000000',
    deadlineEpochSec: futureDeadline,
    deliverableDigestHex: digest,
  })

  // Digest mismatch should reject
  await assert.rejects(
    adapter.releaseEscrow('agreement-settle-1', '0x0000000000000000000000000000000000000000000000000000000000000000'),
    (error: unknown) => error instanceof StatusL2Error && error.code === 'digest_mismatch',
  )

  // Matching digest should succeed
  const releaseResult = await adapter.releaseEscrow('agreement-settle-1', digest)
  assert.equal(releaseResult.status, 'Settled')

  const status = await adapter.getEscrowStatus('agreement-settle-1')
  assert.equal(status?.state, 'Settled')
  assert.ok(status?.settledAt && status.settledAt > 0)
})

void test('refunds escrow funds when deadline has expired', async () => {
  const adapter = createAdapter()
  const deadline = Math.floor(Date.now() / 1000) + 100

  await adapter.createEscrowAgreement({
    agreementId: 'agreement-refund-1',
    providerAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    amountWei: '100000000000000000',
    deadlineEpochSec: deadline,
  })

  // Refund before deadline should fail
  await assert.rejects(
    adapter.refundExpiredEscrow('agreement-refund-1', deadline - 50),
    (error: unknown) => error instanceof StatusL2Error && error.code === 'deadline_expired',
  )

  // Refund after deadline should succeed
  const refundResult = await adapter.refundExpiredEscrow('agreement-refund-1', deadline + 10)
  assert.equal(refundResult.status, 'Refunded')

  const status = await adapter.getEscrowStatus('agreement-refund-1')
  assert.equal(status?.state, 'Refunded')
})

void test('verifyDeliverableDigest computes and validates SHA-256 byte digest', async () => {
  const adapter = createAdapter()
  const data = new TextEncoder().encode('Deliverable agent output: code analysis completed successfully.')

  // Compute expected digest
  const hashBuffer = await webcrypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const expectedDigest = `0x${hex}`

  const matches = await adapter.verifyDeliverableDigest(data, expectedDigest)
  assert.equal(matches, true)

  const altered = new TextEncoder().encode('Tampered agent output')
  const alteredMatches = await adapter.verifyDeliverableDigest(altered, expectedDigest)
  assert.equal(alteredMatches, false)
})
