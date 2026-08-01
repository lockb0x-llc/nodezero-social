import { RelationshipFoafProjector } from '../RelationshipFoafProjector.js'
import type { RelationshipRecord, RelationshipState } from '../contracts/ConsentfulDiscoveryContract.js'

const jestGlobal = import.meta.jest
const alice = 'https://alice.example/profile/card#me'
const bob = 'https://bob.example/profile/card#me'

function relationship(state: RelationshipState): RelationshipRecord {
  return {
    version: 1,
    ownerWebId: alice,
    peerWebId: bob,
    state,
    updatedAt: '2026-08-01T12:00:00.000Z',
  }
}

describe('RelationshipFoafProjector', () => {
  it('adds a compatibility link for accepted relationships', async () => {
    const addConnection = jestGlobal.fn().mockResolvedValue('https://alice.example/social/connections')
    const removeConnection = jestGlobal.fn()
    const projector = new RelationshipFoafProjector({ addConnection, removeConnection })

    await expect(projector.project('https://alice.example/', relationship('accepted')))
      .resolves.toEqual({ action: 'added', peerWebId: bob })
    expect(addConnection).toHaveBeenCalledWith('https://alice.example/', bob)
    expect(removeConnection).not.toHaveBeenCalled()
  })

  it('removes a compatibility link for disconnected relationships', async () => {
    const addConnection = jestGlobal.fn()
    const removeConnection = jestGlobal.fn().mockResolvedValue('https://alice.example/social/connections')
    const projector = new RelationshipFoafProjector({ addConnection, removeConnection })

    await expect(projector.project('https://alice.example/', relationship('disconnected')))
      .resolves.toEqual({ action: 'removed', peerWebId: bob })
    expect(removeConnection).toHaveBeenCalledWith('https://alice.example/', bob)
    expect(addConnection).not.toHaveBeenCalled()
  })

  it.each<RelationshipState>([
    'outgoing-pending',
    'incoming-pending',
    'rejected',
    'cancelled',
    'legacy-connected',
  ])('does not infer compatibility changes from %s state', async (state) => {
    const addConnection = jestGlobal.fn()
    const removeConnection = jestGlobal.fn()
    const projector = new RelationshipFoafProjector({ addConnection, removeConnection })

    await expect(projector.project('https://alice.example/', relationship(state)))
      .resolves.toEqual({ action: 'unchanged', peerWebId: bob })
    expect(addConnection).not.toHaveBeenCalled()
    expect(removeConnection).not.toHaveBeenCalled()
  })
})
