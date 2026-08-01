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
  notificationsContainer: string
  discoveryContainer: string
  socialInboxContainer: string
  socialOutboxContainer: string
  socialQuarantineContainer: string
  socialConsentContainer: string
  relationshipsContainer: string
  moderationContainer: string
  processedActivitiesContainer: string
  deliveryReceiptsContainer: string
}

export const ACL_POLICY_RULES = {
  OWNER_MISMATCH: 'ACL_NS_OWNER_MISMATCH',
  TARGET_MALFORMED: 'ACL_PAYLOAD_MALFORMED',
} as const

export type ContainerVisibility = 'public-read' | 'public-append' | 'private'

export interface PodPolicyMatrix {
  docustream: ContainerVisibility
  social: ContainerVisibility
  backpack: ContainerVisibility
  notifications: ContainerVisibility
  discovery: ContainerVisibility
  socialInbox: ContainerVisibility
  socialOutbox: ContainerVisibility
  socialQuarantine: ContainerVisibility
  socialConsent: ContainerVisibility
  relationships: ContainerVisibility
  moderation: ContainerVisibility
  processedActivities: ContainerVisibility
  deliveryReceipts: ContainerVisibility
}

export const DEFAULT_POLICY_MATRIX: PodPolicyMatrix = {
  docustream: 'public-read',
  social: 'private',
  backpack: 'private',
  notifications: 'private',
  discovery: 'public-read',
  socialInbox: 'public-append',
  socialOutbox: 'private',
  socialQuarantine: 'private',
  socialConsent: 'private',
  relationships: 'private',
  moderation: 'private',
  processedActivities: 'private',
  deliveryReceipts: 'private',
}

export function buildPodContainerLayout(podRoot: string): PodContainerLayout {
  const base = podRoot.replace(/\/$/, '')
  return {
    docustreamContainer: `${base}/public/docustream/`,
    socialContainer: `${base}/social/`,
    backpackContainer: `${base}/backpack/`,
    notificationsContainer: `${base}/backpack/notifications/`,
    discoveryContainer: `${base}/public/discovery/`,
    socialInboxContainer: `${base}/social/inbox/`,
    socialOutboxContainer: `${base}/social/outbox/`,
    socialQuarantineContainer: `${base}/social/quarantine/`,
    socialConsentContainer: `${base}/social/consent/`,
    relationshipsContainer: `${base}/social/relationships/`,
    moderationContainer: `${base}/social/moderation/`,
    processedActivitiesContainer: `${base}/social/processed-activities/`,
    deliveryReceiptsContainer: `${base}/social/delivery-receipts/`,
  }
}

export function deriveOwnerWebId(containerPath: string): string {
  try {
    const containerUrl = new URL(containerPath)
    const segments = containerUrl.pathname.split('/').filter(Boolean)
    const reserved = new Set(['public', 'private', 'social', 'backpack', '.well-known'])
    const accountSegment = segments[0]
    if (accountSegment && !reserved.has(accountSegment)) {
      return `${containerUrl.origin}/${accountSegment}/profile/card#me`
    }
    return `${containerUrl.origin}/profile/card#me`
  } catch {
    return 'https://vocab.nodezero.social/profile/card#me'
  }
}

export function assertAclNamespacePolicy(containerPath: string, ownerWebId: string): void {
  let containerUrl: URL

  try {
    containerUrl = new URL(containerPath)
  } catch {
    throw new Error(`${ACL_POLICY_RULES.TARGET_MALFORMED}: invalid containerPath '${containerPath}'`)
  }

  if (containerUrl.protocol !== 'https:' && containerUrl.protocol !== 'http:') {
    throw new Error(
      `${ACL_POLICY_RULES.TARGET_MALFORMED}: unsupported protocol '${containerUrl.protocol}'`
    )
  }

  const expectedOwner = deriveOwnerWebId(containerPath)
  if (ownerWebId !== expectedOwner) {
    throw new Error(
      `${ACL_POLICY_RULES.OWNER_MISMATCH}: owner '${ownerWebId}' does not match expected '${expectedOwner}'`
    )
  }
}

export function buildAclDocument(
  containerPath: string,
  visibility: ContainerVisibility,
  ownerWebId = deriveOwnerWebId(containerPath)
): string {
  assertAclNamespacePolicy(containerPath, ownerWebId)

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

  const publicMode = visibility === 'public-append' ? 'acl:Append' : 'acl:Read'

  const publicBlock = `

<#public>
    a acl:Authorization ;
    acl:accessTo <${containerPath}> ;
    acl:default <${containerPath}> ;
    acl:agentClass foaf:Agent ;
    acl:mode ${publicMode} .`

  return `${ownerBlock}${publicBlock}\n`
}

export class PodLayoutManager {
  constructor(private readonly session: AuthenticatedSession) {}

  async ensureDocustreamLayoutAndPolicy(
    podRoot: string,
    visibility: ContainerVisibility = DEFAULT_POLICY_MATRIX.docustream
  ): Promise<string> {
    const layout = buildPodContainerLayout(podRoot)
    await this.ensureContainer(layout.docustreamContainer)
    await this.ensureAcl(layout.docustreamContainer, visibility)
    return layout.docustreamContainer
  }

  async ensureDefaultLayout(podRoot: string): Promise<PodContainerLayout> {
    const layout = buildPodContainerLayout(podRoot)

    await this.ensureContainer(layout.docustreamContainer)
    await this.ensureContainer(layout.socialContainer)
    await this.ensureContainer(layout.backpackContainer)
    await this.ensureContainer(layout.notificationsContainer)
    await this.ensureContainer(layout.discoveryContainer)
    await this.ensureContainer(layout.socialInboxContainer)
    await this.ensureContainer(layout.socialOutboxContainer)
    await this.ensureContainer(layout.socialQuarantineContainer)
    await this.ensureContainer(layout.socialConsentContainer)
    await this.ensureContainer(layout.relationshipsContainer)
    await this.ensureContainer(layout.moderationContainer)
    await this.ensureContainer(layout.processedActivitiesContainer)
    await this.ensureContainer(layout.deliveryReceiptsContainer)

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
    await this.ensureAcl(layout.notificationsContainer, policyMatrix.notifications)
    await this.ensureAcl(layout.discoveryContainer, policyMatrix.discovery)
    await this.ensureAcl(layout.socialInboxContainer, policyMatrix.socialInbox)
    await this.ensureAcl(layout.socialOutboxContainer, policyMatrix.socialOutbox)
    await this.ensureAcl(layout.socialQuarantineContainer, policyMatrix.socialQuarantine)
    await this.ensureAcl(layout.socialConsentContainer, policyMatrix.socialConsent)
    await this.ensureAcl(layout.relationshipsContainer, policyMatrix.relationships)
    await this.ensureAcl(layout.moderationContainer, policyMatrix.moderation)
    await this.ensureAcl(layout.processedActivitiesContainer, policyMatrix.processedActivities)
    await this.ensureAcl(layout.deliveryReceiptsContainer, policyMatrix.deliveryReceipts)

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
