import { DeliveryReceiptManager } from '../DeliveryReceiptManager.js'
import type { DeliveryReceipt } from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const activityId = 'https://alice.example/social/outbox/follow-bob'
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const datasetUrl = 'https://alice.example/social/delivery-receipts/index'

function receipt(status: DeliveryReceipt['status'], errorCode?: string): DeliveryReceipt {
  return {
    version: 1,
    activityId,
    senderWebId: alice,
    recipientWebId: bob,
    status,
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...(errorCode ? { errorCode } : {}),
  }
}

function responseWithUrl(body: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
  Object.defineProperty(response, 'url', { value: datasetUrl })
  return response
}

function storedReceipt(status = 'pending', error = ''): string {
  return `
    @prefix nz: <https://nodezero.social/ns#> .
    <${datasetUrl}#activity-${encodeURIComponent(activityId)}>
      a nz:DeliveryReceipt ; nz:version 1 ; nz:activityId <${activityId}> ;
      nz:senderWebId <${alice}> ; nz:recipientWebId <${bob}> ;
      nz:deliveryStatus "${status}" ; nz:updatedAt "2026-08-01T12:00:00.000Z"
      ${error ? `; nz:errorCode "${error}"` : ''} .
  `
}

describe('DeliveryReceiptManager', () => {
  it('records a delivery receipt in the private ledger', async () => {
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new DeliveryReceiptManager({ fetch })

    await expect(manager.recordDeliveryReceipt('https://alice.example/', receipt('pending')))
      .resolves.toEqual(receipt('pending'))
    expect(String(fetch.mock.calls[1]?.[1]?.body)).toContain(encodeURIComponent(activityId))
  })

  it('reads and lists receipts by most recent update', async () => {
    const secondId = 'https://alice.example/social/outbox/follow-carol'
    const body = `${storedReceipt('failed', 'delivery_failed')}
      @prefix nz: <https://nodezero.social/ns#> .
      <${datasetUrl}#activity-${encodeURIComponent(secondId)}>
        a nz:DeliveryReceipt ; nz:version 1 ; nz:activityId <${secondId}> ;
        nz:senderWebId <${alice}> ; nz:recipientWebId <https://carol.example/profile/card#me> ;
        nz:deliveryStatus "delivered" ; nz:updatedAt "2026-08-02T12:00:00.000Z" .`
    const fetch = jestGlobal.fn().mockImplementation(() => Promise.resolve(responseWithUrl(body)))
    const manager = new DeliveryReceiptManager({ fetch })

    await expect(manager.getDeliveryReceipt('https://alice.example/', activityId))
      .resolves.toEqual(receipt('failed', 'delivery_failed'))
    const listed = await manager.listDeliveryReceipts('https://alice.example/')
    expect(listed.map((item) => item.activityId)).toEqual([secondId, activityId])
  })

  it('updates only owned predicates and removes a receipt idempotently', async () => {
    const customPredicate = 'https://example.test/ns#custom'
    const existing = storedReceipt('pending').replace(
      'nz:deliveryStatus "pending"',
      `nz:deliveryStatus "pending" ; <${customPredicate}> "preserve-me"`
    )
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(responseWithUrl(existing))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(responseWithUrl(storedReceipt('delivered')))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const manager = new DeliveryReceiptManager({ fetch })

    await manager.recordDeliveryReceipt('https://alice.example/', receipt('delivered'))
    expect(String(fetch.mock.calls[1]?.[1]?.body)).not.toContain(customPredicate)
    await manager.removeDeliveryReceipt('https://alice.example/', activityId)
    expect(String(fetch.mock.calls[3]?.[1]?.body)).toContain('DELETE DATA')

    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(new DeliveryReceiptManager({ fetch: missingFetch }).removeDeliveryReceipt(
      'https://alice.example/', activityId
    )).resolves.toBeUndefined()
  })
})
