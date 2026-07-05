import { DocustreamManager, type DocustreamManagerOptions } from './DocustreamManager.js'
import {
  DocustreamSourceManager,
  type DocustreamSourceManagerOptions,
} from './DocustreamSourceManager.js'
import { ProfileManager, type ProfileManagerOptions } from './ProfileManager.js'
import { SocialGraph, type SocialGraphOptions } from './SocialGraph.js'
import { NsfwScanner } from './NsfwScanner.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface SolidPodSyncManagers {
  profileManager: ProfileManager
  socialGraph: SocialGraph
  docustreamManager: DocustreamManager
  docustreamSourceManager: DocustreamSourceManager
  podLayoutManager: Pick<PodLayoutManager, 'ensureDefaultLayoutAndPolicies'>
}

export interface SolidPodSyncFactoryOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: Pick<PodLayoutManager, 'ensureDefaultLayoutAndPolicies'>
  nsfwScanner?: NsfwScanner
}

export function createSolidPodSyncManagers(
  session: AuthenticatedSession,
  options: SolidPodSyncFactoryOptions = {}
): SolidPodSyncManagers {
  const podLayoutManager =
    options.podLayoutManager ?? new PodLayoutManager({ fetch: session.fetch })

  const sharedBootstrapOptions: Pick<
    DocustreamManagerOptions & ProfileManagerOptions & SocialGraphOptions & DocustreamSourceManagerOptions,
    'enablePodBootstrap' | 'policyMatrix' | 'podLayoutManager'
  > = {
    enablePodBootstrap: options.enablePodBootstrap ?? false,
    policyMatrix: options.policyMatrix ?? DEFAULT_POLICY_MATRIX,
    podLayoutManager,
  }

  return {
    profileManager: new ProfileManager(
      session,
      options.nsfwScanner,
      sharedBootstrapOptions
    ),
    socialGraph: new SocialGraph(session, sharedBootstrapOptions),
    docustreamManager: new DocustreamManager(session, sharedBootstrapOptions),
    docustreamSourceManager: new DocustreamSourceManager(session, sharedBootstrapOptions),
    podLayoutManager,
  }
}
