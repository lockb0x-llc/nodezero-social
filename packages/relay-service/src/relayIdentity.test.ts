import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readRelayIdentityAssertion, verifyRelayIdentity } from './relayIdentity.js'

void test('reads an assertion only from the versioned relay subprotocol', () => {
  assert.equal(readRelayIdentityAssertion('nz-relay-v1, signed.assertion'), 'signed.assertion')
  assert.equal(readRelayIdentityAssertion('signed.assertion'), null)
})

void test('accepts only a relay-audience provisioner verification response', async () => {
  const identity = await verifyRelayIdentity({
    assertion: 'signed.assertion',
    provisionerUrl: 'https://api.nodezero.example/',
    fetch: (_url, init): Promise<Response> => {
      assert.deepEqual(JSON.parse(String(init?.body)), {
        assertion: 'signed.assertion',
        audience: 'relay',
      })
      return Promise.resolve(new Response(JSON.stringify({
        audience: 'relay',
        webId: 'https://alice.example/profile/card#me',
        stellarPublicKey: `G${'A'.repeat(55)}`,
      }), { status: 200 }))
    },
  })
  assert.equal(identity?.webId, 'https://alice.example/profile/card#me')
})
