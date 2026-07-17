import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  createNotificationEventPublisherFromEnv,
  publishProvisioningEvent,
} from './notificationEvents.js'

void test('defaults to noop publisher mode when not configured', async () => {
  const publisher = createNotificationEventPublisherFromEnv({}, () =>
    Promise.reject(new Error('fetch should not be called in noop mode'))
  )

  assert.equal(publisher.mode, 'none')
  await publishProvisioningEvent(publisher, 'account.created', {
    envProfile: 'staging-testnet',
    issuer: 'https://staging.nodezero.social',
  })
})

void test('uses stdout mode when configured', async () => {
  const logs: string[] = []
  const originalLog = console.log
  console.log = (...args: unknown[]): void => {
    logs.push(args.map((arg) => String(arg)).join(' '))
  }

  try {
    const publisher = createNotificationEventPublisherFromEnv({
      JSS_NOTIFICATION_EVENT_MODE: 'stdout',
    })

    assert.equal(publisher.mode, 'stdout')
    await publishProvisioningEvent(publisher, 'account.created', {
      envProfile: 'staging-testnet',
      issuer: 'https://staging.nodezero.social',
      webId: 'https://solid.nodezero.social/alice/profile/card#me',
      podUrl: 'https://solid.nodezero.social/alice/',
    })

    assert.equal(logs.length, 1)
    assert.match(logs[0] ?? '', /jss-provisioner:event/)
    assert.match(logs[0] ?? '', /account\.created/)
  } finally {
    console.log = originalLog
  }
})

void test('uses webhook mode and sends event payload', async () => {
  let called = false
  const fetchMock: typeof globalThis.fetch = (input, init) => {
    called = true
    assert.equal(String(input), 'https://example.test/events')
    assert.equal(init?.method, 'POST')
    assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer test-token')
    return Promise.resolve(new Response('', { status: 202 }))
  }

  const publisher = createNotificationEventPublisherFromEnv(
    {
      JSS_NOTIFICATION_EVENT_MODE: 'webhook',
      JSS_NOTIFICATION_WEBHOOK_URL: 'https://example.test/events',
      JSS_NOTIFICATION_WEBHOOK_TOKEN: 'test-token',
    },
    fetchMock
  )

  assert.equal(publisher.mode, 'webhook')

  await publishProvisioningEvent(publisher, 'provision.ready', {
    envProfile: 'staging-testnet',
    issuer: 'https://staging.nodezero.social',
    webId: 'https://solid.nodezero.social/alice/profile/card#me',
    podUrl: 'https://solid.nodezero.social/alice/',
  })

  assert.equal(called, true)
})
