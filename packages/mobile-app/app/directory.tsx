import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Platform } from 'react-native'
import type { ProfileManager } from '@nodezero/solid-pod-sync'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { aesthetic } from '../src/theme/aesthetic'
import { parseDirectoryRecords, resolveDirectoryEndpoint } from '../src/directory/directorySource'
import type { DirectoryEntry } from '../src/directory/types'
import type { DirectoryRecord } from '../src/directory/types'
import { buildDirectoryEntry } from '../src/directory/entryBuilder'
import { buildDirectoryBadges } from '../src/directory/badgeModel'
import { useConnections } from '../src/social/useConnections'
import {
  addTrustCircleMember,
  listTrustCircleMembers,
  removeTrustCircleMember,
} from '../src/social/trustCircleStore'

export default function CommunityDirectoryScreen(): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const isLoggedIn = status === 'authenticated'
  const managerRef = useRef<ProfileManager | null>(null)
  const effectiveWebId = webId

  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [communityDirectory, setCommunityDirectory] = useState<DirectoryEntry[]>([])
  const [trustCircleMembers, setTrustCircleMembers] = useState<string[]>([])
  const [trustCircleBusyWebId, setTrustCircleBusyWebId] = useState<string | null>(null)

  const loadCommunityDirectory = useCallback(async (connections: string[]): Promise<void> => {
    if (!effectiveWebId || !managerRef.current) {
      setCommunityDirectory([])
      return
    }

    setDirectoryLoading(true)
    try {
      const seed = new Set<string>([effectiveWebId, ...connections])
      const directoryMeta = new Map<string, DirectoryRecord>()
      const directoryEndpoint = resolveDirectoryEndpoint()

      if (directoryEndpoint) {
        try {
          const response = await authFetch(directoryEndpoint)
          if (response.ok) {
            const payload = (await response.json()) as unknown
            for (const candidate of parseDirectoryRecords(payload)) {
              if (candidate.listed === false) continue
              seed.add(candidate.webId)
              directoryMeta.set(candidate.webId, candidate)
            }
          }
        } catch {
          // Optional source.
        }
      }

      const entries = await Promise.all(
        Array.from(seed).map(async (candidateWebId) => {
          const profileData = await managerRef.current?.readProfile(candidateWebId).catch(() => null)
          return buildDirectoryEntry({
            candidateWebId,
            effectiveWebId,
            connections,
            profileDisplayName: profileData?.displayName,
            directoryRecord: directoryMeta.get(candidateWebId),
          })
        })
      )

      entries.sort((a, b) => a.displayName.localeCompare(b.displayName))
      setCommunityDirectory(entries)
    } finally {
      setDirectoryLoading(false)
    }
  }, [authFetch, effectiveWebId])

  const {
    connections,
    connectionsLoading,
    connectionBusyWebId,
    connectionStatus,
    loadConnections,
    addConnection,
  } = useConnections({
    effectiveWebId,
    authFetch,
    onConnectionsChanged: async () => {
      await loadCommunityDirectory(connections)
    },
  })

  useEffect(() => {
    if (!isLoggedIn) {
      setCommunityDirectory([])
      setTrustCircleMembers([])
      return
    }

    managerRef.current = getSolidPodSyncManagers({ fetch: authFetch }).profileManager
    void loadConnections()
  }, [authFetch, isLoggedIn, loadConnections])

  useEffect(() => {
    if (!isLoggedIn || !effectiveWebId || !managerRef.current) {
      setCommunityDirectory([])
      setTrustCircleMembers([])
      return
    }

    void listTrustCircleMembers(effectiveWebId, { fetch: authFetch }).then(setTrustCircleMembers)
    void loadCommunityDirectory(connections)
  }, [authFetch, connections, effectiveWebId, isLoggedIn, loadCommunityDirectory])

  const toggleTrustCircle = useCallback(async (targetWebId: string): Promise<void> => {
    if (!effectiveWebId || targetWebId === effectiveWebId) return

    setTrustCircleBusyWebId(targetWebId)
    try {
      const isMember = trustCircleMembers.includes(targetWebId)
      const next = isMember
        ? await removeTrustCircleMember(effectiveWebId, targetWebId, { fetch: authFetch })
        : await addTrustCircleMember(effectiveWebId, targetWebId, { fetch: authFetch })
      setTrustCircleMembers(next)
    } finally {
      setTrustCircleBusyWebId(null)
    }
  }, [authFetch, effectiveWebId, trustCircleMembers])

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
            const inTrustCircle = trustCircleMembers.includes(entry.webId)
            const badges = buildDirectoryBadges({
              isSelf,
              isConnected,
              isVerified: entry.verified,
              inTrustCircle,
            })
            return (
              <View key={entry.webId} style={styles.directoryRow}>
                <View style={styles.directoryMetaWrap}>
                  <Text style={styles.directoryName}>{entry.displayName}</Text>
                  <Text style={styles.directoryWebId} numberOfLines={2}>{entry.webId}</Text>
                  <View style={styles.badgeRow}>
                    {badges.map((badge) => (
                      <Text
                        key={`${entry.webId}-${badge.label}`}
                        style={badge.kind === 'verified' ? styles.metaBadgeVerified : styles.metaBadge}
                      >
                        {badge.label}
                      </Text>
                    ))}
                  </View>
                </View>
                <View style={styles.actionColumn}>
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

                  <TouchableOpacity
                    style={[styles.trustCircleButton, (isSelf || trustCircleBusyWebId === entry.webId) && styles.directoryConnectButtonDisabled]}
                    onPress={() => void toggleTrustCircle(entry.webId)}
                    disabled={isSelf || trustCircleBusyWebId === entry.webId}
                    activeOpacity={aesthetic.motion.pressOpacity}
                  >
                    {trustCircleBusyWebId === entry.webId ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Text style={styles.directoryConnectButtonText}>
                        {inTrustCircle ? 'Remove Circle' : 'Add Circle'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
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
  badgeRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaBadge: {
    color: '#9EC2FF',
    borderWidth: 1,
    borderColor: '#365586',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  metaBadgeVerified: {
    color: '#86EFAC',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 8,
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  directoryName: {
    color: aesthetic.color.textHigh,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  actionColumn: {
    alignItems: 'stretch',
    gap: 6,
    minWidth: 100,
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
  trustCircleButton: {
    backgroundColor: '#315D44',
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
