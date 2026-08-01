import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Alert } from 'react-native'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { isLikelyWebId } from '../directory/directorySource'
import { getProvisionerUrl } from '../contexts/NodeZeroSessionContext'
import { disconnectRelationship, sendRelationshipRequest } from './relationshipRequestFlow'
import { respondToRelationshipRequest } from './relationshipRequestFlow'
import { syncRelationshipInbox } from './relationshipInboxSync'
import type { RelationshipRecord } from '@nodezero/solid-pod-sync'

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
  connections: string[]
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
  removeConnection: (targetWebId: string) => Promise<boolean>
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus | null>>
} {
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connections, setConnections] = useState<string[]>([])
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
      return
    }

    setConnectionsLoading(true)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const managers = getSolidPodSyncManagers({ fetch: authFetch })
      await managers.legacyRelationshipMigrator.migrate(podRoot)
      const relationships = await managers.relationshipManager.listRelationships(podRoot)
      setConnections(relationships
        .filter((relationship) =>
          relationship.state === 'accepted' || relationship.state === 'legacy-connected'
        )
        .map((relationship) => relationship.peerWebId)
        .filter((item) => item !== effectiveWebId))
      await syncIncomingRequests()
    } catch {
      setConnections([])
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

  return useMemo(() => ({
    connectionsLoading,
    connections,
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
    removeConnection,
    setConnectionStatus,
  }), [
    connectionsLoading,
    connections,
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
    removeConnection,
  ])
}
