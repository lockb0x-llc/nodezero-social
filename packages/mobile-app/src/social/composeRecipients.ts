import type { AudienceType } from './composeAudience'

/**
 * Resolves recipients for compose audiences.
 *
 * Current contract deliberately preserves existing broadcast behavior:
 * - Directory membership alone has no effect.
 * - Trust Circle mode targets trust-circle members.
 */
export function resolveAudienceRecipients(args: {
  audience: AudienceType
  connections: string[]
  trustCircleMembers: string[]
}): string[] {
  const { audience, connections, trustCircleMembers } = args

  if (audience === 'foaf' || audience === 'verified') {
    return Array.from(new Set(connections))
  }

  if (audience === 'trust-circle') {
    return Array.from(new Set(trustCircleMembers))
  }

  return []
}
