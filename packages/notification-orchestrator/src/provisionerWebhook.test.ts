import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { NotificationOrchestrator } from './orchestrator.js'
import { ingestProvisionerEvent } from './provisionerWebhook.js'
import {
  ConsoleEmailSender,
  InMemoryMessageStore,
  InMemoryPreferencesStore,
  InMemoryUserDirectory,
} from './runtime.js'

const WEB_ID = 'https://solid.nodezero.social/alice/profile/card#me'
const POD_URL = 'https://solid.nodezero.social/alice/'

function createOrchestrator() {
  return new NotificationOrchestrator({
    preferencesStore: new InMemoryPreferencesStore(),
    messageStore: new InMemoryMessageStore(),
    emailSender: new ConsoleEmailSender(),
    userDirectory: new InMemoryUserDirectory({
      [WEB_ID]: {
        webId: WEB_ID,
        podUrl: POD_URL,
        email: 'alice@example.com',
      },
    }),
  })
}

void test('ingests valid provisioner event payload', async () => {
  const orchestrator = createOrchestrator()
  const result = await ingestProvisionerEvent(orchestrator, {
    specVersion: '1.0',
    eventId: 'evt-1',
    eventType: 'account.created',
    occurredAt: '2026-07-07T20:00:00.000Z',
    envProfile: 'staging-testnet',
    issuer: 'https://solid.nodezero.social',
    webId: WEB_ID,
    podUrl: POD_URL,
    stellarPublicKey: 'GA123',
  })

  assert.equal(result.accepted, true)
  assert.match(result.message, /ingested/i)
  assert.ok(result.messageId)
})

void test('rejects invalid provisioner event payload', async () => {
  const orchestrator = createOrchestrator()
  const result = await ingestProvisionerEvent(orchestrator, {
    eventType: 'account.created',
  })

  assert.equal(result.accepted, false)
  assert.match(result.message, /invalid provisioning event payload/i)
})
