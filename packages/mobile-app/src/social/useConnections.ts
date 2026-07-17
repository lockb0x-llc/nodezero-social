import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Alert } from 'react-native'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { isLikelyWebId } from '../directory/directorySource'

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
  loadConnections: () => Promise<void>
  addConnection: (targetWebId: string) => Promise<boolean>
  removeConnection: (targetWebId: string) => Promise<boolean>
  setConnectionStatus: Dispatch<SetStateAction<ConnectionStatus | null>>
} {
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connections, setConnections] = useState<string[]>([])
  const [connectionBusyWebId, setConnectionBusyWebId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)

  const loadConnections = useCallback(async (): Promise<void> => {
    if (!effectiveWebId) {
      setConnections([])
      return
    }

    setConnectionsLoading(true)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const { socialGraph } = getSolidPodSyncManagers({ fetch: authFetch })
      const list = await socialGraph.listConnections(podRoot)
      setConnections(list.map((item) => item.webId).filter((item) => item !== effectiveWebId))
    } catch {
      setConnections([])
    } finally {
      setConnectionsLoading(false)
    }
  }, [authFetch, effectiveWebId])

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
      const { socialGraph } = getSolidPodSyncManagers({ fetch: authFetch })
      await socialGraph.addConnection(podRoot, candidate)
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection added successfully.' })
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
      const { socialGraph } = getSolidPodSyncManagers({ fetch: authFetch })
      await socialGraph.removeConnection(podRoot, targetWebId)
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
    loadConnections,
    addConnection,
    removeConnection,
    setConnectionStatus,
  }), [connectionsLoading, connections, connectionBusyWebId, connectionStatus, loadConnections, addConnection, removeConnection])
}
