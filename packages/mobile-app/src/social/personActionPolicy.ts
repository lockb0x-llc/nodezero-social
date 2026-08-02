import type { RelationshipState } from '@nodezero/solid-pod-sync'

export interface PersonActionPolicyInput {
  isSelf: boolean
  relationshipState: RelationshipState | null
  blocked: boolean
  inTrustCircle: boolean
  mutuallyRevealed?: boolean
}

export interface PersonActionPolicy {
  canRequest: boolean
  canCancelRequest: boolean
  canDisconnect: boolean
  canMessage: boolean
  canAddTrustCircle: boolean
  canRemoveTrustCircle: boolean
  canBlock: boolean
  reason: 'self' | 'blocked' | 'accepted' | 'pending' | 'legacy' | 'not-connected'
}

export function derivePersonActionPolicy(input: PersonActionPolicyInput): PersonActionPolicy {
  if (input.isSelf) return disabledPolicy('self')
  if (input.blocked) {
    return {
      ...disabledPolicy('blocked'),
      canBlock: false,
    }
  }

  const state = input.relationshipState
  const accepted = state === 'accepted'
  const pending = state === 'incoming-pending' || state === 'outgoing-pending'
  const requestable = state === null || state === 'none' || [
    'rejected',
    'cancelled',
    'disconnected',
  ].includes(state)
  return {
    canRequest: requestable,
    canCancelRequest: state === 'outgoing-pending',
    canDisconnect: accepted || state === 'legacy-connected',
    canMessage: accepted,
    canAddTrustCircle: accepted && !input.inTrustCircle,
    canRemoveTrustCircle: accepted && input.inTrustCircle,
    canBlock: true,
    reason: accepted
      ? 'accepted'
      : pending
        ? 'pending'
        : state === 'legacy-connected'
          ? 'legacy'
          : 'not-connected',
  }
}

function disabledPolicy(reason: PersonActionPolicy['reason']): PersonActionPolicy {
  return {
    canRequest: false,
    canCancelRequest: false,
    canDisconnect: false,
    canMessage: false,
    canAddTrustCircle: false,
    canRemoveTrustCircle: false,
    canBlock: false,
    reason,
  }
}
