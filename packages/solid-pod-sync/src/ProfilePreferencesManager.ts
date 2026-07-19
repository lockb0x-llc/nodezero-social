import {
  assertValidPrivateProfilePreferencesDocument,
  type PrivateProfilePreferencesDocument,
} from './contracts/DataBackpackContract.js'
import {
  DEFAULT_POLICY_MATRIX,
  PodLayoutManager,
  type PodPolicyMatrix,
} from './PodLayoutManager.js'

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface ProfilePreferencesManagerOptions {
  enablePodBootstrap?: boolean
  policyMatrix?: PodPolicyMatrix
  podLayoutManager?: {
    ensureDefaultLayoutAndPolicies: PodLayoutManager['ensureDefaultLayoutAndPolicies']
  }
}

export interface ProfilePreferencesWriteOptions {
  datasetPath?: string
}

function defaultPreferencesUrl(podRoot: string, datasetPath = 'backpack/preferences/profile.json'): string {
  const base = podRoot.replace(/\/$/, '')
  return `${base}/${datasetPath}`
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class ProfilePreferencesManager {
  constructor(
    private readonly session: AuthenticatedSession,
    private readonly options: ProfilePreferencesManagerOptions = {}
  ) {}

  async readPreferences(
    podRoot: string,
    options: ProfilePreferencesWriteOptions = {}
  ): Promise<PrivateProfilePreferencesDocument | null> {
    const url = defaultPreferencesUrl(podRoot, options.datasetPath)

    const response = await this.session.fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to read profile preferences at ${url}: HTTP ${response.status}`)
    }

    const parsed = parseJson<PrivateProfilePreferencesDocument>(await response.text())
    if (!parsed) {
      throw new Error(`Invalid JSON payload for profile preferences at ${url}`)
    }

    assertValidPrivateProfilePreferencesDocument(parsed)
    return parsed
  }

  async writePreferences(
    podRoot: string,
    preferences: PrivateProfilePreferencesDocument,
    options: ProfilePreferencesWriteOptions = {}
  ): Promise<string> {
    await this.ensurePodLayoutIfEnabled(podRoot)
    assertValidPrivateProfilePreferencesDocument(preferences)

    const url = defaultPreferencesUrl(podRoot, options.datasetPath)
    const response = await this.session.fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences, null, 2),
    })

    if (!response.ok) {
      throw new Error(`Failed to write profile preferences at ${url}: HTTP ${response.status}`)
    }

    return url
  }

  private async ensurePodLayoutIfEnabled(podRoot: string): Promise<void> {
    if (!this.options.enablePodBootstrap) return

    const podLayoutManager =
      this.options.podLayoutManager ?? new PodLayoutManager({ fetch: this.session.fetch })

    await podLayoutManager.ensureDefaultLayoutAndPolicies(
      podRoot,
      this.options.policyMatrix ?? DEFAULT_POLICY_MATRIX
    )
  }
}
