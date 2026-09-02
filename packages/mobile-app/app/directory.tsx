import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { getProvisionerUrl, useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { aesthetic } from '../src/theme/aesthetic'
import { resolveDirectoryEndpoint } from '../src/directory/directorySource'
import type { DirectoryEntry } from '../src/directory/types'
import type { DirectoryRecord } from '../src/directory/types'
import { buildDirectoryEntry, directoryRecommendationRank } from '../src/directory/entryBuilder'
import { buildDirectoryBadges } from '../src/directory/badgeModel'
import {
  fetchDirectoryPage,
  type DirectoryPageCacheEntry,
} from '../src/directory/directoryPageClient'
import { useConnections } from '../src/social/useConnections'
import {
  addTrustCircleMember,
  listTrustCircleMembers,
  removeTrustCircleMember,
} from '../src/social/trustCircleStore'
import { derivePersonActionPolicy } from '../src/social/personActionPolicy'
import {
  NO_DIRECTORY_FEATURES,
  readDirectoryFeatureAvailability,
  type DirectoryFeatureAvailability,
} from '../src/directory/directoryFeatureClient'
import { DirectoryAvatar } from '../src/directory/DirectoryAvatar'

export default function CommunityDirectoryScreen(): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const router = useRouter()
  const isLoggedIn = status === 'authenticated'
  const effectiveWebId = webId

  const [directoryLoading, setDirectoryLoading] = useState(false)
  const [communityDirectory, setCommunityDirectory] = useState<DirectoryEntry[]>([])
  const [trustCircleMembers, setTrustCircleMembers] = useState<string[]>([])
  const [trustCircleBusyWebId, setTrustCircleBusyWebId] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [publicInterests, setPublicInterests] = useState<string[]>([])
  const [acceptedRelationships, setAcceptedRelationships] = useState<string[]>([])
  const [features, setFeatures] = useState<DirectoryFeatureAvailability>(NO_DIRECTORY_FEATURES)
  const [featuresLoading, setFeaturesLoading] = useState(true)
  const [ownProfilePublished, setOwnProfilePublished] = useState(false)
  const pageCacheRef = useRef<DirectoryPageCacheEntry | null>(null)
  const directoryRecordsRef = useRef<DirectoryRecord[]>([])

  const loadCommunityDirectory = useCallback(
    async (connections: string[], cursor?: string): Promise<void> => {
      if (!effectiveWebId || !features.directory) {
        setCommunityDirectory([])
        return
      }

      setDirectoryLoading(true)
      try {
        const directoryEndpoint = resolveDirectoryEndpoint()
        if (!directoryEndpoint) throw new Error('Community directory is not configured.')
        const result = await fetchDirectoryPage({
          endpoint: directoryEndpoint,
          fetch: authFetch,
          ...(cursor ? { cursor } : {}),
          limit: 50,
          ...(!cursor && pageCacheRef.current ? { cached: pageCacheRef.current } : {}),
        })
        if (!cursor) pageCacheRef.current = result.cache
        const nextRecords = cursor
          ? [...directoryRecordsRef.current, ...result.page.members]
          : result.page.members
        const dedupedRecords = Array.from(
          new Map(nextRecords.map((record) => [record.webId, record])).values()
        )
        directoryRecordsRef.current = dedupedRecords
        setNextCursor(result.page.nextCursor)
        setOwnProfilePublished(dedupedRecords.some((record) => record.webId === effectiveWebId))
        const seed = new Map<string, DirectoryRecord | undefined>([
          [effectiveWebId, undefined],
          ...connections.map((connection): [string, DirectoryRecord | undefined] => [
            connection,
            undefined,
          ]),
          ...dedupedRecords.map((record): [string, DirectoryRecord | undefined] => [
            record.webId,
            record,
          ]),
        ])
        const entries = Array.from(seed).map(([candidateWebId, directoryRecord]) =>
          buildDirectoryEntry({
            candidateWebId,
            effectiveWebId,
            connections,
            acceptedRelationships,
            directoryRecord,
            localPublicInterests: publicInterests,
          })
        )
        entries.sort((left, right) => {
          const rank = directoryRecommendationRank(left) - directoryRecommendationRank(right)
          return rank !== 0 ? rank : left.displayName.localeCompare(right.displayName)
        })
        setCommunityDirectory(entries)
      } finally {
        setDirectoryLoading(false)
      }
    },
    [acceptedRelationships, authFetch, effectiveWebId, features.directory, publicInterests]
  )

  const {
    connections,
    relationships,
    blockedWebIds,
    mutedWebIds,
    reportedWebIds,
    connectionsLoading,
    connectionAuthorityReady,
    connectionBusyWebId,
    connectionStatus,
    loadConnections,
    respondToIncomingRequest,
    addConnection,
    cancelConnectionRequest,
    removeConnection,
    setBlocked,
    setModeration,
  } = useConnections({
    effectiveWebId,
    authFetch,
    onConnectionsChanged: async () => {
      await loadCommunityDirectory(connections)
    },
  })

  useFocusEffect(
    useCallback(() => {
      if (!isLoggedIn || !features.directory) return
      pageCacheRef.current = null
      directoryRecordsRef.current = []
      void loadCommunityDirectory(connections)
    }, [connections, features.directory, isLoggedIn, loadCommunityDirectory])
  )

  useEffect(() => {
    if (!isLoggedIn) {
      setCommunityDirectory([])
      setTrustCircleMembers([])
      setFeatures(NO_DIRECTORY_FEATURES)
      setFeaturesLoading(false)
      return
    }

    setFeaturesLoading(true)
    void readDirectoryFeatureAvailability(getProvisionerUrl(), authFetch)
      .then(setFeatures)
      .finally(() => setFeaturesLoading(false))

    const managers = getSolidPodSyncManagers({ fetch: authFetch })
    if (effectiveWebId) {
      const podRoot = `${effectiveWebId.split('/profile/')[0]}/`
      void managers.discoveryManifestManager
        .readManifest(podRoot)
        .then((manifest) => setPublicInterests(manifest?.publicInterests ?? []))
        .catch(() => setPublicInterests([]))
    }
    void loadConnections()
  }, [authFetch, effectiveWebId, isLoggedIn, loadConnections])

  useEffect(() => {
    setAcceptedRelationships(
      relationships
        .filter((relationship) => relationship.state === 'accepted')
        .map((relationship) => relationship.peerWebId)
    )
  }, [relationships])

  useEffect(() => {
    if (!isLoggedIn || !effectiveWebId) {
      setCommunityDirectory([])
      setTrustCircleMembers([])
      return
    }

    void listTrustCircleMembers(effectiveWebId, { fetch: authFetch }).then(setTrustCircleMembers)
    void loadCommunityDirectory(connections)
  }, [authFetch, connections, effectiveWebId, isLoggedIn, loadCommunityDirectory])

  const toggleTrustCircle = useCallback(
    async (targetWebId: string): Promise<void> => {
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
    },
    [authFetch, effectiveWebId, trustCircleMembers]
  )

  if (!isLoggedIn) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Please sign in to view community directory.</Text>
      </View>
    )
  }

  if (featuresLoading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={aesthetic.color.accentSoft} />
      </View>
    )
  }

  if (!features.directory) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Community Directory is not available for this account.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.sectionCard}>
        <View style={styles.sectionCardHeader}>
          <Text style={styles.sectionCardTitle}>Community Directory</Text>
          <TouchableOpacity
            onPress={() => void loadConnections()}
            disabled={directoryLoading || connectionsLoading}
            activeOpacity={aesthetic.motion.pressOpacity}
            style={styles.inlineRefreshButton}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
          >
            {directoryLoading || connectionsLoading ? (
              <ActivityIndicator color={aesthetic.color.accentSoft} size="small" />
            ) : (
              <Text style={styles.inlineRefreshButtonText}>Refresh</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.directoryHintText}>
          Public Pod-owner manifests, ranked by your explicit public context.
        </Text>

        {!ownProfilePublished ? (
          <Text style={styles.directoryGateHintText}>
            Use the Profile tab to publish your Profile to the Directory to view profiles and connect with others.
          </Text>
        ) : null}

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
          communityDirectory
            .filter(
              (entry) =>
                entry.webId === effectiveWebId ||
                (connectionAuthorityReady && !blockedWebIds.includes(entry.webId))
            )
            .slice(0, 50)
            .map((entry) => {
              const isSelf = entry.webId === effectiveWebId
              const isConnected = connections.includes(entry.webId)
              const inTrustCircle = trustCircleMembers.includes(entry.webId)
              const relationship = relationships.find((record) => record.peerWebId === entry.webId)
              const actionPolicy = derivePersonActionPolicy({
                isSelf,
                relationshipState: relationship?.state ?? null,
                blocked: blockedWebIds.includes(entry.webId),
                muted: mutedWebIds.includes(entry.webId),
                reported: reportedWebIds.includes(entry.webId),
                inTrustCircle,
              })
              const badges = buildDirectoryBadges({
                isSelf,
                isConnected,
                isVerified: entry.verified,
                inTrustCircle,
              })
              return (
                <View key={entry.webId} style={styles.directoryRow}>
                  <DirectoryAvatar
                    webId={entry.webId}
                    displayName={entry.displayName}
                    avatarUrl={entry.avatarUrl}
                    authFetch={authFetch}
                  />
                  <View style={styles.directoryMetaWrap}>
                    <Text style={styles.directoryName}>{entry.displayName}</Text>
                    <Text style={styles.directoryWebId} numberOfLines={2}>
                      {entry.webId}
                    </Text>
                    <View style={styles.badgeRow}>
                      {badges.map((badge) => (
                        <Text
                          key={`${entry.webId}-${badge.label}`}
                          style={
                            badge.kind === 'verified' ? styles.metaBadgeVerified : styles.metaBadge
                          }
                        >
                          {badge.label}
                        </Text>
                      ))}
                    </View>
                    <Text style={styles.recommendationReasonText}>
                      {recommendationLabel(entry.recommendationReasons[0])}
                    </Text>
                    {entry.publicInterests.length > 0 ? (
                      <Text style={styles.publicInterestPreview} numberOfLines={1}>
                        {entry.publicInterests.join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.actionColumn}>
                    {!isSelf && !ownProfilePublished ? (
                      <Text style={styles.directoryGateHintText}>Publish your profile to interact</Text>
                    ) : (
                      <>
                    {!isSelf && features.peerProfile ? (
                      <TouchableOpacity
                        style={styles.profileButton}
                        onPress={() =>
                          router.push({ pathname: '/profile', params: { peerWebId: entry.webId } })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Open profile for ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Profile</Text>
                      </TouchableOpacity>
                    ) : null}
                    {features.relationship && actionPolicy.canRequest ? (
                      <TouchableOpacity
                        style={styles.directoryConnectButton}
                        onPress={() => void addConnection(entry.webId)}
                        disabled={connectionBusyWebId === entry.webId}
                        activeOpacity={aesthetic.motion.pressOpacity}
                      >
                        {connectionBusyWebId === entry.webId ? (
                          <ActivityIndicator color="#FFF" size="small" />
                        ) : (
                          <Text style={styles.directoryConnectButtonText}>Connect</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}

                    {features.relationship && actionPolicy.canCancelRequest ? (
                      <TouchableOpacity
                        style={styles.connectionActionButtonSecondary}
                        onPress={() => void cancelConnectionRequest(entry.webId)}
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`Cancel request to ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Cancel</Text>
                      </TouchableOpacity>
                    ) : null}

                    {features.relationship && actionPolicy.canAcceptRequest ? (
                      <TouchableOpacity
                        style={styles.directoryConnectButton}
                        onPress={() => void respondToIncomingRequest(entry.webId, 'accept')}
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`Accept request from ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Accept</Text>
                      </TouchableOpacity>
                    ) : null}

                    {features.relationship && actionPolicy.canDeclineRequest ? (
                      <TouchableOpacity
                        style={styles.connectionActionButtonSecondary}
                        onPress={() => void respondToIncomingRequest(entry.webId, 'reject')}
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`Decline request from ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Decline</Text>
                      </TouchableOpacity>
                    ) : null}

                    {features.transport && actionPolicy.canMessage ? (
                      <TouchableOpacity
                        style={styles.messageButton}
                        onPress={() =>
                          router.push({ pathname: '/local', params: { peerWebId: entry.webId } })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Message ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Message</Text>
                      </TouchableOpacity>
                    ) : null}

                    {features.relationship && actionPolicy.canDisconnect ? (
                      <TouchableOpacity
                        style={styles.connectionActionButtonSecondary}
                        onPress={() => void removeConnection(entry.webId)}
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`Disconnect from ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Disconnect</Text>
                      </TouchableOpacity>
                    ) : null}

                    {!isSelf ? (
                      <TouchableOpacity
                        style={[
                          styles.trustCircleButton,
                          !actionPolicy.canAddTrustCircle &&
                            !actionPolicy.canRemoveTrustCircle &&
                            styles.directoryConnectButtonDisabled,
                        ]}
                        onPress={() => void toggleTrustCircle(entry.webId)}
                        disabled={
                          (!actionPolicy.canAddTrustCircle && !actionPolicy.canRemoveTrustCircle) ||
                          trustCircleBusyWebId === entry.webId
                        }
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
                    ) : null}

                    {!isSelf && actionPolicy.canBlock ? (
                      <TouchableOpacity
                        style={
                          actionPolicy.reason === 'blocked'
                            ? styles.unblockButton
                            : styles.blockButton
                        }
                        onPress={() =>
                          void setBlocked(entry.webId, actionPolicy.reason !== 'blocked')
                        }
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`${actionPolicy.reason === 'blocked' ? 'Unblock' : 'Block'} ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>
                          {actionPolicy.reason === 'blocked' ? 'Unblock' : 'Block'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {!isSelf && (actionPolicy.canMute || actionPolicy.canUnmute) ? (
                      <TouchableOpacity
                        style={styles.muteButton}
                        onPress={() =>
                          void setModeration(entry.webId, 'mute', actionPolicy.canMute)
                        }
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`${actionPolicy.canUnmute ? 'Unmute' : 'Mute'} ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>
                          {actionPolicy.canUnmute ? 'Unmute' : 'Mute'}
                        </Text>
                      </TouchableOpacity>
                    ) : null}
                    {!isSelf && actionPolicy.canReport ? (
                      <TouchableOpacity
                        style={styles.reportButton}
                        onPress={() => void setModeration(entry.webId, 'report', true)}
                        disabled={connectionBusyWebId === entry.webId}
                        accessibilityRole="button"
                        accessibilityLabel={`Report ${entry.displayName}`}
                      >
                        <Text style={styles.directoryConnectButtonText}>Report</Text>
                      </TouchableOpacity>
                    ) : null}
                      </>
                    )}
                  </View>
                </View>
              )
            })
        )}
        {nextCursor ? (
          <TouchableOpacity
            style={styles.loadMoreButton}
            onPress={() => void loadCommunityDirectory(connections, nextCursor)}
            disabled={directoryLoading}
            accessibilityRole="button"
            accessibilityLabel="Load more directory entries"
          >
            {directoryLoading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.directoryConnectButtonText}>Load more</Text>
            )}
          </TouchableOpacity>
        ) : null}
        {blockedWebIds.length > 0 ? (
          <View style={styles.blockedRecoverySection}>
            <Text style={styles.sectionCardTitle}>Blocked</Text>
            {blockedWebIds.map((blockedWebId) => (
              <View key={blockedWebId} style={styles.blockedRecoveryRow}>
                <Text style={styles.directoryWebId} numberOfLines={2}>
                  {blockedWebId}
                </Text>
                <TouchableOpacity
                  style={styles.unblockButton}
                  onPress={() => void setBlocked(blockedWebId, false)}
                  accessibilityRole="button"
                  accessibilityLabel={`Unblock ${blockedWebId}`}
                >
                  <Text style={styles.directoryConnectButtonText}>Unblock</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  )
}

function recommendationLabel(
  reason: DirectoryEntry['recommendationReasons'][number] | undefined
): string {
  if (reason === 'self') return 'Your profile'
  if (reason === 'accepted-relationship') return 'Accepted relationship'
  if (reason === 'legacy-contact') return 'Legacy contact'
  if (reason === 'shared-public-interest') return 'Shared public interest'
  return 'Public directory'
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  scrollContent: { padding: 20, paddingBottom: 48 },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: aesthetic.color.bgNight,
  },
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
  directoryGateHintText: {
    color: aesthetic.color.accentSoft,
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
  messageButton: {
    backgroundColor: '#276B73',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: 'center',
  },
  connectionActionButtonSecondary: {
    backgroundColor: '#4A4F59',
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
  profileButton: {
    minWidth: 86,
    backgroundColor: '#343842',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  blockButton: {
    minWidth: 86,
    backgroundColor: '#7A3036',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  unblockButton: {
    minWidth: 86,
    backgroundColor: '#455A64',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  muteButton: {
    minWidth: 86,
    backgroundColor: '#625A2E',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  reportButton: {
    minWidth: 86,
    backgroundColor: '#6A3A55',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  loadMoreButton: {
    minHeight: 40,
    marginTop: 14,
    backgroundColor: '#343842',
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedRecoverySection: {
    marginTop: 18,
    gap: 8,
  },
  blockedRecoveryRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recommendationReasonText: {
    color: aesthetic.color.accentSoft,
    fontSize: 11,
    marginTop: 5,
  },
  publicInterestPreview: {
    color: aesthetic.color.textMid,
    fontSize: 11,
    marginTop: 3,
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
