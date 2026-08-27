import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Alert } from 'react-native'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { isLikelyWebId } from '../directory/directorySource'
import { getProvisionerUrl } from '../contexts/NodeZeroSessionContext'
import {
  cancelRelationshipRequest,
  disconnectRelationship,
  sendRelationshipRequest,
} from './relationshipRequestFlow'
import { respondToRelationshipRequest } from './relationshipRequestFlow'
import { syncRelationshipInbox } from './relationshipInboxSync'
import { syncRelationshipOutbox } from './relationshipOutboxSync'
import type {
  ModerationAction,
  ModerationRecord,
  RelationshipRecord,
} from '@nodezero/solid-pod-sync'
import { publishBlockStateChanged } from './moderationEvents'

export interface ConnectionStatus {
  type: 'info' | 'success' | 'error'
  message: string
}

interface UseConnectionsArgs {
  effectiveWebId: string | null
  /**
   * Authenticated proxy fetch from the NodeZero session. Guaranteed live
   * while the user is authenticated — a `session_invalid` response signs the
   * user out globally, so this hook never re-authenticates on its own.
   */
  authFetch: typeof globalThis.fetch
  onConnectionsChanged?: () => Promise<void> | void
}

export function useConnections({
  effectiveWebId,
  authFetch,
  onConnectionsChanged,
}: UseConnectionsArgs): {
  connectionsLoading: boolean
  connectionAuthorityReady: boolean
  connections: string[]
  relationships: RelationshipRecord[]
  blockedWebIds: string[]
  mutedWebIds: string[]
  reportedWebIds: string[]
  connectionBusyWebId: string | null
  connectionStatus: ConnectionStatus | null
  incomingRequests: RelationshipRecord[]
  inboundRequestsEnabled: boolean
  inboxSyncing: boolean
  loadConnections: () => Promise<void>
  syncIncomingRequests: () => Promise<void>
  setInboundRequestsEnabled: (enabled: boolean) => Promise<void>
  respondToIncomingRequest: (peerWebId: string, decision: 'accept' | 'reject') => Promise<boolean>
  addConnection: (targetWebId: string) => Promise<boolean>
  cancelConnectionRequest: (targetWebId: string) => Promise<boolean>
  removeConnection: (targetWebId: string) => Promise<boolean>
  setBlocked: (targetWebId: string, blocked: boolean) => Promise<boolean>
  setModeration: (
    targetWebId: string,
    action: Exclude<ModerationAction, 'block'>,
    enabled: boolean
  ) => Promise<boolean>
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus | null>>
} {
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connectionAuthorityReady, setConnectionAuthorityReady] = useState(false)
  const [connections, setConnections] = useState<string[]>([])
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([])
  const [blockedWebIds, setBlockedWebIds] = useState<string[]>([])
  const [mutedWebIds, setMutedWebIds] = useState<string[]>([])
  const [reportedWebIds, setReportedWebIds] = useState<string[]>([])
  const [connectionBusyWebId, setConnectionBusyWebId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)
  const [incomingRequests, setIncomingRequests] = useState<RelationshipRecord[]>([])
  const [inboundRequestsEnabled, setInboundRequestsEnabledState] = useState(false)
  const [inboxSyncing, setInboxSyncing] = useState(false)

  const syncIncomingRequests = useCallback(async (): Promise<void> => {
    if (!effectiveWebId) {
      setIncomingRequests([])
      setInboundRequestsEnabledState(false)
      return
    }
    setInboxSyncing(true)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      const result = await syncRelationshipInbox({
        podRoot,
        recipientWebId: effectiveWebId,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      })
      setInboundRequestsEnabledState(result.enabled)
      setIncomingRequests(result.incomingRequests)
    } catch (error) {
      setIncomingRequests([])
      const message = error instanceof Error ? error.message : 'Unable to refresh requests.'
      setConnectionStatus({ type: 'error', message })
    } finally {
      setInboxSyncing(false)
    }
  }, [authFetch, effectiveWebId])

  const loadConnections = useCallback(async (): Promise<void> => {
    if (!effectiveWebId) {
      setConnections([])
      setRelationships([])
      setBlockedWebIds([])
      setMutedWebIds([])
      setReportedWebIds([])
      setConnectionAuthorityReady(false)
      return
    }

    setConnectionsLoading(true)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await managers.legacyRelationshipMigrator.migrate(podRoot)
      const [relationshipRecords, moderationRecords] = await Promise.all([
        managers.relationshipManager.listRelationships(podRoot),
        managers.moderationManager.listModeration(podRoot),
      ])
      setRelationships(relationshipRecords)
      setBlockedWebIds(moderationRecords
        .filter((record: ModerationRecord) => record.action === 'block')
        .map((record) => record.subjectWebId))
      setMutedWebIds(moderationRecords
        .filter((record) => record.action === 'mute')
        .map((record) => record.subjectWebId))
      setReportedWebIds(moderationRecords
        .filter((record) => record.action === 'report')
        .map((record) => record.subjectWebId))
      setConnections(relationshipRecords
        .filter((relationship) =>
          relationship.state === 'accepted' || relationship.state === 'legacy-connected'
        )
        .map((relationship) => relationship.peerWebId)
        .filter((item) => item !== effectiveWebId))
      setConnectionAuthorityReady(true)
      await syncIncomingRequests()
      void syncRelationshipOutbox({
        podRoot,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      }).catch((outboxErr) => {
        console.warn('[useConnections] outbox sync warning:', outboxErr)
      })
    } catch {
      setConnections([])
      setRelationships([])
      setBlockedWebIds([])
      setMutedWebIds([])
      setReportedWebIds([])
      setConnectionAuthorityReady(false)
    } finally {
      setConnectionsLoading(false)
    }
  }, [authFetch, effectiveWebId, syncIncomingRequests])

  const setInboundRequestsEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (!effectiveWebId) return
    const previous = inboundRequestsEnabled
    setInboundRequestsEnabledState(enabled)
    setConnectionStatus(null)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const { discoveryConsentManager } = getSolidPodSyncManagers({ fetch: authFetch })
      await discoveryConsentManager.updateConsent(podRoot, {
        inboundContactRequests: enabled,
      })
      if (enabled) await syncIncomingRequests()
      else setIncomingRequests([])
      setConnectionStatus({
        type: 'success',
        message: enabled ? 'Relationship requests enabled.' : 'Relationship requests disabled.',
      })
    } catch (error) {
      setInboundRequestsEnabledState(previous)
      const message = error instanceof Error ? error.message : 'Unable to update request consent.'
      setConnectionStatus({ type: 'error', message })
    }
  }, [authFetch, effectiveWebId, inboundRequestsEnabled, syncIncomingRequests])

  const respondToIncomingRequest = useCallback(async (
    peerWebId: string,
    decision: 'accept' | 'reject'
  ): Promise<boolean> => {
    if (!effectiveWebId) return false
    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionBusyWebId(peerWebId)
    setConnectionStatus(null)
    try {
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await respondToRelationshipRequest({
        podRoot,
        ownerWebId: effectiveWebId,
        recipientWebId: peerWebId,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
        decision,
      })
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({
        type: 'success',
        message: decision === 'accept' ? 'Relationship accepted.' : 'Relationship rejected.',
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to answer request.'
      setConnectionStatus({ type: 'error', message })
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections, onConnectionsChanged])

  const addConnection = useCallback(async (targetWebId: string): Promise<boolean> => {
    if (!effectiveWebId) return false

    const candidate = targetWebId.trim()
    if (!isLikelyWebId(candidate)) {
      Alert.alert('Invalid WebID', 'Use a valid https WebID, for example: https://your-node/profile/card#me')
      return false
    }
    if (candidate === effectiveWebId) {
      Alert.alert('Not allowed', 'You are already connected to yourself.')
      return false
    }

    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionStatus(null)
    setConnectionBusyWebId(candidate)
    try {
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await sendRelationshipRequest({
        podRoot,
        ownerWebId: effectiveWebId,
        recipientWebId: candidate,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      })
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection request sent.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add connection.'
      setConnectionStatus({ type: 'error', message: `Add failed: ${message}` })
      Alert.alert('Connection error', message)
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections, onConnectionsChanged])

  const removeConnection = useCallback(async (targetWebId: string): Promise<boolean> => {
    if (!effectiveWebId) return false

    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionStatus(null)
    setConnectionBusyWebId(targetWebId)
    try {
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await disconnectRelationship({
        podRoot,
        ownerWebId: effectiveWebId,
        recipientWebId: targetWebId,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      })
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection removed.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove connection.'
      setConnectionStatus({ type: 'error', message: `Remove failed: ${message}` })
      Alert.alert('Connection error', message)
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections, onConnectionsChanged])

  const cancelConnectionRequest = useCallback(async (targetWebId: string): Promise<boolean> => {
    if (!effectiveWebId) return false

    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionStatus(null)
    setConnectionBusyWebId(targetWebId)
    try {
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await cancelRelationshipRequest({
        podRoot,
        ownerWebId: effectiveWebId,
        recipientWebId: targetWebId,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      })
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection request cancelled.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel request.'
      setConnectionStatus({ type: 'error', message: `Cancel failed: ${message}` })
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections, onConnectionsChanged])

  const setBlocked = useCallback(async (
    targetWebId: string,
    blocked: boolean
  ): Promise<boolean> => {
    if (!effectiveWebId || targetWebId === effectiveWebId) return false
    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionBusyWebId(targetWebId)
    setConnectionStatus(null)
    try {
      const { moderationManager } = getSolidPodSyncManagers({ fetch: authFetch })
      if (blocked) {
        await moderationManager.setModeration(podRoot, {
          subjectWebId: targetWebId,
          action: 'block',
          reasonCode: 'user-blocked',
        })
      } else {
        await moderationManager.removeModeration(podRoot, targetWebId, 'block')
      }
      await loadConnections()
      publishBlockStateChanged({
        ownerWebId: effectiveWebId,
        subjectWebId: targetWebId,
        blocked,
      })
      await onConnectionsChanged?.()
      setConnectionStatus({
        type: 'success',
        message: blocked ? 'Person blocked.' : 'Person unblocked.',
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update block state.'
      setConnectionStatus({ type: 'error', message })
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections, onConnectionsChanged])

  const setModeration = useCallback(async (
    targetWebId: string,
    action: Exclude<ModerationAction, 'block'>,
    enabled: boolean
  ): Promise<boolean> => {
    if (!effectiveWebId || targetWebId === effectiveWebId) return false
    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionBusyWebId(targetWebId)
    setConnectionStatus(null)
    try {
      const { moderationManager } = getSolidPodSyncManagers({ fetch: authFetch })
      if (enabled) {
        await moderationManager.setModeration(podRoot, {
          subjectWebId: targetWebId,
          action,
          reasonCode: action === 'mute' ? 'user-muted' : 'user-reported',
        })
      } else {
        await moderationManager.removeModeration(podRoot, targetWebId, action)
      }
      await loadConnections()
      setConnectionStatus({
        type: 'success',
        message: action === 'mute'
          ? enabled ? 'Person muted.' : 'Person unmuted.'
          : 'Report saved privately.',
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update moderation state.'
      setConnectionStatus({ type: 'error', message })
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, loadConnections])

  return useMemo(() => ({
    connectionsLoading,
    connectionAuthorityReady,
    connections,
    relationships,
    blockedWebIds,
    mutedWebIds,
    reportedWebIds,
    connectionBusyWebId,
    connectionStatus,
    incomingRequests,
    inboundRequestsEnabled,
    inboxSyncing,
    loadConnections,
    syncIncomingRequests,
    setInboundRequestsEnabled,
    respondToIncomingRequest,
    addConnection,
    cancelConnectionRequest,
    removeConnection,
    setBlocked,
    setModeration,
    setConnectionStatus,
  }), [
    connectionsLoading,
    connectionAuthorityReady,
    connections,
    relationships,
    blockedWebIds,
    mutedWebIds,
    reportedWebIds,
    connectionBusyWebId,
    connectionStatus,
    incomingRequests,
    inboundRequestsEnabled,
    inboxSyncing,
    loadConnections,
    syncIncomingRequests,
    setInboundRequestsEnabled,
    respondToIncomingRequest,
    addConnection,
    cancelConnectionRequest,
    removeConnection,
    setBlocked,
    setModeration,
  ])
}
