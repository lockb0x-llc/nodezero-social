import { LegacyRelationshipMigrator } from '../LegacyRelationshipMigrator.js'
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
