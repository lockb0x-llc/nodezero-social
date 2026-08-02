import type { RelationshipState } from '@nodezero/solid-pod-sync'

export interface PersonActionPolicyInput {
  isSelf: boolean
  relationshipState: RelationshipState | null
  blocked: boolean
  muted?: boolean
  reported?: boolean
  inTrustCircle: boolean
  mutuallyRevealed?: boolean
}

export interface PersonActionPolicy {
  canRequest: boolean
  canCancelRequest: boolean
  canAcceptRequest: boolean
  canDeclineRequest: boolean
  canDisconnect: boolean
  canMessage: boolean
  canAddTrustCircle: boolean
  canRemoveTrustCircle: boolean
  canBlock: boolean
  canMute: boolean
  canUnmute: boolean
  canReport: boolean
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
    canAcceptRequest: state === 'incoming-pending',
    canDeclineRequest: state === 'incoming-pending',
    canDisconnect: accepted || state === 'legacy-connected',
    canMessage: accepted,
    canAddTrustCircle: accepted && !input.inTrustCircle,
    canRemoveTrustCircle: accepted && input.inTrustCircle,
    canBlock: true,
    canMute: !input.muted,
    canUnmute: input.muted === true,
    canReport: !input.reported,
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
    canAcceptRequest: false,
    canDeclineRequest: false,
    canDisconnect: false,
    canMessage: false,
    canAddTrustCircle: false,
    canRemoveTrustCircle: false,
    canBlock: false,
    canMute: false,
    canUnmute: false,
    canReport: false,
    reason,
  }
}
