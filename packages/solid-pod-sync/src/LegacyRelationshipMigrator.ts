import type { RelationshipRecord } from './contracts/ConsentfulDiscoveryContract.js'
import type { RelationshipManager } from './RelationshipManager.js'
import type { SocialGraph } from './SocialGraph.js'

interface LegacyConnectionSource {
  listConnections: SocialGraph['listConnections']
}

interface LegacyRelationshipStore {
  importLegacyConnection: RelationshipManager['importLegacyConnection']
}

export interface LegacyRelationshipMigrationResult {
  scanned: number
  records: RelationshipRecord[]
}

/** Imports old `foaf:knows` links as compatibility state without inferring consent. */
export class LegacyRelationshipMigrator {
  constructor(
    private readonly socialGraph: LegacyConnectionSource,
    private readonly relationships: LegacyRelationshipStore
  ) {}

  async migrate(
    podRoot: string,
    updatedAt = new Date().toISOString()
  ): Promise<LegacyRelationshipMigrationResult> {
    const connections = await this.socialGraph.listConnections(podRoot)
    const records: RelationshipRecord[] = []
    for (const connection of connections) {
      records.push(
        await this.relationships.importLegacyConnection(podRoot, connection.webId, updatedAt)
      )
    }
    return { scanned: connections.length, records }
  }
}
