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
} from 'react-native'
import { useSolid } from '../src/contexts/SolidContext'
import { useRouter } from 'expo-router'

interface FeedPost {
  id: string
  authorWebId: string
  authorName: string
  body: string
  createdAt: string
}

export default function GlobalFeedScreen(): JSX.Element {
  const { isLoggedIn, session } = useSolid()
  const router = useRouter()
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchFeed = useCallback(async () => {
    if (!isLoggedIn) return

    try {
      /**
       * TODO: Implement full feed aggregation.
       * The real implementation will:
       * 1. Load the user's SocialGraph (foaf:knows) from their Pod.
       * 2. For each connected WebID, fetch their `posts/` container from their Pod.
       * 3. Merge and sort chronologically.
       *
       * Using placeholder data to demonstrate the UI contract.
       */
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      setPosts(PLACEHOLDER_POSTS)
    } catch (err) {
      console.error('[GlobalFeedScreen] fetchFeed error:', err)
    }
  }, [isLoggedIn, session])

  useEffect(() => {
    void fetchFeed().finally(() => setLoading(false))
  }, [fetchFeed])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await fetchFeed()
    setRefreshing(false)
  }, [fetchFeed])

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
    </View>
  )
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

const PLACEHOLDER_POSTS: FeedPost[] = [
  {
    id: '1',
    authorWebId: 'https://alice.solidcommunity.net/profile/card#me',
    authorName: 'Alice',
    body: 'Just set up my NodeZero profile! Finally a social network that respects my data. 🌐',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: '2',
    authorWebId: 'https://bob.solidcommunity.net/profile/card#me',
    authorName: 'Bob',
    body: 'Love the H3 Local Node idea. Found three neighbours within 100m 🔬',
    createdAt: new Date(Date.now() - 300_000).toISOString(),
  },
]

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
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
