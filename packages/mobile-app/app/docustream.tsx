import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSolid } from '../src/contexts/SolidContext';
import { DocustreamManager } from '@nodezero/solid-pod-sync';
import type { StreamItem } from '@nodezero/solid-pod-sync';

type StreamSource = 'reddit' | 'x' | 'nodezero' | 'rss';
type FilterType = 'all' | 'reddit' | 'x' | 'rss';

const MOCK_DOCUSTREAM: StreamItem[] = [
  {
    id: '1',
    source: 'reddit',
    author: 'r/solid',
    title: 'New Community Solid Server v7.0 Released',
    content:
      'The CSS team just pushed a massive update adding better support for nested LDP containers and WebSockets.',
    timestamp: '10 mins ago',
  },
  {
    id: '2',
    source: 'x',
    author: '@NodeZeroApp',
    content:
      'Just deployed the new Zero-Knowledge Proof verifiers to the Soroban Testnet! Privacy is a human right. #Web3 #Stellar',
    timestamp: '2 hours ago',
  },
  {
    id: '3',
    source: 'nodezero',
    author: 'Local Node System',
    content: 'You crossed paths with 3 verified humans in the H3 Grid today.',
    timestamp: '5 hours ago',
  },
  {
    id: '4',
    source: 'rss',
    author: 'Tim Berners-Lee Blog',
    title: 'The Paradigm Shift of Data Ownership',
    content:
      'We are reaching a tipping point where users are demanding the keys to their own digital backpacks...',
    timestamp: '1 day ago',
  },
];

function getSourceIcon(source: StreamSource) {
  switch (source) {
    case 'reddit':
      return <Ionicons name="chatbubble-ellipses" size={20} color="#F97316" />;
    case 'x':
      return <Ionicons name="logo-twitter" size={20} color="#60A5FA" />;
    case 'rss':
      return <Ionicons name="radio" size={20} color="#FB923C" />;
    case 'nodezero':
      return <Ionicons name="globe" size={20} color="#6366F1" />;
    default:
      return <Ionicons name="document-text" size={20} color="#6B7280" />;
  }
}

const FILTERS: FilterType[] = ['all', 'reddit', 'x', 'rss'];

export default function DocustreamScreen() {
  const { isLoggedIn, webId, session } = useSolid();
  const [filter, setFilter] = useState<FilterType>('all');
  const [items, setItems] = useState<StreamItem[]>(MOCK_DOCUSTREAM);
  const [loadingPod, setLoadingPod] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoggedIn || !webId) return;
    const podRoot = webId.split('/profile/')[0] + '/';
    setLoadingPod(true);
    const manager = new DocustreamManager(session);
    manager
      .listActivities(podRoot)
      .then((podItems) => {
        if (podItems.length > 0) setItems(podItems);
      })
      .catch(() => {
        // Keep mock fallback on error
      })
      .finally(() => setLoadingPod(false));
  }, [isLoggedIn, webId]);

  const filteredStream =
    filter === 'all' ? items : items.filter(item => item.source === filter);

  const handleSaveToPod = async (item: StreamItem): Promise<void> => {
    if (!isLoggedIn || !webId) {
      Alert.alert('Sign in required', 'Sign in to save docustream items to your Pod.');
      return;
    }

    const podRoot = webId.split('/profile/')[0] + '/';
    const manager = new DocustreamManager(session);

    setSavingItemId(item.id);
    try {
      await manager.appendActivity(podRoot, item);
      Alert.alert('Saved', 'This item was written to your Solid Pod.');
    } catch (err) {
      console.error('[DocustreamScreen] handleSaveToPod error:', err);
      Alert.alert('Save failed', 'Could not save this item to your Pod.');
    } finally {
      setSavingItemId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Docustream</Text>
          <Text style={styles.headerSubtitle}>Aggregated &amp; Stored in your Pod</Text>
        </View>
        <TouchableOpacity
          onPress={() => Alert.alert('Coming soon', 'Adding new docustream sources will be enabled in a later phase.')}
          style={styles.addButton}
        >
          <Ionicons name="add-circle" size={28} color="#2563EB" />
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                {f.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Timeline */}
      <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
        {filteredStream.map(item => (
          <View key={item.id} style={styles.card}>
            {/* Card header: icon + author + timestamp */}
            <View style={styles.cardRow}>
              <View style={styles.cardAuthorRow}>
                {getSourceIcon(item.source)}
                <Text style={styles.cardAuthor}>{item.author}</Text>
              </View>
              <Text style={styles.cardTimestamp}>{item.timestamp}</Text>
            </View>

            {item.title ? <Text style={styles.cardTitle}>{item.title}</Text> : null}
            <Text style={styles.cardContent}>{item.content}</Text>

            {/* Action links */}
            <View style={styles.cardActions}>
              <TouchableOpacity
                style={styles.actionLink}
                onPress={() => void handleSaveToPod(item)}
                disabled={savingItemId === item.id}
              >
                <Ionicons name="bookmark-outline" size={16} color="#6B7280" />
                <Text style={styles.actionText}>
                  {savingItemId === item.id ? 'Saving…' : 'Save to Pod'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionLink}
                onPress={() => Alert.alert('Coming soon', 'Grid sharing is not yet implemented.')}
              >
                <Ionicons name="share-social-outline" size={16} color="#6B7280" />
                <Text style={styles.actionText}>Share to Grid</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  addButton: {
    padding: 4,
  },
  filterRow: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  filterContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    flexDirection: 'row',
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  timeline: {
    flex: 1,
  },
  timelineContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardAuthor: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginLeft: 8,
  },
  cardTimestamp: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  cardContent: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  actionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6B7280',
    marginLeft: 4,
  },
});
