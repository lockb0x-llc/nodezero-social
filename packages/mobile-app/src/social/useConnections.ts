import { useCallback, useMemo, useState } from 'react'
import Constants from 'expo-constants'
import { Alert } from 'react-native'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { isLikelyWebId } from '../directory/directorySource'

export interface ConnectionStatus {
  type: 'info' | 'success' | 'error'
  message: string
}

interface UseConnectionsArgs {
  effectiveWebId: string | null
  session: unknown
  isSessionReady: boolean
  signIn: (issuer: string) => Promise<void>
  onConnectionsChanged?: () => Promise<void> | void
}

export function useConnections({
  effectiveWebId,
  session,
  isSessionReady,
  signIn,
  onConnectionsChanged,
}: UseConnectionsArgs) {
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [connections, setConnections] = useState<string[]>([])
  const [connectionBusyWebId, setConnectionBusyWebId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus | null>(null)

  const canWriteProfile = isSessionReady

  const ensureSolidWriteReady = useCallback(async (forceReauth = false): Promise<boolean> => {
    if (!forceReauth && canWriteProfile) return true

    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const issuerBase = (appExtra?.nodeZeroIssuerUrl ?? '').replace(/\/+$/, '')
    if (!issuerBase) {
      Alert.alert('Sign in required', 'Solid session is still restoring. Please use Sign In and try again.')
      return false
    }

    try {
      await signIn(issuerBase)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start sign-in.'
      Alert.alert('Sign in required', message)
    }
    return false
  }, [canWriteProfile, signIn])

  const loadConnections = useCallback(async (): Promise<void> => {
    if (!effectiveWebId) {
      setConnections([])
      return
    }

    setConnectionsLoading(true)
    try {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      const { socialGraph } = getSolidPodSyncManagers(session as never)
      const list = await socialGraph.listConnections(podRoot)
      setConnections(list.map((item) => item.webId).filter((item) => item !== effectiveWebId))
    } catch {
      setConnections([])
    } finally {
      setConnectionsLoading(false)
    }
  }, [effectiveWebId, session])

  const addConnection = useCallback(async (targetWebId: string): Promise<boolean> => {
    if (!effectiveWebId) return false

    if (!(await ensureSolidWriteReady())) return false

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
      const { socialGraph } = getSolidPodSyncManagers(session as never)
      await socialGraph.addConnection(podRoot, candidate)
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection added successfully.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add connection.'
      const isAuthFailure =
        /\bHTTP\s*401\b|www-authenticate|unauthorized|h401|network\s*request\s*failed|fetch/i.test(
          message
        ) ||
        !isSessionReady

      if (isAuthFailure) {
        setConnectionStatus({ type: 'info', message: 'Solid session needs re-authentication. Redirecting to sign-in...' })
        void ensureSolidWriteReady(true)
        return false
      }

      setConnectionStatus({ type: 'error', message: `Add failed: ${message}` })
      Alert.alert('Connection error', message)
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [effectiveWebId, ensureSolidWriteReady, isSessionReady, loadConnections, onConnectionsChanged, session])

  const removeConnection = useCallback(async (targetWebId: string): Promise<boolean> => {
    if (!effectiveWebId) return false

    if (!(await ensureSolidWriteReady())) return false

    const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
    setConnectionStatus(null)
    setConnectionBusyWebId(targetWebId)
    try {
      const { socialGraph } = getSolidPodSyncManagers(session as never)
      await socialGraph.removeConnection(podRoot, targetWebId)
      await loadConnections()
      await onConnectionsChanged?.()
      setConnectionStatus({ type: 'success', message: 'Connection removed.' })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove connection.'
      const isAuthFailure =
        /\bHTTP\s*401\b|www-authenticate|unauthorized|h401|network\s*request\s*failed|fetch/i.test(
          message
        ) ||
        !isSessionReady

      if (isAuthFailure) {
        setConnectionStatus({ type: 'info', message: 'Solid session needs re-authentication. Redirecting to sign-in...' })
        void ensureSolidWriteReady(true)
        return false
      }

      setConnectionStatus({ type: 'error', message: `Remove failed: ${message}` })
      Alert.alert('Connection error', message)
      return false
    } finally {
      setConnectionBusyWebId(null)
    }
  }, [effectiveWebId, ensureSolidWriteReady, isSessionReady, loadConnections, onConnectionsChanged, session])

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
