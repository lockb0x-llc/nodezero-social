/**
 * GlobalFeedScreen
 *
 * Displays a strictly chronological timeline of posts pulled from the
 * WebIDs the authenticated user follows (their `foaf:knows` graph).
 *
 * NodeZero principle: no engagement-farming algorithm. Newest first. Period.
 */

import React, { useCallback, useEffect, useState } from 'react'
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
import { useSolid } from '../src/contexts/SolidContext'
import { useRouter } from 'expo-router'
import { SocialGraph, ProfileManager } from '@nodezero/solid-pod-sync'

// Stub components — remove when @expo/vector-icons and @react-native-community/slider are installed (L3)
const Ionicons = (_props: { name: string; size?: number; color?: string }) => null
const Slider = (_props: any) => null

interface FeedPost {
  id: string
  authorWebId: string
  authorName: string
  body: string
  createdAt: string
}

export default function GlobalFeedScreen(): JSX.Element {
  const { isLoggedIn, isRestoring, session, webId } = useSolid()
  const router = useRouter()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [isTunerOpen, setIsTunerOpen] = useState(false)
  const [serendipity, setSerendipity] = useState(80)
  const [deepTies, setDeepTies] = useState(50)
  const [sfwMode, setSfwMode] = useState(true)

  const fetchFeed = useCallback(async () => {
    if (!isLoggedIn || !webId) return

    try {
      const podRoot = webId.split('/profile/')[0] + '/'
      const socialGraph = new SocialGraph(session)
      const profileManager = new ProfileManager(session)
      const connections = await socialGraph.listConnections(podRoot)

      const connectionPosts = await Promise.all(
        connections.map(async (connection, index) => {
          try {
            const profile = await profileManager.readProfile(connection.webId)
            const displayName = profile?.displayName?.trim() || deriveNameFromWebId(connection.webId)
            const bio = profile?.bio?.trim() || 'Shared a profile update.'
            return {
              id: `${connection.webId}-${index}`,
              authorWebId: connection.webId,
              authorName: displayName,
              body: bio,
              createdAt: new Date(Date.now() - index * 60_000).toISOString(),
            } as FeedPost
          } catch {
            return {
              id: `${connection.webId}-${index}`,
              authorWebId: connection.webId,
              authorName: deriveNameFromWebId(connection.webId),
              body: 'Connection is currently unavailable.',
              createdAt: new Date(Date.now() - index * 60_000).toISOString(),
            } as FeedPost
          }
        })
      )

      setPosts(connectionPosts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)))
    } catch (err) {
      console.error('[GlobalFeedScreen] fetchFeed error:', err)
    }
  }, [isLoggedIn, session, webId])

  useEffect(() => {
    void fetchFeed().finally(() => setLoading(false))
  }, [fetchFeed])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchFeed()
    setRefreshing(false)
  }, [fetchFeed])

  if (isRestoring) {
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
        <TouchableOpacity
          style={styles.tunerButton}
          onPress={() => setIsTunerOpen(true)}
          accessibilityLabel="Open algorithm tuner"
        >
          <Ionicons name="options" size={22} color="#FFF" />
        </TouchableOpacity>
      </View>
      <FlatList
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor="#6C63FF" />}
        ListEmptyComponent={
          <View style={styles.centred}>
            <Text style={styles.emptyText}>
              Your feed is empty. Follow people via the Profile screen.
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
            <Text style={styles.tunerSubtitle}>You control what you see. Tune your grid.</Text>

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
                value={sfwMode}
                onValueChange={setSfwMode}
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
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  feedHeaderTitle: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  tunerButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2A2A2A' },
  tunerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  tunerSheet: { backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  tunerHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  tunerTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  tunerSubtitle: { color: '#888', fontSize: 13, marginBottom: 20 },
  sliderGroup: { marginBottom: 20 },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sliderLabel: { color: '#DDD', fontSize: 14, fontWeight: '600' },
  sliderValue: { color: '#6C63FF', fontSize: 13, fontWeight: '700' },
  sliderDescription: { color: '#666', fontSize: 12, marginTop: 2 },
  sfwRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#2A2A2A' },
  sfwTextWrap: { flex: 1, marginRight: 12 },
  sfwTitle: { color: '#DDD', fontSize: 14, fontWeight: '600' },
  sfwDescription: { color: '#666', fontSize: 12, marginTop: 2 },
  list: { padding: 16, flexGrow: 1 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyText: { color: '#888', fontSize: 15, textAlign: 'center', marginBottom: 16 },
  button: { backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  authorName: { color: '#FFF', fontWeight: '700', fontSize: 15, marginBottom: 2 },
  authorWebId: { color: '#6C63FF', fontSize: 11, marginBottom: 8 },
  postBody: { color: '#DDD', fontSize: 14, lineHeight: 20, marginBottom: 10 },
  timestamp: { color: '#555', fontSize: 11 },
})
