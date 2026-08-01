import type { RelationshipRecord } from './contracts/ConsentfulDiscoveryContract.js'
import type { SocialGraph } from './SocialGraph.js'

interface FoafProjectionStore {
  addConnection: SocialGraph['addConnection']
  removeConnection: SocialGraph['removeConnection']
}

export interface RelationshipFoafProjectionResult {
  action: 'added' | 'removed' | 'unchanged'
  peerWebId: string
}

/**
 * Projects authoritative relationship state into legacy `foaf:knows` data.
 * The projection is write-only compatibility output and is never consent input.
 */
export class RelationshipFoafProjector {
  constructor(private readonly socialGraph: FoafProjectionStore) {}

  async project(
    podRoot: string,
    relationship: RelationshipRecord
  ): Promise<RelationshipFoafProjectionResult> {
    if (relationship.state === 'accepted') {
      await this.socialGraph.addConnection(podRoot, relationship.peerWebId)
      return { action: 'added', peerWebId: relationship.peerWebId }
    }
    if (relationship.state === 'disconnected') {
      await this.socialGraph.removeConnection(podRoot, relationship.peerWebId)
      return { action: 'removed', peerWebId: relationship.peerWebId }
    }
    return { action: 'unchanged', peerWebId: relationship.peerWebId }
  }
}
