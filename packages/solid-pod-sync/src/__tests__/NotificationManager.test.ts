import {
  assertValidDigestManifest,
  assertValidNotificationEvent,
  assertValidNotificationPreferences,
  NotificationManager,
} from '../index.js'

const jestGlobal = import.meta.jest

describe('Notification contract validation', () => {
  it('accepts valid preferences, event, and digest manifest payloads', () => {
    expect(() =>
      assertValidNotificationPreferences({
        version: 1,
        channels: { email: true },
        digest: {
          cadence: 'daily',
          timezone: 'UTC',
          quietHours: { start: '22:00', end: '07:00' },
        },
        categories: {
          security: true,
          social: false,
        },
        locale: 'en-US',
        updatedAt: '2026-07-07T00:00:00.000Z',
      })
    ).not.toThrow()

    expect(() =>
      assertValidNotificationEvent({
        eventId: 'evt_1',
        type: 'account.created',
        category: 'account',
        occurredAt: '2026-07-07T00:00:00.000Z',
        priority: 'normal',
      })
    ).not.toThrow()

    expect(() =>
      assertValidDigestManifest({
        digestId: 'digest_20260707',
        windowStart: '2026-07-06T00:00:00.000Z',
        windowEnd: '2026-07-07T00:00:00.000Z',
        includedEventIds: ['evt_1'],
        renderedAt: '2026-07-07T00:05:00.000Z',
        deliveryStatus: 'sent',
        channel: 'email',
      })
    ).not.toThrow()
  })

  it('rejects invalid notification preferences payloads', () => {
    expect(() =>
      assertValidNotificationPreferences({
        version: 2,
        channels: { email: true },
        digest: {
          cadence: 'hourly' as never,
          timezone: '',
        },
        categories: {
          unknown: true,
        } as never,
        updatedAt: 'invalid-time',
      } as never)
    ).toThrow('Notification preferences contract validation failed')
  })
})

describe('NotificationManager', () => {
  it('upserts preferences and writes to the Pod notification path', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 })

    const manager = new NotificationManager({ fetch })
    const preferences = await manager.upsertPreferences('https://alice.example/', {
      digest: { cadence: 'weekly' },
      categories: { product: false },
    })

    expect(preferences.digest.cadence).toBe('weekly')
    expect(preferences.categories.product).toBe(false)

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0]).toBe('https://alice.example/backpack/notifications/preferences.json')
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('records events and digests in date-partitioned history documents', async () => {
    const fetch = jestGlobal
      .fn()
      // listHistory(event) -> 404
      .mockResolvedValueOnce({ ok: false, status: 404 })
      // write history(event)
      .mockResolvedValueOnce({ ok: true, status: 201 })
      // listHistory(digest) -> existing history file
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            '@context': 'https://vocab.nodezero.social/notification-history/v1',
            '@type': 'NotificationHistory',
            date: '2026-07-07',
            records: [
              {
                kind: 'event',
                recordedAt: '2026-07-07T00:00:00.000Z',
                event: {
                  eventId: 'evt_1',
                  type: 'account.created',
                  category: 'account',
                  occurredAt: '2026-07-07T00:00:00.000Z',
                },
              },
            ],
          }),
      })
      // write history(digest)
      .mockResolvedValueOnce({ ok: true, status: 201 })

    const manager = new NotificationManager({ fetch })

    await manager.recordEvent('https://alice.example/', {
      eventId: 'evt_1',
      type: 'account.created',
      category: 'account',
      occurredAt: '2026-07-07T00:00:00.000Z',
    })

    await manager.recordDigestManifest('https://alice.example/', {
      digestId: 'digest_20260707',
      windowStart: '2026-07-06T00:00:00.000Z',
      windowEnd: '2026-07-07T00:00:00.000Z',
      includedEventIds: ['evt_1'],
      renderedAt: '2026-07-07T00:05:00.000Z',
      deliveryStatus: 'sent',
      channel: 'email',
    })

    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch.mock.calls[0][0]).toBe('https://alice.example/backpack/notifications/history/2026-07-07.json')
    expect(fetch.mock.calls[2][0]).toBe('https://alice.example/backpack/notifications/history/2026-07-07.json')
  })
})
