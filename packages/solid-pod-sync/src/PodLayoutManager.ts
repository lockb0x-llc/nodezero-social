/**
 * Layer 2 Pod persistence + policy manager.
 *
 * Provides deterministic container bootstrap and idempotent ACL application
 * for Data Backpack / DocuStream / Social Graph storage paths.
 */

interface AuthenticatedSession {
  fetch: typeof globalThis.fetch
}

export interface PodContainerLayout {
  docustreamContainer: string
  socialContainer: string
  backpackContainer: string
}

export type ContainerVisibility = 'public-read' | 'private'

export interface PodPolicyMatrix {
  docustream: ContainerVisibility
  social: ContainerVisibility
  backpack: ContainerVisibility
}

export const DEFAULT_POLICY_MATRIX: PodPolicyMatrix = {
  docustream: 'public-read',
  social: 'private',
  backpack: 'private',
}

export function buildPodContainerLayout(podRoot: string): PodContainerLayout {
  const base = podRoot.replace(/\/$/, '')
  return {
    docustreamContainer: `${base}/public/docustream/`,
    socialContainer: `${base}/social/`,
    backpackContainer: `${base}/backpack/`,
  }
}

export function deriveOwnerWebId(containerPath: string): string {
  try {
    const containerUrl = new URL(containerPath)
    return `${containerUrl.origin}/profile/card#me`
  } catch {
    return 'https://vocab.nodezero.social/profile/card#me'
  }
}

export function buildAclDocument(
  containerPath: string,
  visibility: ContainerVisibility,
  ownerWebId = deriveOwnerWebId(containerPath)
): string {
  const ownerBlock = `
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agent <${ownerWebId}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`.trim()

  if (visibility === 'private') {
    return `${ownerBlock}\n`
  }

  const publicBlock = `

<#public>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agentClass foaf:Agent ;
    acl:mode acl:Read .`

  return `${ownerBlock}${publicBlock}\n`
}

export class PodLayoutManager {
  constructor(private readonly session: AuthenticatedSession) {}

  async ensureDefaultLayout(podRoot: string): Promise<PodContainerLayout> {
    const layout = buildPodContainerLayout(podRoot)

    await this.ensureContainer(layout.docustreamContainer)
    await this.ensureContainer(layout.socialContainer)
    await this.ensureContainer(layout.backpackContainer)

    return layout
  }

  async applyPolicyMatrix(
    podRoot: string,
    policyMatrix: PodPolicyMatrix = DEFAULT_POLICY_MATRIX
  ): Promise<PodContainerLayout> {
    const layout = buildPodContainerLayout(podRoot)

    await this.ensureAcl(layout.docustreamContainer, policyMatrix.docustream)
    await this.ensureAcl(layout.socialContainer, policyMatrix.social)
    await this.ensureAcl(layout.backpackContainer, policyMatrix.backpack)

    return layout
  }

  async ensureDefaultLayoutAndPolicies(
    podRoot: string,
    policyMatrix: PodPolicyMatrix = DEFAULT_POLICY_MATRIX
  ): Promise<PodContainerLayout> {
    const layout = await this.ensureDefaultLayout(podRoot)
    await this.applyPolicyMatrix(podRoot, policyMatrix)
    return layout
  }

  private async ensureContainer(containerUrl: string): Promise<void> {
    const head = await this.session.fetch(containerUrl, { method: 'HEAD' })

    if (head.ok) return

    if (head.status !== 404) {
      throw new Error(`Unable to check container ${containerUrl}: HTTP ${head.status}`)
    }

    const create = await this.session.fetch(containerUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/turtle',
        Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      },
      body: '',
    })

    if (!create.ok) {
      throw new Error(`Unable to create container ${containerUrl}: HTTP ${create.status}`)
    }
  }

  private async ensureAcl(containerPath: string, visibility: ContainerVisibility): Promise<void> {
    const aclUrl = `${containerPath.replace(/\/$/, '')}/.acl`
    const desiredAcl = buildAclDocument(containerPath, visibility)

    const current = await this.session.fetch(aclUrl, {
      method: 'GET',
      headers: { Accept: 'text/turtle' },
    })

    if (current.ok) {
      const currentBody = await current.text()
      if (currentBody === desiredAcl) return
    }

    const update = await this.session.fetch(aclUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle' },
      body: desiredAcl,
    })

    if (!update.ok) {
      throw new Error(`Unable to update ACL ${aclUrl}: HTTP ${update.status}`)
    }
  }
}
