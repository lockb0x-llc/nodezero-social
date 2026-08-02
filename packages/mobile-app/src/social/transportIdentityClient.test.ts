import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { MessageEnvelope } from '@nodezero/waku-comms'
import {
  issueTransportIdentityAssertion,
  verifyWakuEnvelopeIdentity,
} from './transportIdentityClient'

const envelope: MessageEnvelope = {
  id: 'message-1',
  senderWebId: 'https://alice.example/profile/card#me',
  senderStellarPublicKey: `G${'A'.repeat(55)}`,
  transportIdentityAssertion: 'waku-assertion',
  timestamp: '2026-08-01T12:00:00.000Z',
  kind: 'chat',
  body: '{"scheme":"plain","text":"hello"}',
  signatureBase64: 'signature',
}

void test('issues transport identity only through authenticated provisioner fetch', async () => {
  let requestUrl = ''
  const assertion = await issueTransportIdentityAssertion({
    provisionerUrl: 'https://api.nodezero.example/',
    audience: 'relay',
    authFetch: (url, init): Promise<Response> => {
      requestUrl = String(url)
      assert.deepEqual(JSON.parse(String(init?.body)), { audience: 'relay' })
      return Promise.resolve(new Response(JSON.stringify({
        assertion: 'relay-assertion',
        audience: 'relay',
      }), { status: 200 }))
    },
  })
  assert.equal(requestUrl, 'https://api.nodezero.example/v1/transport-identity/assertion')
  assert.equal(assertion, 'relay-assertion')
})

void test('accepts only an assertion response matching the envelope identity', async () => {
  const verify = (payload: Record<string, unknown>): Promise<Response> =>
    Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  assert.equal(await verifyWakuEnvelopeIdentity({
    provisionerUrl: 'https://api.nodezero.example',
    envelope,
    fetch: () => verify({
      audience: 'waku',
      webId: envelope.senderWebId,
      stellarPublicKey: envelope.senderStellarPublicKey,
    }),
  }), true)
  assert.equal(await verifyWakuEnvelopeIdentity({
    provisionerUrl: 'https://api.nodezero.example',
    envelope,
    fetch: () => verify({
      audience: 'waku',
      webId: 'https://attacker.example/profile/card#me',
      stellarPublicKey: envelope.senderStellarPublicKey,
    }),
  }), false)
})
