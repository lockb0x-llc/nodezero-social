import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { findPublicInterestOverlap, readPublicPeerProfile } from './publicPeerProfileClient'

const peerWebId = 'https://peer.example/profile/card#me'

void test('reads a peer profile only through the provisioner endpoint', async () => {
  let requestUrl = ''
  const profile = await readPublicPeerProfile(
    'https://api.nodezero.example/',
    peerWebId,
    (input, init): Promise<Response> => {
      requestUrl = String(input)
      assert.equal(init?.method, 'POST')
      assert.deepEqual(JSON.parse(String(init?.body)), { webId: peerWebId })
      return Promise.resolve(new Response(JSON.stringify({
        webId: peerWebId,
        authenticated: false,
        profile: {
          displayName: 'Peer',
          bio: 'Public bio',
          interests: ['Solid'],
          isNsfw: false,
        },
      }), { status: 200 }))
    }
  )

  assert.equal(requestUrl, 'https://api.nodezero.example/v1/public-profile/read')
  assert.equal(profile?.displayName, 'Peer')
})

void test('computes stable case-insensitive public interest overlap', () => {
  assert.deepEqual(
    findPublicInterestOverlap(['Solid', 'Privacy', 'solid'], ['solid', 'Music']),
    ['Solid']
  )
})
