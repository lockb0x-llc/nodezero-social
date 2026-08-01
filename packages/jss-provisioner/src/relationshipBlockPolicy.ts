import { ModerationManager } from '@nodezero/solid-pod-sync'
import type { CredentialStore } from './credentialStore.js'
import type { SessionClaims } from './sessionTokens.js'
import { mintPodAccessToken, type PodAccessToken } from './solidAccount.js'

export interface RelationshipBlockPolicyOptions {
  cssBaseUrl: string
  credentialStore: Pick<CredentialStore, 'findByWebId'>
  mintToken?: typeof mintPodAccessToken
}

export async function isRelationshipRecipientBlocked(
  claims: SessionClaims,
  recipientWebId: string,
  options: RelationshipBlockPolicyOptions
): Promise<boolean> {
  const cssBase = new URL(options.cssBaseUrl)
  const podRoot = new URL(claims.pod)
  if (cssBase.origin !== podRoot.origin) {
    throw new Error('Session Pod origin does not match the configured Pod server.')
  }
  const credentials = await options.credentialStore.findByWebId(claims.sub)
  if (!credentials) throw new Error('Session Pod credentials are unavailable.')
  const mintToken = options.mintToken ?? mintPodAccessToken
  const token = await mintToken(options.cssBaseUrl, {
    id: credentials.clientCredentialsId,
    secret: credentials.clientCredentialsSecret,
  })
  const manager = new ModerationManager({ fetch: createPodPolicyFetch(token, podRoot) })
  return manager.isBlocked(podRoot.toString(), recipientWebId)
}

function createPodPolicyFetch(token: PodAccessToken, podRoot: URL): typeof globalThis.fetch {
  return async (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url)
    if (target.origin !== podRoot.origin || !target.pathname.startsWith(podRoot.pathname)) {
      throw new Error('Moderation policy read escaped the authenticated Pod namespace.')
    }
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'GET') throw new Error('Moderation policy fetch is read-only.')
    const headers = new Headers(init?.headers)
    headers.set('authorization', `DPoP ${token.accessToken}`)
    headers.set('dpop', token.proof(target.toString(), method))
    return fetch(target, { ...init, method, headers })
  }
}
