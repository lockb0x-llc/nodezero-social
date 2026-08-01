import { ProcessedActivityManager } from '../ProcessedActivityManager.js'

const jestGlobal = import.meta.jest
const activityId = 'https://alice.example/social/outbox/follow-bob'
const actorWebId = 'https://alice.example/profile/card#me'
const processedAt = '2026-08-01T12:00:00.000Z'
const expiresAt = '2026-08-08T12:00:00.000Z'

function responseWithUrl(body: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
  Object.defineProperty(response, 'url', {
    value: 'https://bob.example/social/processed-activities/index',
  })
  return response
}

describe('ProcessedActivityManager', () => {
  it('records and reads a processed activity', async () => {
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
    const manager = new ProcessedActivityManager({ fetch })
    const record = { version: 1 as const, activityId, actorWebId, processedAt, expiresAt }

    await expect(manager.recordProcessedActivity('https://bob.example/', record)).resolves.toEqual(record)
    expect(String(fetch.mock.calls[1]?.[1]?.body ?? '')).toContain(encodeURIComponent(activityId))
  })

  it('distinguishes active replay records from expired records', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://bob.example/social/processed-activities/index#activity-${encodeURIComponent(activityId)}>
        a nz:ProcessedActivity ; nz:version 1 ; nz:activityId <${activityId}> ;
        nz:actorWebId <${actorWebId}> ; nz:processedAt "${processedAt}" ;
        nz:expiresAt "${expiresAt}" .
    `
    const fetch = jestGlobal.fn().mockImplementation(() => Promise.resolve(responseWithUrl(body)))
    const manager = new ProcessedActivityManager({ fetch })

    await expect(manager.hasProcessedActivity(
      'https://bob.example/', activityId, new Date('2026-08-02T00:00:00.000Z')
    )).resolves.toBe(true)
    await expect(manager.hasProcessedActivity(
      'https://bob.example/', activityId, new Date('2026-08-09T00:00:00.000Z')
    )).resolves.toBe(false)
  })

  it('removes replay records idempotently', async () => {
    const body = `
      @prefix nz: <https://nodezero.social/ns#> .
      <https://bob.example/social/processed-activities/index#activity-${encodeURIComponent(activityId)}>
        a nz:ProcessedActivity ; nz:version 1 ; nz:activityId <${activityId}> ;
        nz:actorWebId <${actorWebId}> ; nz:processedAt "${processedAt}" ;
        nz:expiresAt "${expiresAt}" .
    `
    const fetch = jestGlobal
      .fn()
      .mockResolvedValueOnce(responseWithUrl(body))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    await new ProcessedActivityManager({ fetch }).removeProcessedActivity(
      'https://bob.example/', activityId
    )
    expect(String(fetch.mock.calls[1]?.[1]?.body ?? '')).toContain('DELETE DATA')

    const missingFetch = jestGlobal.fn().mockResolvedValue(new Response('', { status: 404 }))
    await expect(new ProcessedActivityManager({ fetch: missingFetch }).removeProcessedActivity(
      'https://bob.example/', activityId
    )).resolves.toBeUndefined()
  })
})
