import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { NotificationHistoryRecord } from '@nodezero/solid-pod-sync'

void test('NotificationHistoryRecord types and structure validate correctly', () => {
  const eventRecord: NotificationHistoryRecord = {
    kind: 'event',
    recordedAt: '2026-08-27T12:00:00.000Z',
    event: {
      eventId: 'evt-1',
      type: 'social.relationship_request',
      category: 'social',
      priority: 'normal',
      occurredAt: '2026-08-27T12:00:00.000Z',
      summary: 'Alice sent you a relationship request',
      resourceRefs: ['https://solid.nodezero.social/alice/profile/card#me'],
    },
  }

  assert.equal(eventRecord.kind, 'event')
  assert.equal(eventRecord.event.category, 'social')
  assert.equal(eventRecord.event.eventId, 'evt-1')
})
