export type BackpackPermissionKey = 'profile' | 'interests' | 'location'

export const BACKPACK_CONTAINER_PATHS: Record<BackpackPermissionKey, string> = {
  profile: 'profile/',
  interests: 'interests/',
  location: 'location/',
}

export function resolvePodRootFromSession(podUrl: string | null, webId: string | null): string | null {
  if (podUrl && podUrl.trim().length > 0) return podUrl.trim()
  if (webId && webId.includes('/profile/')) {
    return `${webId.split('/profile/')[0]}/`
  }
  return null
}

export function resolveAclContainerUrl(
  key: BackpackPermissionKey,
  podUrl: string | null,
  webId: string | null,
): string | null {
  const podRoot = resolvePodRootFromSession(podUrl, webId)
  if (!podRoot) return null
  return new URL(BACKPACK_CONTAINER_PATHS[key], podRoot).toString()
}
