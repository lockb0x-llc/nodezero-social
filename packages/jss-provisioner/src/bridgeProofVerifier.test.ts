import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { verifyBridgeProof } from './bridgeProofVerifier.js'

void test('rejects a verification key whose digest does not match configuration', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify({ protocol: 'groth16', curve: 'bn128' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

  try {
    await assert.rejects(
      verifyBridgeProof({
        proofHex: '00'.repeat(256),
        publicSignals: ['1', '2', '3'],
        verificationKeyUrl: 'https://artifacts.example/vk.json',
        verificationKeySha256: 'f'.repeat(64),
      }),
      /verification key digest/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
