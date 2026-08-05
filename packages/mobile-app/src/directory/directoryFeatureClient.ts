export interface DirectoryFeatureAvailability {
  directory: boolean
  peerProfile: boolean
  relationship: boolean
  transport: boolean
}

export const NO_DIRECTORY_FEATURES: DirectoryFeatureAvailability = Object.freeze({
  directory: false,
  peerProfile: false,
  relationship: false,
  transport: false,
})

export async function readDirectoryFeatureAvailability(
  provisionerUrl: string,
  authFetch: typeof globalThis.fetch
): Promise<DirectoryFeatureAvailability> {
  const baseUrl = provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) return NO_DIRECTORY_FEATURES
  try {
    const response = await authFetch(`${baseUrl}/v1/milestone-q/features`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return NO_DIRECTORY_FEATURES
    const payload = (await response.json()) as { version?: unknown; features?: unknown }
    if (payload.version !== 1 || !payload.features || typeof payload.features !== 'object') {
      return NO_DIRECTORY_FEATURES
    }
    const features = payload.features as Record<string, unknown>
    if (
      typeof features.directory !== 'boolean' ||
      typeof features.peerProfile !== 'boolean' ||
      typeof features.relationship !== 'boolean' ||
      typeof features.transport !== 'boolean'
    ) {
      return NO_DIRECTORY_FEATURES
    }
    return {
      directory: features.directory,
      peerProfile: features.peerProfile,
      relationship: features.relationship,
      transport: features.transport,
    }
  } catch {
    return NO_DIRECTORY_FEATURES
  }
}
