import {
  OutboxDeliveryWorker,
  createProvisionerActivityDeliverer,
  type ActivityDeliverer,
} from '../OutboxDeliveryWorker.js'
import type {
  DeliveryReceipt,
  RelationshipActivity,
} from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const activityId = 'https://alice.example/social/outbox/follow-bob.jsonld'
const now = new Date('2026-08-01T12:00:00.000Z')

const activity: RelationshipActivity = {
  version: 1,
  id: activityId,
  type: 'Follow',
  actor: alice,
  object: bob,
  publishedAt: '2026-08-01T12:00:00.000Z',
}

describe('OutboxDeliveryWorker', () => {
  it('delivers single activity, recording pending then delivered receipt', async () => {
    const receipts: DeliveryReceipt[] = []
    const recorded: DeliveryReceipt[] = []
    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue(receipts),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => {
        recorded.push(r)
        return Promise.resolve(r)
      }),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockResolvedValue(activity),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(false),
    }
    const deliverer: ActivityDeliverer = jestGlobal.fn().mockResolvedValue({
      status: 200,
      inboxUrl: 'https://bob.example/inbox/',
    })

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore, { deliverer })
    const result = await worker.deliverSingleActivity({
      podRoot: 'https://alice.example/',
      activity,
      recipientWebId: bob,
      now,
    })

    expect(result.status).toBe('delivered')
    expect(result.httpStatus).toBe(200)
    expect(result.inboxUrl).toBe('https://bob.example/inbox/')
    expect(deliverer).toHaveBeenCalledWith({ recipientWebId: bob, activity })
    expect(recorded.length).toBe(2)
    expect(recorded[0]?.status).toBe('pending')
    expect(recorded[1]?.status).toBe('delivered')
  })

  it('rejects delivery if recipient is blocked by local moderation policy', async () => {
    const recorded: DeliveryReceipt[] = []
    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue([]),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => {
        recorded.push(r)
        return Promise.resolve(r)
      }),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockResolvedValue(activity),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(true),
    }
    const deliverer = jestGlobal.fn()

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore, { deliverer })
    const result = await worker.deliverSingleActivity({
      podRoot: 'https://alice.example/',
      activity,
      recipientWebId: bob,
      now,
    })

    expect(result.status).toBe('rejected')
    expect(result.errorCode).toBe('recipient_blocked')
    expect(deliverer).not.toHaveBeenCalled()
    expect(recorded.length).toBe(1)
    expect(recorded[0]?.status).toBe('rejected')
  })

  it('records failed receipt when deliverer returns an HTTP error', async () => {
    const recorded: DeliveryReceipt[] = []
    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue([]),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => {
        recorded.push(r)
        return Promise.resolve(r)
      }),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockResolvedValue(activity),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(false),
    }
    const deliverer = jestGlobal.fn().mockResolvedValue({
      status: 502,
      error: 'Discovery failed',
      code: 'discovery_failed',
    })

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore, { deliverer })
    const result = await worker.deliverSingleActivity({
      podRoot: 'https://alice.example/',
      activity,
      recipientWebId: bob,
      now,
    })

    expect(result.status).toBe('failed')
    expect(result.httpStatus).toBe(502)
    expect(result.errorCode).toBe('discovery_failed')
    expect(recorded[1]?.status).toBe('failed')
    expect(recorded[1]?.errorCode).toBe('discovery_failed')
  })

  it('records failed receipt when deliverer throws an exception', async () => {
    const recorded: DeliveryReceipt[] = []
    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue([]),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => {
        recorded.push(r)
        return Promise.resolve(r)
      }),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockResolvedValue(activity),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(false),
    }
    const deliverer = jestGlobal.fn().mockRejectedValue(new Error('Network offline'))

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore, { deliverer })
    const result = await worker.deliverSingleActivity({
      podRoot: 'https://alice.example/',
      activity,
      recipientWebId: bob,
      now,
    })

    expect(result.status).toBe('failed')
    expect(result.error).toBe('Network offline')
    expect(recorded[1]?.status).toBe('failed')
  })

  it('processes batch of pending receipts and retries failed ones', async () => {
    const pendingReceipt: DeliveryReceipt = {
      version: 1,
      activityId,
      senderWebId: alice,
      recipientWebId: bob,
      status: 'pending',
      updatedAt: now.toISOString(),
    }
    const failedReceipt: DeliveryReceipt = {
      version: 1,
      activityId: 'https://alice.example/social/outbox/follow-carol.jsonld',
      senderWebId: alice,
      recipientWebId: 'https://carol.example/profile/card#me',
      status: 'failed',
      updatedAt: now.toISOString(),
      errorCode: 'delivery_failed',
    }

    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue([pendingReceipt, failedReceipt]),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => Promise.resolve(r)),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockImplementation((_root: string, id: string) =>
        Promise.resolve({ ...activity, id })
      ),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(false),
    }
    const deliverer = jestGlobal.fn().mockResolvedValue({ status: 200, inboxUrl: 'https://inbox.example/' })

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore, { deliverer })
    const batchResult = await worker.processPendingReceipts({
      podRoot: 'https://alice.example/',
      retryFailed: true,
      now,
    })

    expect(batchResult.total).toBe(2)
    expect(batchResult.delivered).toBe(2)
    expect(batchResult.failed).toBe(0)
    expect(deliverer).toHaveBeenCalledTimes(2)
  })

  it('marks receipt failed if outbox activity is missing during batch processing', async () => {
    const receiptStore = {
      listDeliveryReceipts: jestGlobal.fn().mockResolvedValue([{
        version: 1,
        activityId,
        senderWebId: alice,
        recipientWebId: bob,
        status: 'pending',
        updatedAt: now.toISOString(),
      }]),
      getDeliveryReceipt: jestGlobal.fn().mockResolvedValue(null),
      recordDeliveryReceipt: jestGlobal.fn().mockImplementation((_root: string, r: DeliveryReceipt) => Promise.resolve(r)),
    }
    const outboxStore = {
      readActivity: jestGlobal.fn().mockResolvedValue(null),
    }
    const moderationStore = {
      isBlocked: jestGlobal.fn().mockResolvedValue(false),
    }

    const worker = new OutboxDeliveryWorker(receiptStore, outboxStore, moderationStore)
    const batchResult = await worker.processPendingReceipts({
      podRoot: 'https://alice.example/',
      now,
    })

    expect(batchResult.total).toBe(1)
    expect(batchResult.delivered).toBe(0)
    expect(batchResult.failed).toBe(1)
    expect(batchResult.results[0]?.errorCode).toBe('activity_missing')
  })

  it('createProvisionerActivityDeliverer posts formatted payload to provisioner endpoint', async () => {
    const fetchMock = jestGlobal.fn().mockResolvedValue(new Response(JSON.stringify({
      activityId: activity.id,
      recipientWebId: bob,
      status: 202,
      inboxUrl: 'https://bob.example/inbox/',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const deliverer = createProvisionerActivityDeliverer({
      provisionerUrl: 'https://api.nodezero.example',
      authFetch: fetchMock,
    })

    const result = await deliverer({ recipientWebId: bob, activity })
    expect(result.status).toBe(200)
    expect(result.inboxUrl).toBe('https://bob.example/inbox/')
    expect(fetchMock).toHaveBeenCalledWith('https://api.nodezero.example/v1/social/relationship-delivery', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        recipientWebId: bob,
        activity: {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activity.id,
          type: 'Follow',
          actor: alice,
          object: bob,
          published: activity.publishedAt,
        },
      }),
    })
  })
})
