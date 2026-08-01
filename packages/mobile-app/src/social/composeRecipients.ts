import type { AudienceType } from './composeAudience'

/**
 * Resolves recipients for compose audiences.
 *
 * Directory, legacy FOAF, and Trust Circle membership are never communication
 * authority. Every explicit recipient must be accepted and unblocked.
 */
export function resolveAudienceRecipients(args: {
  audience: AudienceType
  acceptedRelationships: string[]
  trustCircleMembers: string[]
  blockedWebIds: string[]
}): string[] {
  const accepted = new Set(args.acceptedRelationships)
  const blocked = new Set(args.blockedWebIds)
  const eligible = (webIds: string[]): string[] =>
    Array.from(new Set(webIds)).filter((webId) => accepted.has(webId) && !blocked.has(webId))

  if (args.audience === 'foaf' || args.audience === 'verified') {
    return eligible(args.acceptedRelationships)
  }

  if (args.audience === 'trust-circle') {
    return eligible(args.trustCircleMembers)
  }

  return []
}
