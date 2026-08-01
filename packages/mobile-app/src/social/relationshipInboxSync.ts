import {
  RelationshipInboxIngestion,
  type DiscoveryConsentManager,
  type RelationshipInboxProcessor,
  type RelationshipInboxReader,
  type RelationshipManager,
  type RelationshipQuarantineManager,
  type RelationshipRecord,
} from '@nodezero/solid-pod-sync'
import { createProvisionerRelationshipSenderVerifier } from './relationshipSenderVerifier'

export interface SyncRelationshipInboxInput {
  podRoot: string
  recipientWebId: string
  provisionerUrl: string
  authFetch: typeof globalThis.fetch
  managers: {
    discoveryConsentManager: Pick<DiscoveryConsentManager, 'readConsent'>
    relationshipInboxReader: Pick<
      RelationshipInboxReader,
      'listResourceUrls' | 'readResource' | 'removeResource'
    >
    relationshipInboxProcessor: Pick<RelationshipInboxProcessor, 'process'>
    relationshipQuarantineManager: Pick<RelationshipQuarantineManager, 'quarantine'>
    relationshipManager: Pick<RelationshipManager, 'listRelationships'>
  }
  now?: Date
}

export interface SyncRelationshipInboxResult {
  enabled: boolean
  scanned: number
  processed: number
  duplicates: number
  inProgress: number
  quarantined: number
  readFailures: number
  incomingRequests: RelationshipRecord[]
}

export async function syncRelationshipInbox(
  input: SyncRelationshipInboxInput
): Promise<SyncRelationshipInboxResult> {
  const consent = await input.managers.discoveryConsentManager.readConsent(
    input.podRoot,
    input.now
  )
  if (!consent.inboundContactRequests) return emptyResult(false)

  const ingestion = new RelationshipInboxIngestion(
    input.managers.relationshipInboxProcessor,
    input.managers.relationshipQuarantineManager,
    createProvisionerRelationshipSenderVerifier({
      provisionerUrl: input.provisionerUrl,
      authFetch: input.authFetch,
    })
  )
  const resourceUrls = await input.managers.relationshipInboxReader.listResourceUrls(input.podRoot)
  let processed = 0
  let duplicates = 0
  let inProgress = 0
  let quarantined = 0
  let readFailures = 0

  for (const sourceUrl of resourceUrls) {
    try {
      const resource = await input.managers.relationshipInboxReader.readResource(
        input.podRoot,
        sourceUrl
      )
      const result = await ingestion.ingest({
        podRoot: input.podRoot,
        recipientWebId: input.recipientWebId,
        payload: resource.payload,
        sourceUrl: resource.sourceUrl,
        ...(input.now ? { receivedAt: input.now } : {}),
      })
      if (result.status === 'processed') processed += 1
      else if (result.status === 'duplicate') duplicates += 1
      else if (result.status === 'in-progress') {
        inProgress += 1
        continue
      }
      else quarantined += 1
      await input.managers.relationshipInboxReader.removeResource(input.podRoot, sourceUrl)
    } catch {
      readFailures += 1
    }
  }

  const relationships = await input.managers.relationshipManager.listRelationships(input.podRoot)
  return {
    enabled: true,
    scanned: resourceUrls.length,
    processed,
    duplicates,
    inProgress,
    quarantined,
    readFailures,
    incomingRequests: relationships.filter((record) => record.state === 'incoming-pending'),
  }
}

function emptyResult(enabled: boolean): SyncRelationshipInboxResult {
  return {
    enabled,
    scanned: 0,
    processed: 0,
    duplicates: 0,
    inProgress: 0,
    quarantined: 0,
    readFailures: 0,
    incomingRequests: [],
  }
}
