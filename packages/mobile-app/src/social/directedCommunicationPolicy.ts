import type { ModerationRecord, RelationshipRecord } from '@nodezero/solid-pod-sync'

export function canReceiveDirectedCommunication(
  senderWebId: string,
  ownerWebId: string,
  relationships: RelationshipRecord[],
  moderation: ModerationRecord[]
): boolean {
  if (!senderWebId || senderWebId === ownerWebId) return false
  const accepted = relationships.some(
    (record) => record.peerWebId === senderWebId && record.state === 'accepted'
  )
  const blocked = moderation.some(
    (record) => record.subjectWebId === senderWebId && record.action === 'block'
  )
  return accepted && !blocked
}
