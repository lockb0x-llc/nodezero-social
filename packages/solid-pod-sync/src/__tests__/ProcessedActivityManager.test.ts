import { ProcessedActivityManager } from '../ProcessedActivityManager.js'

const jestGlobal = import.meta.jest
const activityId = 'https://alice.example/social/outbox/follow-bob'
const actorWebId = 'https://alice.example/profile/card#me'
const processedAt = '2026-08-01T12:00:00.000Z'
const expiresAt = '2026-08-08T12:00:00.000Z'

function responseWithUrl(body: string): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle', etag: '"reservation-v1"' },
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

  it('atomically reserves, commits, and releases per-activity replay records', async () => {
    const record = { version: 1 as const, activityId, actorWebId, processedAt, expiresAt }
    const reservationBody = `
      @prefix nz: <https://nodezero.social/ns#> .
      <#activity> a nz:ProcessedActivity ; nz:version 1 ;
        nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
        nz:processingState "reserved" ;
        nz:processedAt "${processedAt}" ; nz:expiresAt "${expiresAt}" .
    `
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(responseWithUrl(reservationBody))
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(responseWithUrl(`
        @prefix nz: <https://nodezero.social/ns#> .
        <#activity> a nz:ProcessedActivity ; nz:version 1 ;
          nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
          nz:processingState "processed" ;
          nz:processedAt "${processedAt}" ; nz:expiresAt "${expiresAt}" .
      `))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const manager = new ProcessedActivityManager({ fetch })

    const lease = { activityId, etag: '"reservation-v1"' }
    await expect(manager.reserveProcessedActivity('https://bob.example/', record))
      .resolves.toEqual({ status: 'acquired', lease })
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'If-None-Match': '*' })
    await expect(manager.reserveProcessedActivity('https://bob.example/', record))
      .resolves.toEqual({ status: 'duplicate' })
    await expect(manager.commitProcessedActivity('https://bob.example/', record, lease))
      .resolves.toEqual(record)
    expect(fetch.mock.calls[4]?.[1]?.headers).toMatchObject({ 'If-Match': lease.etag })
    await expect(manager.releaseProcessedActivity('https://bob.example/', lease))
      .resolves.toBeUndefined()
    expect(fetch.mock.calls[5]?.[1]?.headers).toMatchObject({ 'If-Match': lease.etag })
  })

  it('reclaims an expired replay reservation and retries conditional creation once', async () => {
    const expiredAt = '2026-08-01T12:05:00.000Z'
    const record = {
      version: 1 as const,
      activityId,
      actorWebId,
      processedAt,
      expiresAt: '2026-08-01T12:20:00.000Z',
    }
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(responseWithUrl(`
        @prefix nz: <https://nodezero.social/ns#> .
        <#activity> a nz:ProcessedActivity ; nz:version 1 ;
          nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
          nz:processingState "reserved" ;
          nz:processedAt "${processedAt}" ; nz:expiresAt "${expiredAt}" .
      `))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(responseWithUrl(`
        @prefix nz: <https://nodezero.social/ns#> .
        <#activity> a nz:ProcessedActivity ; nz:version 1 ;
          nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
          nz:processingState "reserved" ;
          nz:processedAt "${processedAt}" ; nz:expiresAt "${record.expiresAt}" .
      `))

    await expect(new ProcessedActivityManager({ fetch }).reserveProcessedActivity(
      'https://bob.example/',
      record,
      new Date('2026-08-01T12:10:00.000Z')
    )).resolves.toEqual({
      status: 'acquired',
      lease: { activityId, etag: '"reservation-v1"' },
    })
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'If-Match': '"reservation-v1"' },
    })
    expect(fetch.mock.calls[3]?.[1]?.headers).toMatchObject({ 'If-None-Match': '*' })
  })

  it('does not delete a replacement reservation when stale reclamation loses the ETag race', async () => {
    const record = {
      version: 1 as const,
      activityId,
      actorWebId,
      processedAt,
      expiresAt: '2026-08-01T12:20:00.000Z',
    }
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(responseWithUrl(`
        @prefix nz: <https://nodezero.social/ns#> .
        <#activity> a nz:ProcessedActivity ; nz:version 1 ;
          nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
          nz:processingState "reserved" ;
          nz:processedAt "${processedAt}" ; nz:expiresAt "2026-08-01T12:05:00.000Z" .
      `))
      .mockResolvedValueOnce(new Response('', { status: 412 }))

    await expect(new ProcessedActivityManager({ fetch }).reserveProcessedActivity(
      'https://bob.example/',
      record,
      new Date('2026-08-01T12:10:00.000Z')
    )).resolves.toEqual({ status: 'in-progress' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects a replay key already bound to another actor', async () => {
    const mallory = 'https://mallory.example/profile/card#me'
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response('', { status: 412 }))
      .mockResolvedValueOnce(responseWithUrl(`
        @prefix nz: <https://nodezero.social/ns#> .
        <#activity> a nz:ProcessedActivity ; nz:version 1 ;
          nz:activityId <${activityId}> ; nz:actorWebId <${actorWebId}> ;
          nz:processingState "processed" ;
          nz:processedAt "${processedAt}" ; nz:expiresAt "${expiresAt}" .
      `))

    await expect(new ProcessedActivityManager({ fetch }).reserveProcessedActivity(
      'https://bob.example/',
      { version: 1, activityId, actorWebId: mallory, processedAt, expiresAt }
    )).resolves.toEqual({ status: 'actor-mismatch' })
  })
})
