import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from 'react-native'
import type { ProfileManager } from '@nodezero/solid-pod-sync'
import { useSolid } from '../src/contexts/SolidContext'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { aesthetic } from '../src/theme/aesthetic'
import { deriveNameFromWebId, parseDirectoryRecords, resolveDirectoryEndpoint } from '../src/directory/directorySource'
import type { DirectoryEntry } from '../src/directory/types'
import { useConnections } from '../src/social/useConnections'

export default function CommunityDirectoryScreen(): JSX.Element {
  const { session, webId, nodeSession, isLoggedIn, isSessionReady, signIn } = useSolid()
  const managerRef = useRef<ProfileManager | null>(null)
  const effectiveWebId = webId ?? nodeSession?.webId ?? null

  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [communityDirectory, setCommunityDirectory] = useState<DirectoryEntry[]>([])

  const loadCommunityDirectory = useCallback(async (connections: string[]): Promise<void> => {
    if (!effectiveWebId || !managerRef.current) {
      setCommunityDirectory([])
      return
    }

    setDirectoryLoading(true)
    try {
      const seed = new Set<string>([effectiveWebId, ...connections])
      const directoryEndpoint = resolveDirectoryEndpoint()

      if (directoryEndpoint) {
        try {
          const response = await session.fetch(directoryEndpoint)
          if (response.ok) {
            const payload = await response.json()
            for (const candidate of parseDirectoryRecords(payload)) {
              if (candidate.listed === false) continue
              seed.add(candidate.webId)
            }
          }
        } catch {
          // Optional source.
        }
      }

      const entries = await Promise.all(
        Array.from(seed).map(async (candidateWebId) => {
          const profileData = await managerRef.current?.readProfile(candidateWebId).catch(() => null)
          const displayName = profileData?.displayName?.trim() || deriveNameFromWebId(candidateWebId)

          return {
            webId: candidateWebId,
            displayName,
            source: candidateWebId === effectiveWebId ? 'self' : connections.includes(candidateWebId) ? 'connection' : 'directory',
            verified: false,
          } as DirectoryEntry
        })
      )

      entries.sort((a, b) => a.displayName.localeCompare(b.displayName))
      setCommunityDirectory(entries)
    } finally {
      setDirectoryLoading(false)
    }
  }, [effectiveWebId, session])

  const {
    connections,
    connectionsLoading,
    connectionBusyWebId,
    connectionStatus,
    loadConnections,
    addConnection,
  } = useConnections({
    effectiveWebId,
    session,
    isSessionReady,
    signIn,
    onConnectionsChanged: async () => {
      await loadCommunityDirectory(connections)
    },
  })

  useEffect(() => {
    if (!isLoggedIn) {
      setCommunityDirectory([])
      return
    }

    managerRef.current = getSolidPodSyncManagers(session).profileManager
    void loadConnections()
  }, [isLoggedIn, loadConnections, session])

  useEffect(() => {
    if (!isLoggedIn || !effectiveWebId || !managerRef.current) {
      setCommunityDirectory([])
      return
    }

    void loadCommunityDirectory(connections)
  }, [connections, effectiveWebId, isLoggedIn, loadCommunityDirectory])

  if (!isLoggedIn) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Please sign in to view community directory.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.sectionCard}>
        <View style={styles.sectionCardHeader}>
          <Text style={styles.sectionCardTitle}>Community Directory</Text>
          <TouchableOpacity
            onPress={() => void loadCommunityDirectory(connections)}
            disabled={directoryLoading || connectionsLoading}
            activeOpacity={aesthetic.motion.pressOpacity}
            style={styles.inlineRefreshButton}
          >
            {directoryLoading || connectionsLoading ? (
              <ActivityIndicator color={aesthetic.color.accentSoft} size="small" />
            ) : (
              <Text style={styles.inlineRefreshButtonText}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.directoryHintText}>
          Master directory of discoverable Node Zero Pod holders. Trust Circle controls remain in Broadcast.
        </Text>

        {connectionStatus ? (
          <Text
            style={[
              styles.connectionStatusText,
              connectionStatus.type === 'error'
                ? styles.connectionStatusError
                : connectionStatus.type === 'success'
                  ? styles.connectionStatusSuccess
                  : styles.connectionStatusInfo,
            ]}
          >
            {connectionStatus.message}
          </Text>
        ) : null}

        {communityDirectory.length === 0 ? (
          <Text style={styles.emptySubtleText}>No directory entries available yet.</Text>
        ) : (
          communityDirectory.slice(0, 50).map((entry) => {
            const isSelf = entry.webId === effectiveWebId
            const isConnected = connections.includes(entry.webId)
            return (
              <View key={entry.webId} style={styles.directoryRow}>
                <View style={styles.directoryMetaWrap}>
                  <Text style={styles.directoryName}>{entry.displayName}</Text>
                  <Text style={styles.directoryWebId} numberOfLines={2}>{entry.webId}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.directoryConnectButton,
                    (isSelf || isConnected) && styles.directoryConnectButtonDisabled,
                  ]}
                  onPress={() => void addConnection(entry.webId)}
                  disabled={isSelf || isConnected || connectionBusyWebId === entry.webId}
                  activeOpacity={aesthetic.motion.pressOpacity}
                >
                  {connectionBusyWebId === entry.webId ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Text style={styles.directoryConnectButtonText}>
                      {isSelf ? 'You' : isConnected ? 'Connected' : 'Connect'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )
          })
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  scrollContent: { padding: 20, paddingBottom: 48 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: aesthetic.color.bgNight },
  infoText: { color: aesthetic.color.textMid, fontSize: 14 },
  sectionCard: {
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    backgroundColor: aesthetic.color.surfaceAlt,
    padding: 14,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionCardTitle: {
    color: aesthetic.color.textHigh,
    fontSize: 15,
    fontWeight: '800',
  },
  inlineRefreshButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  inlineRefreshButtonText: {
    color: aesthetic.color.accentSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  connectionStatusText: {
    fontSize: 12,
    marginBottom: 8,
  },
  connectionStatusInfo: {
    color: '#93C5FD',
  },
  connectionStatusSuccess: {
    color: '#34D399',
  },
  connectionStatusError: {
    color: '#FCA5A5',
  },
  directoryHintText: {
    color: aesthetic.color.textMid,
    fontSize: 12,
    marginBottom: 10,
  },
  emptySubtleText: {
    color: aesthetic.color.textMid,
    fontSize: 12,
  },
  directoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
    paddingTop: 10,
    marginTop: 10,
    gap: 10,
  },
  directoryMetaWrap: {
    flex: 1,
  },
  directoryName: {
    color: aesthetic.color.textHigh,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  directoryWebId: {
    color: aesthetic.color.textMid,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  directoryConnectButton: {
    backgroundColor: aesthetic.color.accent,
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: 'center',
  },
  directoryConnectButtonDisabled: {
    backgroundColor: '#384158',
  },
  directoryConnectButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
})
