import { ProfileManager, type UserProfile } from '@nodezero/solid-pod-sync'
import {
  createCredentialFreePublicFetch,
  type PublicResourceFetcherOptions,
} from './publicResourceFetcher.js'

export interface PublicPeerProfileResult {
  webId: string
  profile: UserProfile | null
  authenticated: false
}

export interface PublicPeerProfileOptions {
  publicFetch?: typeof globalThis.fetch
  fetchOptions?: PublicResourceFetcherOptions
}

export class PublicPeerProfileError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'PublicPeerProfileError'
  }
}

export async function readPublicPeerProfile(
  webId: string,
  options: PublicPeerProfileOptions = {}
): Promise<PublicPeerProfileResult> {
  const normalizedWebId = validateWebId(webId)
  const publicFetch = options.publicFetch ?? createCredentialFreePublicFetch(options.fetchOptions)
  try {
    const profile = await new ProfileManager({ fetch: publicFetch }).readProfile(normalizedWebId)
    return { webId: normalizedWebId, profile, authenticated: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Public peer profile lookup failed.'
    throw new PublicPeerProfileError(message, 'public_profile_unavailable')
  }
}

function validateWebId(webId: string): string {
  try {
    const parsed = new URL(webId)
    if (parsed.protocol !== 'https:' || parsed.hash.length <= 1) throw new Error()
    return parsed.toString()
  } catch {
    throw new PublicPeerProfileError(
      'webId must be an absolute https WebID with a fragment.',
      'invalid_webid'
    )
  }
}
