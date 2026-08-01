import { LegacyRelationshipMigrator } from '../LegacyRelationshipMigrator.js'
import { RelationshipManager } from '../RelationshipManager.js'
import { SocialGraph } from '../SocialGraph.js'
import type { RelationshipRecord } from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'
const carol = 'https://carol.example/profile/card#me'
const updatedAt = '2026-08-01T12:00:00.000Z'

describe('LegacyRelationshipMigrator', () => {
  it('imports each foaf:knows link through legacy-compatible relationship state', async () => {
    const listConnections = jestGlobal.fn().mockResolvedValue([{ webId: bob }, { webId: carol }])
    const importLegacyConnection = jestGlobal.fn().mockImplementation(
      (_podRoot: string, peerWebId: string): Promise<RelationshipRecord> => Promise.resolve({
        version: 1,
        ownerWebId: alice,
        peerWebId,
        state: 'legacy-connected',
        updatedAt,
      })
    )
    const migrator = new LegacyRelationshipMigrator(
      { listConnections },
      { importLegacyConnection }
    )

    const result = await migrator.migrate('https://alice.example/', updatedAt)

    expect(result.scanned).toBe(2)
    expect(result.records.map((record) => record.state)).toEqual([
      'legacy-connected',
      'legacy-connected',
    ])
    expect(importLegacyConnection).toHaveBeenNthCalledWith(
      1,
      'https://alice.example/',
      bob,
      updatedAt
    )
    expect(importLegacyConnection).toHaveBeenNthCalledWith(
      2,
      'https://alice.example/',
      carol,
      updatedAt
    )
  })

  it('runs the complete legacy migration twice without fabricating acceptance history', async () => {
    const connectionsUrl = 'https://alice.example/social/connections'
    const relationshipsUrl = 'https://alice.example/social/relationships/index'
    const connectionsBody = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${alice}> a foaf:Person ; foaf:knows <${bob}> .
    `
    const relationshipBody = `
      @prefix nz: <https://nodezero.social/ns#> .
      <${relationshipsUrl}#peer-${encodeURIComponent(bob)}>
        a nz:Relationship ; nz:version 1 ; nz:ownerWebId <${alice}> ;
        nz:peerWebId <${bob}> ; nz:relationshipState "legacy-connected" ;
        nz:updatedAt "${updatedAt}" .
    `
    const response = (body: string, url: string): Response => {
      const result = new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      })
      Object.defineProperty(result, 'url', { value: url })
      return result
    }
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(response(connectionsBody, connectionsUrl))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(response(connectionsBody, connectionsUrl))
      .mockResolvedValueOnce(response(relationshipBody, relationshipsUrl))
    const migrator = new LegacyRelationshipMigrator(
      new SocialGraph({ fetch }),
      new RelationshipManager({ fetch })
    )

    const first = await migrator.migrate('https://alice.example/', updatedAt)
    const second = await migrator.migrate('https://alice.example/', updatedAt)

    expect(second).toEqual(first)
    expect(second.records[0]?.state).toBe('legacy-connected')
    expect(second.records[0]).not.toHaveProperty('activityId')
    expect(fetch).toHaveBeenCalledTimes(7)
    expect(String(fetch.mock.calls[4]?.[1]?.body)).toContain('legacy-connected')
  })

  it('is a no-op for an empty legacy graph', async () => {
    const importLegacyConnection = jestGlobal.fn()
    const migrator = new LegacyRelationshipMigrator(
      { listConnections: jestGlobal.fn().mockResolvedValue([]) },
      { importLegacyConnection }
    )

    await expect(migrator.migrate('https://alice.example/', updatedAt))
      .resolves.toEqual({ scanned: 0, records: [] })
    expect(importLegacyConnection).not.toHaveBeenCalled()
  })
})
