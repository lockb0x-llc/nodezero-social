import type { UserProfile } from '@nodezero/solid-pod-sync'

interface PublicPeerProfilePayload {
  webId?: unknown
  profile?: unknown
  authenticated?: unknown
}

export async function readPublicPeerProfile(
  provisionerUrl: string,
  webId: string,
  authFetch: typeof globalThis.fetch
): Promise<UserProfile | null> {
  const baseUrl = provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Provisioner URL is required for peer profile reads.')

  const response = await authFetch(`${baseUrl}/v1/public-profile/read`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ webId }),
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error('Unable to load public peer profile.')

  const payload = (await response.json()) as PublicPeerProfilePayload
  if (payload.webId !== webId || payload.authenticated !== false) {
    throw new Error('Invalid public peer profile response.')
  }
  return parseUserProfile(payload.profile)
}

export function findPublicInterestOverlap(
  ownerInterests: string[],
  peerInterests: string[]
): string[] {
  const peerValues = new Set(peerInterests.map((value) => value.trim().toLowerCase()).filter(Boolean))
  return ownerInterests.filter((value, index, all) => {
    const normalized = value.trim().toLowerCase()
    return normalized.length > 0 &&
      peerValues.has(normalized) &&
      all.findIndex((candidate) => candidate.trim().toLowerCase() === normalized) === index
  })
}

function parseUserProfile(value: unknown): UserProfile | null {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Invalid public peer profile response.')
  const record = value as Record<string, unknown>
  if (
    typeof record.displayName !== 'string' ||
    typeof record.bio !== 'string' ||
    !Array.isArray(record.interests) ||
    !record.interests.every((interest) => typeof interest === 'string') ||
    typeof record.isNsfw !== 'boolean'
  ) {
    throw new Error('Invalid public peer profile response.')
  }
  return {
    displayName: record.displayName,
    bio: record.bio,
    ...(typeof record.avatarUrl === 'string' ? { avatarUrl: record.avatarUrl } : {}),
    ...(typeof record.externalUrl === 'string' ? { externalUrl: record.externalUrl } : {}),
    interests: record.interests,
    isNsfw: record.isNsfw,
  }
}
