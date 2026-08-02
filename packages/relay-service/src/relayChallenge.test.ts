import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { Keypair } from '@stellar/stellar-sdk'
import {
  createRelayIdentityChallenge,
  verifyRelayIdentitySignature,
} from './relayChallenge.js'

void test('accepts only a signature from the assertion-bound Stellar key', () => {
  const identity = Keypair.random()
  const attacker = Keypair.random()
  const challenge = createRelayIdentityChallenge(
    'https://alice.example/profile/card#me',
    identity.publicKey(),
    'one-time-nonce'
  )
  const signature = identity.sign(Buffer.from(challenge)).toString('base64')

  assert.equal(verifyRelayIdentitySignature(challenge, identity.publicKey(), signature), true)
  assert.equal(verifyRelayIdentitySignature(challenge, attacker.publicKey(), signature), false)
  assert.equal(verifyRelayIdentitySignature(`${challenge}-altered`, identity.publicKey(), signature), false)
})
