export type DirectoryBadgeKind = 'default' | 'verified'

export interface DirectoryBadge {
  label: string
  kind: DirectoryBadgeKind
}

export function buildDirectoryBadges(args: {
  isSelf: boolean
  isConnected: boolean
  isVerified: boolean
  inTrustCircle: boolean
}): DirectoryBadge[] {
  const badges: DirectoryBadge[] = []

  if (args.isSelf) badges.push({ label: 'You', kind: 'default' })
  if (args.isConnected) badges.push({ label: 'Connected', kind: 'default' })
  if (args.isVerified) badges.push({ label: 'Verified', kind: 'verified' })
  if (args.inTrustCircle) badges.push({ label: 'In Trust Circle', kind: 'default' })

  return badges
}
