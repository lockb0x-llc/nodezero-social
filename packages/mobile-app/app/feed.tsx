/**
 * GlobalFeedScreen
 *
 * Displays a strictly chronological timeline of posts pulled from the
 * WebIDs the authenticated user has explicitly accepted in their Pod.
 *
 * NodeZero principle: no engagement-farming algorithm. Newest first. Period.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Switch,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import Slider from '@react-native-community/slider'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { useWallet } from '../src/contexts/WalletContext'
import { useRouter } from 'expo-router'
import { createSyncState, mergeAndQueryActivities, type QueryableStreamItem, type StreamItem } from '@nodezero/solid-pod-sync'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { loadFeedSyncCheckpoint, saveFeedSyncCheckpoint } from '../src/solid/syncCheckpointStore'
import { aesthetic } from '../src/theme/aesthetic'
import { readContentPreferences, writeContentPreferences } from '../src/preferences/contentPreferences'
import { collectNsfwAuthors, filterVisiblePosts } from '../src/feed/postVisibility'
import { filterSocialStreamItems } from '../src/feed/socialStreamFilter'

interface FeedPost {
  id: string
  authorWebId: string
  authorName: string
  body: string
  createdAt: string
  source: 'nodezero' | 'rss' | 'reddit' | 'x'
  postUrl?: string
}

export default function GlobalFeedScreen(): JSX.Element {
  const { status, authFetch, webId } = useNodeZeroSession()
  const isLoggedIn = status === 'authenticated'
  const { attestationStatus } = useWallet()
  const router = useRouter()
  const authModeLabel = 'NodeZero Session'
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isTunerOpen, setIsTunerOpen] = useState(false)
  const [serendipity, setSerendipity] = useState(80)
  const [deepTies, setDeepTies] = useState(50)
  const [showNsfw, setShowNsfw] = useState(false)
  const [showAuthModeHint, setShowAuthModeHint] = useState(false)
  const [isSyncCheckpointReady, setIsSyncCheckpointReady] = useState(false)
  const syncStateRef = useRef(createSyncState())

  useEffect((): (() => void) => {
    let active = true
    syncStateRef.current = createSyncState()
    setIsSyncCheckpointReady(false)

    if (!webId) {
      setIsSyncCheckpointReady(true)
      return () => {
        active = false
      }
    }

    void loadFeedSyncCheckpoint(webId)
      .then((restored) => {
        if (!active) return
        syncStateRef.current = restored
      })
      .catch(() => {
        if (!active) return
        syncStateRef.current = createSyncState()
      })
      .finally(() => {
        if (!active) return
        setIsSyncCheckpointReady(true)
      })

    return () => {
      active = false
    }
  }, [webId])

  useEffect(() => {
    void readContentPreferences().then((preferences) => {
      setShowNsfw(preferences.showNsfw)
    })
  }, [])

  const fetchFeed = useCallback(async (): Promise<void> => {
    if (!isLoggedIn || !webId || !isSyncCheckpointReady) return

    try {
      const podRoot = webId.split('/profile/')[0] + '/'
      const { relationshipManager, moderationManager, profileManager, docustreamManager } =
        getSolidPodSyncManagers({ fetch: authFetch })
      const [relationships, moderation] = await Promise.all([
        relationshipManager.listRelationships(podRoot),
        moderationManager.listModeration(podRoot),
      ])
      const blockedWebIds = new Set(
        moderation
          .filter((record) => record.action === 'block')
          .map((record) => record.subjectWebId)
      )
      const connections = relationships
        .filter((relationship) => relationship.state === 'accepted')
        .filter((relationship) => !blockedWebIds.has(relationship.peerWebId))
        .map((relationship) => ({ webId: relationship.peerWebId }))

      const authorNames = new Map<string, string>()
      const authorMetadata: Array<{ authorWebId: string; externalUrl?: string; avatarUrl?: string }> = []
      const activityBatches: Array<{
        sourceWebId: string
        items: Array<StreamItem & { authorWebId: string }>
      }> = []

      // Include user's own published posts in timeline:
      try {
        const ownerProfile = await profileManager.readProfile(webId).catch(() => null)
        const ownerDisplayName = ownerProfile?.displayName?.trim() || deriveNameFromWebId(webId)
        authorNames.set(webId, ownerDisplayName)
        authorMetadata.push({
          authorWebId: webId,
          externalUrl: ownerProfile?.externalUrl,
          avatarUrl: ownerProfile?.avatarUrl,
        })
        const myStreamItems = filterSocialStreamItems(await docustreamManager.listActivities(podRoot))
        if (myStreamItems.length > 0) {
          activityBatches.push({
            sourceWebId: webId,
            items: myStreamItems.map((item) => ({ ...item, authorWebId: webId })),
          })
        }
      } catch (ownerErr) {
        console.warn('[feed] error loading owner stream items:', ownerErr)
      }

      const connectionPosts = await Promise.all(
        connections.map(async (connection, index) => {
          try {
            const peerPodRoot = connection.webId.split('/profile/')[0] + '/'
            const profile = await profileManager.readProfile(connection.webId)
            const displayName = profile?.displayName?.trim() || deriveNameFromWebId(connection.webId)
            authorNames.set(connection.webId, displayName)
            authorMetadata.push({
              authorWebId: connection.webId,
              externalUrl: profile?.externalUrl,
              avatarUrl: profile?.avatarUrl,
            })
            const streamItems = filterSocialStreamItems(await docustreamManager.listActivities(peerPodRoot))

            if (streamItems.length > 0) {
              activityBatches.push({
                sourceWebId: connection.webId,
                items: streamItems.map((item) => ({ ...item, authorWebId: connection.webId })),
              })
              return [] as FeedPost[]
            }

            const bio = profile?.bio?.trim() || 'Shared a profile update.'
            return [
              {
                id: `${connection.webId}-${index}`,
                authorWebId: connection.webId,
                authorName: displayName,
                body: bio,
                createdAt: new Date(Date.now() - index * 60_000).toISOString(),
                source: 'nodezero',
              } as FeedPost,
            ]
          } catch {
            return [
              {
                id: `${connection.webId}-${index}`,
                authorWebId: connection.webId,
                authorName: deriveNameFromWebId(connection.webId),
                body: 'Connection is currently unavailable.',
                createdAt: new Date(Date.now() - index * 60_000).toISOString(),
                source: 'nodezero',
              } as FeedPost,
            ]
          }
        })
      )

      const merged = mergeAndQueryActivities(activityBatches, {
        state: syncStateRef.current,
        query: {
          limit: 500,
        },
      })
      syncStateRef.current = merged.sync.nextState
      try {
        await saveFeedSyncCheckpoint(webId, syncStateRef.current)
      } catch {
        // Keep rendering feed even when local checkpoint persistence fails.
      }

      const mergedPosts = merged.items.map((item) => {
        const authorWebId = item.authorWebId ?? webId
        const authorName =
          (authorWebId ? authorNames.get(authorWebId) : undefined) ??
          deriveNameFromWebId(authorWebId ?? 'unknown')
        return streamItemToFeedPost(item, authorWebId ?? 'unknown', authorName)
      })

      const combined = [...mergedPosts, ...connectionPosts.flat()]
        .flat()
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      const nsfwAuthors = collectNsfwAuthors(authorMetadata)
      setPosts(filterVisiblePosts(combined, showNsfw, nsfwAuthors))
    } catch (err) {
      console.error('[GlobalFeedScreen] fetchFeed error:', err)
    }
  }, [authFetch, isLoggedIn, isSyncCheckpointReady, showNsfw, webId])

  useEffect(() => {
    if (!isSyncCheckpointReady) {
      setLoading(true)
      return
    }

    void fetchFeed().finally(() => setLoading(false))
  }, [fetchFeed, isSyncCheckpointReady])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchFeed()
    setRefreshing(false)
  }, [fetchFeed])

  if (status === 'restoring') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    )
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.centred}>
        <Text style={styles.emptyText}>Please sign in to view your feed.</Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/')}>
          <Text style={styles.buttonText}>Sign In</Text>
        </TouchableOpacity>
      </View>
    )
  }

  // Fail-closed: block feed access until the Stellar<->Solid pairing is verified
  // against the on-chain lockb0x. While verification is in flight, show a
  // spinner; on failure, route the user back to onboarding.
  if (attestationStatus === 'idle' || attestationStatus === 'verifying') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    )
  }

  if (attestationStatus !== 'verified') {
    return (
      <View style={styles.centred}>
        <Text style={styles.emptyText}>
          Finish onboarding to access your feed. Your on-chain lockb0x must be verified first.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace('/onboarding')}>
          <Text style={styles.buttonText}>Continue Onboarding</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.feedHeader}>
        <Text style={styles.feedHeaderTitle}>Feed</Text>
        <View style={styles.feedHeaderRight}>
          <View style={styles.authModeBadge}>
            <Text style={styles.authModeBadgeText}>{authModeLabel}</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowAuthModeHint((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel="Auth mode explanation"
            style={styles.authModeInfoButton}
            activeOpacity={aesthetic.motion.pressOpacity}
          >
            <Text style={styles.authModeInfoText}>?</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.tunerButton}
            onPress={() => setIsTunerOpen(true)}
            accessibilityLabel="Open algorithm tuner"
            activeOpacity={aesthetic.motion.pressOpacity}
          >
            <Ionicons name="options" size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
      {showAuthModeHint ? (
        <View style={styles.authModeHintWrap}>
          <Text style={styles.authModeHintText}>
            {'Your device Stellar key signs you in through a NodeZero session. Pod access stays behind the NodeZero proxy with no passwords or redirects.'}
          </Text>
        </View>
      ) : null}
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#6C63FF" />}
        ListEmptyComponent={
          <View style={styles.centred}>
            <Text style={styles.emptyText}>
              Your feed is quiet. Discover and connect with nodes in the Directory tab, or add RSS sources in DocuStream to build your timeline.
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
      <Modal
        animationType="slide"
        transparent
        visible={isTunerOpen}
        onRequestClose={() => setIsTunerOpen(false)}
      >
        <TouchableOpacity
          style={styles.tunerOverlay}
          activeOpacity={1}
          onPress={() => setIsTunerOpen(false)}
        >
          <View style={styles.tunerSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.tunerHandle} />
            <Text style={styles.tunerTitle}>Your Personal Algorithm</Text>
            <Text style={styles.tunerSubtitle}>You control what you see. Tune your signal.</Text>

            <View style={styles.sliderGroup}>
              <View style={styles.sliderHeader}>
                <Text style={styles.sliderLabel}>Serendipity</Text>
                <Text style={styles.sliderValue}>{serendipity > 75 ? 'High' : serendipity > 40 ? 'Med' : 'Low'}</Text>
              </View>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={100}
                value={serendipity}
                onValueChange={(v: number) => setSerendipity(v)}
                minimumTrackTintColor="#6C63FF"
                maximumTrackTintColor="#333"
              />
              <Text style={styles.sliderDescription}>Discover new nodes in your wider H3 area.</Text>
            </View>

            <View style={styles.sliderGroup}>
              <View style={styles.sliderHeader}>
                <Text style={styles.sliderLabel}>Deep Ties (FOAF)</Text>
                <Text style={styles.sliderValue}>{deepTies > 75 ? 'High' : deepTies > 40 ? 'Med' : 'Low'}</Text>
              </View>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={0}
                maximumValue={100}
                value={deepTies}
                onValueChange={(v: number) => setDeepTies(v)}
                minimumTrackTintColor="#6C63FF"
                maximumTrackTintColor="#333"
              />
              <Text style={styles.sliderDescription}>Prioritize posts from your immediate Trust Circles.</Text>
            </View>

            <View style={styles.sfwRow}>
              <View style={styles.sfwTextWrap}>
                <Text style={styles.sfwTitle}>SFW Mode</Text>
                <Text style={styles.sfwDescription}>Hide profiles tagged as NSFW.</Text>
              </View>
              <Switch
                value={!showNsfw}
                onValueChange={(enabled) => {
                  const nextShowNsfw = !enabled
                  setShowNsfw(nextShowNsfw)
                  void writeContentPreferences({ showNsfw: nextShowNsfw })
                }}
                trackColor={{ false: '#333', true: '#6C63FF' }}
                thumbColor="#FFF"
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

function deriveNameFromWebId(inputWebId: string): string {
  try {
    const host = new URL(inputWebId).hostname
    const [name] = host.split('.')
    if (!name) return inputWebId
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return inputWebId
  }
}

function streamItemToFeedPost(item: StreamItem | QueryableStreamItem, authorWebId: string, authorName: string): FeedPost {
  return {
    id: `${authorWebId}-${item.id}`,
    authorWebId,
    authorName,
    body: item.content,
    createdAt: item.timestamp,
    source: item.source,
    postUrl: item.url,
  }
}

function PostCard({ post }: { post: FeedPost }): JSX.Element {
  return (
    <View style={styles.card}>
      <Text style={styles.authorName}>{post.authorName}</Text>
      <Text style={styles.authorWebId} numberOfLines={1}>{post.authorWebId}</Text>
      <Text style={styles.postBody}>{post.body}</Text>
      <Text style={styles.timestamp}>{new Date(post.createdAt).toLocaleString()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  feedHeaderTitle: { color: aesthetic.color.textHigh, fontSize: 18, fontWeight: '700' },
  feedHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authModeBadge: {
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 999,
    backgroundColor: aesthetic.color.surface,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  authModeBadgeText: { color: aesthetic.color.textHigh, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  authModeInfoButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authModeInfoText: { color: aesthetic.color.textLow, fontSize: 11, fontWeight: '700' },
  authModeHintWrap: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    backgroundColor: aesthetic.color.surface,
    borderRadius: 10,
  },
  authModeHintText: { color: aesthetic.color.textMid, fontSize: 12, lineHeight: 17 },
  tunerButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: aesthetic.color.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: aesthetic.color.border },
  tunerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  tunerSheet: { backgroundColor: aesthetic.color.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderTopColor: aesthetic.color.border },
  tunerHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  tunerTitle: { color: aesthetic.color.textHigh, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  tunerSubtitle: { color: aesthetic.color.textMid, fontSize: 13, marginBottom: 20 },
  sliderGroup: { marginBottom: 20 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliderLabel: { color: aesthetic.color.textHigh, fontSize: 14, fontWeight: '600' },
  sliderValue: { color: aesthetic.color.accentSoft, fontSize: 13, fontWeight: '700' },
  sliderDescription: { color: aesthetic.color.textLow, fontSize: 12, marginTop: 2 },
  sfwRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  sfwTextWrap: { flex: 1, marginRight: 12 },
  sfwTitle: { color: aesthetic.color.textHigh, fontSize: 14, fontWeight: '600' },
  sfwDescription: { color: aesthetic.color.textLow, fontSize: 12, marginTop: 2 },
  list: { padding: 16, flexGrow: 1 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: aesthetic.color.bgNight },
  emptyText: { color: aesthetic.color.textMid, fontSize: 15, textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: aesthetic.color.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: aesthetic.color.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
  },
  authorName: { color: aesthetic.color.textHigh, fontWeight: '700', fontSize: 15, marginBottom: 2 },
  authorWebId: { color: aesthetic.color.accentSoft, fontSize: 11, marginBottom: 8 },
  postBody: { color: aesthetic.color.textMid, fontSize: 14, lineHeight: 20, marginBottom: 10 },
  timestamp: { color: aesthetic.color.textLow, fontSize: 11 },
})
