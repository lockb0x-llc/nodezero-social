import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNodeZeroSession } from './NodeZeroSessionContext'
import { getSolidPodSyncManagers } from '../solid/podSyncManagers'
import { getProvisionerUrl } from './NodeZeroSessionContext'
import { syncRelationshipInbox } from '../social/relationshipInboxSync'
import type { NotificationHistoryRecord } from '@nodezero/solid-pod-sync'

interface NotificationContextValue {
  incomingRequestCount: number
  notifications: NotificationHistoryRecord[]
  isLoading: boolean
  lastCheckedAt: Date | null
  refreshNotifications: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const REFRESH_INTERVAL_MS = 45_000

export function NotificationProvider({ children }: { children: ReactNode }): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const [incomingRequestCount, setIncomingRequestCount] = useState(0)
  const [notifications, setNotifications] = useState<NotificationHistoryRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  const refreshNotifications = useCallback(async (): Promise<void> => {
    if (status !== 'authenticated' || !webId) {
      setIncomingRequestCount(0)
      setNotifications([])
      return
    }

    setIsLoading(true)
    try {
      const podRoot = `${webId.split('/profile/')[0]}/`
      const managers = getSolidPodSyncManagers({ fetch: authFetch })

      // 1. Sync inbox and query pending relationship requests:
      const inboxResult = await syncRelationshipInbox({
        podRoot,
        recipientWebId: webId,
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers,
      }).catch(() => null)

      if (inboxResult && inboxResult.enabled) {
        setIncomingRequestCount(inboxResult.incomingRequests.length)
      } else {
        const relationships = await managers.relationshipManager
          .listRelationships(podRoot)
          .catch(() => [])
        const pending = relationships.filter((r) => r.state === 'incoming-pending')
        setIncomingRequestCount(pending.length)
      }

      // 2. Query today's notification events from Solid Pod:
      const history = await managers.notificationManager
        .listHistory(podRoot)
        .catch(() => [])
      setNotifications(history)
      setLastCheckedAt(new Date())
    } catch (err) {
      console.warn('[NotificationContext] refresh failed:', err)
    } finally {
      setIsLoading(false)
    }
  }, [authFetch, status, webId])

  useEffect(() => {
    if (status !== 'authenticated' || !webId) {
      setIncomingRequestCount(0)
      setNotifications([])
      setLastCheckedAt(null)
      return
    }

    void refreshNotifications()
    const interval = setInterval((): void => {
      void refreshNotifications()
    }, REFRESH_INTERVAL_MS)

    return (): void => {
      clearInterval(interval)
    }
  }, [refreshNotifications, status, webId])

  const value = useMemo<NotificationContextValue>(
    () => ({
      incomingRequestCount,
      notifications,
      isLoading,
      lastCheckedAt,
      refreshNotifications,
    }),
    [incomingRequestCount, notifications, isLoading, lastCheckedAt, refreshNotifications]
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used inside <NotificationProvider>')
  }
  return context
}
