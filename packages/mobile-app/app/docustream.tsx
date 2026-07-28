import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  SafeAreaView,
  Alert,
  Platform,
  Modal,
  TextInput,
  Switch,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as rssParser from 'react-native-rss-parser'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import {
  createSyncState,
  mergeAndQueryActivities,
  queryStreamItems,
  type DocustreamSource,
  type QueryableStreamItem,
  type StreamItem,
} from '@nodezero/solid-pod-sync'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { getMashlibWebAdapter } from '../src/solid/mashlibWebAdapter'
import { loadSyncCheckpoint, saveSyncCheckpoint } from '../src/solid/syncCheckpointStore'
import { getProvisionerBaseUrl } from '../src/onboarding/seamlessSignup'
import { aesthetic } from '../src/theme/aesthetic'

type FilterType = 'all' | 'reddit' | 'x' | 'rss'

const FILTERS: FilterType[] = ['all', 'reddit', 'x', 'rss']

const DEFAULT_RSS_PRESETS: Array<{ title: string; url: string }> = [
  {
    title: 'W3C News',
    url: 'https://www.w3.org/news/feed/',
  },
  {
    title: 'Hacker News Front Page',
    url: 'https://hnrss.org/frontpage',
  },
  {
    title: 'The Verge RSS',
    url: 'https://www.theverge.com/rss/index.xml',
  },
]

const DOCUSTREAM_LOCKED = false

function getSourceIcon(source: StreamItem['source']): JSX.Element {
  switch (source) {
    case 'reddit':
      return <Ionicons name="chatbubble-ellipses" size={20} color="#F97316" />
    case 'x':
      return <Ionicons name="logo-twitter" size={20} color="#60A5FA" />
    case 'rss':
      return <Ionicons name="radio" size={20} color="#FB923C" />
    case 'nodezero':
    default:
      return <Ionicons name="globe" size={20} color="#6366F1" />
  }
}

function normalizeToIsoTimestamp(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return new Date().toISOString()
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function normalizeContent(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''
  return value || 'No description provided.'
}

function extractRssLink(item: Record<string, unknown>): string | undefined {
  const direct = typeof item.link === 'string' ? item.link.trim() : ''
  if (direct) return direct

  const links = Array.isArray(item.links) ? item.links : []
  for (const candidate of links) {
    if (!candidate || typeof candidate !== 'object') continue
    const url = typeof (candidate as Record<string, unknown>).url === 'string'
      ? ((candidate as Record<string, unknown>).url as string).trim()
      : ''
    if (url) return url
  }

  return undefined
}

function streamItemId(sourceId: string, item: Record<string, unknown>, index: number): string {
  const link = extractRssLink(item) ?? ''
  const title = typeof item.title === 'string' ? item.title : ''
  const published = normalizeToIsoTimestamp(item.published ?? item.pubDate ?? item.isoDate)
  const raw = `${sourceId}|${published}|${title}|${link}|${index}`

  let hash = 2166136261
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return `rss_${sourceId}_${(hash >>> 0).toString(36)}`
}

function sourceLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

interface ProvisionerRssFetchResult {
  url: string
  xml: string
}

async function fetchRssXmlViaProvisioner(sourceUrl: string): Promise<string> {
  const provisionerUrl = getProvisionerBaseUrl()
  if (!provisionerUrl) {
    throw new Error('Docustream ingest proxy is not configured for this build.')
  }

  const response = await fetch(`${provisionerUrl}/v1/docustream/rss-fetch`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  const payloadText = await response.text()
  if (!response.ok) {
    let parsedError = ''
    try {
      const payload = JSON.parse(payloadText) as { error?: string }
      parsedError = typeof payload.error === 'string' ? payload.error : ''
    } catch {
      // Fall through with default message.
    }
    throw new Error(parsedError || `RSS retrieval failed with HTTP ${response.status}`)
  }

  const payload = JSON.parse(payloadText) as ProvisionerRssFetchResult
  if (!payload?.xml || typeof payload.xml !== 'string') {
    throw new Error('RSS retrieval returned no XML payload.')
  }

  return payload.xml
}

export default function DocustreamScreen(): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const isLoggedIn = status === 'authenticated'
  const [filter, setFilter] = useState<FilterType>('all')
  const [items, setItems] = useState<QueryableStreamItem[]>([])
  const [savingItemId, setSavingItemId] = useState<string | null>(null)
  const [adapterPaneLabels, setAdapterPaneLabels] = useState<string[]>([])
  const [isSyncCheckpointReady, setIsSyncCheckpointReady] = useState(false)
  const [sources, setSources] = useState<DocustreamSource[]>([])
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false)
  const [sourceUrlInput, setSourceUrlInput] = useState('')
  const [pendingSourceTitle, setPendingSourceTitle] = useState<string | null>(null)
  const [sourceModalError, setSourceModalError] = useState<string | null>(null)
  const [isIngesting, setIsIngesting] = useState(false)
  const [sourceOperationId, setSourceOperationId] = useState<string | null>(null)

  const syncStateRef = useRef(createSyncState())

  const effectiveWebId = webId

  const podRoot = useMemo(() => {
    if (!effectiveWebId) return ''
    return `${effectiveWebId.split('/profile/')[0]}/`
  }, [effectiveWebId])

  // Session invariant: authenticated ⇔ live Pod access through the proxy.
  // The old canOperateDocustream / nodeSession fallback lattice is gone.

  const loadSources = useCallback(async (): Promise<void> => {
    if (!isLoggedIn || !podRoot) {
      setSources([])
      return
    }

    try {
      const { docustreamSourceManager } = getSolidPodSyncManagers({ fetch: authFetch })
      const nextSources = await docustreamSourceManager.listSources(podRoot)
      setSources(nextSources)
      setSourceModalError(null)
    } catch (error) {
      setSources([])
      setSourceModalError(
        error instanceof Error ? error.message : 'Unable to load DocuStream sources from your Pod.',
      )
    }
  }, [authFetch, isLoggedIn, podRoot])

  const loadDocustreamItems = useCallback(async (): Promise<void> => {
    if (!isLoggedIn || !podRoot || !isSyncCheckpointReady || !effectiveWebId) {
      setItems([])
      return
    }

    const { docustreamManager } = getSolidPodSyncManagers({ fetch: authFetch })
    const podItems = await docustreamManager.listActivities(podRoot)

    const merged = mergeAndQueryActivities(
      [
        {
          sourceWebId: effectiveWebId,
          items: podItems.map((item) => ({ ...item, authorWebId: effectiveWebId })),
        },
      ],
      {
        state: syncStateRef.current,
        query: {
          limit: 500,
        },
      }
    )

    syncStateRef.current = merged.sync.nextState
    await saveSyncCheckpoint(effectiveWebId, 'docustream', syncStateRef.current)
    setItems(merged.items)
  }, [authFetch, effectiveWebId, isLoggedIn, isSyncCheckpointReady, podRoot])

  const ingestOneSource = useCallback(async (source: DocustreamSource): Promise<void> => {
    if (!podRoot || !source.enabled || !isLoggedIn) return

    const { docustreamManager, docustreamSourceManager } = getSolidPodSyncManagers({ fetch: authFetch })

    try {
      let xml = ''
      if (Platform.OS === 'web') {
        xml = await fetchRssXmlViaProvisioner(source.url)
      } else {
        const response = await fetch(source.url, {
          headers: { Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8' },
        })
        if (!response.ok) {
          throw new Error(`Fetch failed with HTTP ${response.status}`)
        }
        xml = await response.text()
      }

      const parsed = await rssParser.parse(xml)
      const feedItems = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 25)

      for (let index = 0; index < feedItems.length; index += 1) {
        const candidate = feedItems[index] as unknown as Record<string, unknown>
        const streamItem: StreamItem = {
          id: streamItemId(source.id, candidate, index),
          source: 'rss',
          author:
            (typeof candidate.creator === 'string' && candidate.creator.trim()) ||
            source.title ||
            sourceLabelFromUrl(source.url),
          title:
            typeof candidate.title === 'string' && candidate.title.trim()
              ? candidate.title.trim()
              : undefined,
          content: normalizeContent(candidate.description ?? candidate.content),
          timestamp: normalizeToIsoTimestamp(candidate.published ?? candidate.pubDate ?? candidate.isoDate),
          url: extractRssLink(candidate),
        }

        await docustreamManager.appendActivity(podRoot, streamItem)
      }

      await docustreamSourceManager.recordIngestionResult(podRoot, source.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown ingest error'
      await docustreamSourceManager.recordIngestionResult(podRoot, source.id, message)
    }
  }, [authFetch, isLoggedIn, podRoot])

  const ingestEnabledSources = useCallback(async (sourceList: DocustreamSource[] = sources): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      Alert.alert('DocuStream locked', 'DocuStream ingest is temporarily disabled.')
      return
    }
    if (!isLoggedIn || !podRoot) return

    const enabled = sourceList.filter((source) => source.enabled)
    if (enabled.length === 0) return

    setIsIngesting(true)
    try {
      for (const source of enabled) {
        await ingestOneSource(source)
      }
      await loadSources()
      await loadDocustreamItems()
    } finally {
      setIsIngesting(false)
    }
  }, [ingestOneSource, isLoggedIn, loadDocustreamItems, loadSources, podRoot, sources])

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

    void loadSyncCheckpoint(webId, 'docustream')
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

  useEffect((): void => {
    void loadSources()
  }, [loadSources])

  useEffect((): void => {
    if (!isSourceModalOpen) return
    void loadSources()
  }, [isSourceModalOpen, loadSources])

  useEffect((): void => {
    void loadDocustreamItems()
  }, [loadDocustreamItems])

  useEffect((): void => {
    if (!isSyncCheckpointReady) return
    if (!isLoggedIn) return
    void ingestEnabledSources()
  }, [ingestEnabledSources, isLoggedIn, isSyncCheckpointReady])

  useEffect((): void => {
    if (!isLoggedIn || !effectiveWebId || Platform.OS !== 'web') return

    const adapter = getMashlibWebAdapter()
    if (!adapter.isSupported) {
      setAdapterPaneLabels([])
      return
    }

    const resourceUrl = `${effectiveWebId.split('/profile/')[0]}/public/docustream/`
    void adapter
      .listBoundPanes(resourceUrl)
      .then((binding) => {
        setAdapterPaneLabels(binding.panes.map((pane) => pane.label))
      })
      .catch(() => {
        setAdapterPaneLabels([])
      })
  }, [effectiveWebId, isLoggedIn])

  const filteredStream =
    filter === 'all' ? items : queryStreamItems(items, { sources: [filter] })

  const handleSaveToPod = async (item: StreamItem): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      Alert.alert('DocuStream locked', 'DocuStream writes are temporarily disabled.')
      return
    }

    if (!isLoggedIn || !effectiveWebId || !podRoot) {
      Alert.alert('Sign in required', 'Sign in to save Downstream items to your Pod.')
      return
    }

    const { docustreamManager } = getSolidPodSyncManagers({ fetch: authFetch })

    setSavingItemId(item.id)
    try {
      await docustreamManager.appendActivity(podRoot, item)
      Alert.alert('Saved', 'This item was written to your Solid Pod.')
    } catch (err) {
      console.error('[DocustreamScreen] handleSaveToPod error:', err)
      Alert.alert('Save failed', 'Could not save this item to your Pod.')
    } finally {
      setSavingItemId(null)
    }
  }

  const handleAddSource = useCallback(async (url: string, title?: string): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      setSourceModalError('DocuStream source management is temporarily disabled.')
      Alert.alert('DocuStream locked', 'DocuStream source management is temporarily disabled.')
      return
    }

    if (!isLoggedIn || !podRoot) {
      setSourceModalError('Sign in to manage Docustream sources.')
      Alert.alert('Sign in required', 'Sign in to manage Docustream sources.')
      return
    }

    setSourceOperationId('new-source')
    try {
      const { docustreamSourceManager } = getSolidPodSyncManagers({ fetch: authFetch })
      const savedSource = await docustreamSourceManager.upsertSource(podRoot, {
        type: 'rss',
        url,
        title,
      })
      setSources((currentSources) => [
        savedSource,
        ...currentSources.filter((source) => source.id !== savedSource.id),
      ])
      setSourceModalError(null)
      setSourceUrlInput('')
      setPendingSourceTitle(null)
      Alert.alert('Source added', 'RSS source saved to your Pod. Ingestion will continue in the background.')
      void ingestEnabledSources([savedSource])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to add source.'
      setSourceModalError(message)
      Alert.alert('Add source failed', message)
    } finally {
      setSourceOperationId(null)
    }
  }, [authFetch, ingestEnabledSources, isLoggedIn, podRoot])

  const handleSourceInputChange = useCallback((nextValue: string): void => {
    setSourceUrlInput(nextValue)
    setPendingSourceTitle(null)
    setSourceModalError(null)
  }, [])

  const handlePresetSelect = useCallback((preset: { title: string; url: string }): void => {
    setSourceUrlInput(preset.url)
    setPendingSourceTitle(preset.title)
    setSourceModalError(null)
  }, [])

  const handleToggleSource = useCallback(async (source: DocustreamSource, nextEnabled: boolean): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      Alert.alert('DocuStream locked', 'DocuStream source management is temporarily disabled.')
      return
    }

    if (!isLoggedIn || !podRoot) return

    setSourceOperationId(source.id)
    try {
      const { docustreamSourceManager } = getSolidPodSyncManagers({ fetch: authFetch })
      await docustreamSourceManager.setSourceEnabled(podRoot, source.id, nextEnabled)
      await loadSources()
      if (nextEnabled) {
        await ingestEnabledSources()
      }
    } catch {
      Alert.alert('Update failed', 'Could not update source state.')
    } finally {
      setSourceOperationId(null)
    }
  }, [authFetch, ingestEnabledSources, isLoggedIn, loadSources, podRoot])

  const handleRemoveSource = useCallback(async (source: DocustreamSource): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      Alert.alert('DocuStream locked', 'DocuStream source management is temporarily disabled.')
      return
    }

    if (!isLoggedIn || !podRoot) return

    setSourceOperationId(source.id)
    try {
      const { docustreamSourceManager } = getSolidPodSyncManagers({ fetch: authFetch })
      await docustreamSourceManager.removeSource(podRoot, source.id)
      await loadSources()
      await loadDocustreamItems()
    } catch {
      Alert.alert('Remove failed', 'Could not remove source.')
    } finally {
      setSourceOperationId(null)
    }
  }, [authFetch, isLoggedIn, loadDocustreamItems, loadSources, podRoot])

  const handleIngestSingleSource = useCallback(async (source: DocustreamSource): Promise<void> => {
    if (DOCUSTREAM_LOCKED) {
      Alert.alert('DocuStream locked', 'DocuStream ingest is temporarily disabled.')
      return
    }

    setSourceOperationId(source.id)
    try {
      await ingestOneSource(source)
      await loadSources()
      await loadDocustreamItems()
    } finally {
      setSourceOperationId(null)
    }
  }, [ingestOneSource, loadDocustreamItems, loadSources])

  const emptyStateText = isLoggedIn
    ? DOCUSTREAM_LOCKED
      ? 'DocuStream is currently read-only while we complete a storage refactor.'
      : 'No Docustream items yet. Add an RSS source to start filling your stream.'
    : 'Sign in to load your Docustream from your Pod.'

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Downstream</Text>
          <Text style={styles.headerSubtitle}>Your Aggregated Streams &amp; Curated in your Pod</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => void ingestEnabledSources()}
            style={styles.addButton}
            disabled={isIngesting || !isLoggedIn}
          >
            <Ionicons name="refresh" size={24} color={isIngesting ? aesthetic.color.textLow : aesthetic.color.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsSourceModalOpen(true)}
            style={styles.addButton}
            testID="docustream-sources-open"
            accessibilityLabel="Open Docustream sources"
          >
            <Ionicons name="add-circle" size={28} color="#2563EB" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {FILTERS.map((candidate) => (
            <TouchableOpacity
              key={candidate}
              onPress={() => setFilter(candidate)}
              style={[styles.filterChip, filter === candidate && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === candidate && styles.filterChipTextActive]}>
                {candidate.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {adapterPaneLabels.length > 0 ? (
        <View style={styles.adapterHint}>
          <Text style={styles.adapterHintText}>
            Web explorer panes: {adapterPaneLabels.join(', ')}
          </Text>
        </View>
      ) : null}

      <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
        {filteredStream.length === 0 ? (
          <View style={styles.emptyStateCard}>
            <Text style={styles.emptyStateText}>{emptyStateText}</Text>
          </View>
        ) : null}

        {filteredStream.map((item) => (
          <View key={item.id} style={styles.card}>
            <View style={styles.cardRow}>
              <View style={styles.cardAuthorRow}>
                {getSourceIcon(item.source)}
                <Text style={styles.cardAuthor}>{item.author}</Text>
              </View>
              <Text style={styles.cardTimestamp}>{formatTimestamp(item.timestamp)}</Text>
            </View>

            {item.title ? <Text style={styles.cardTitle}>{item.title}</Text> : null}
            <Text style={styles.cardContent}>{item.content}</Text>

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

      <Modal
        animationType="slide"
        transparent
        visible={isSourceModalOpen}
        onRequestClose={() => setIsSourceModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdropTapArea}
            onPress={() => setIsSourceModalOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close Docustream sources"
          />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Docustream Sources</Text>
            <Text style={styles.modalSubtitle}>Add and manage RSS sources for your Pod-backed stream.</Text>

            <View style={styles.addSourceRow}>
              <TextInput
                style={styles.sourceInput}
                placeholder="https://example.com/feed.xml"
                placeholderTextColor={aesthetic.color.textLow}
                testID="docustream-source-url-input"
                value={sourceUrlInput}
                onChangeText={handleSourceInputChange}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TouchableOpacity
                style={styles.addSourceButton}
                disabled={!sourceUrlInput.trim() || sourceOperationId !== null}
                testID="docustream-source-add"
                onPress={() => void handleAddSource(sourceUrlInput, pendingSourceTitle ?? undefined)}
              >
                <Text style={styles.addSourceButtonText}>Add</Text>
              </TouchableOpacity>
            </View>

            {sourceModalError ? (
              <Text style={styles.sourceErrorText}>
                Add source failed: {sourceModalError}
              </Text>
            ) : null}

            {pendingSourceTitle ? (
              <Text style={styles.selectedPresetText}>Selected preset: {pendingSourceTitle}</Text>
            ) : null}

            <Text style={styles.presetLabel}>Suggested RSS sources</Text>
            <View style={styles.presetGrid}>
              {DEFAULT_RSS_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset.url}
                  style={styles.presetChip}
                  onPress={() => handlePresetSelect(preset)}
                  disabled={sourceOperationId !== null}
                >
                  <Text style={styles.presetChipText}>{preset.title}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sourceListLabel}>Your sources</Text>
            <ScrollView style={styles.sourceList}>
              {sources.length === 0 ? (
                <Text style={styles.sourceEmptyText}>No sources yet.</Text>
              ) : null}

              {sources.map((source) => (
                <View key={source.id} style={styles.sourceCard} testID={`docustream-source-${source.id}`}>
                  <View style={styles.sourceHeader}>
                    <View style={styles.sourceHeaderTextWrap}>
                      <Text style={styles.sourceTitle}>{source.title ?? sourceLabelFromUrl(source.url)}</Text>
                      <Text style={styles.sourceUrl}>{source.url}</Text>
                    </View>
                    <Switch
                      value={source.enabled}
                      onValueChange={(nextEnabled) => void handleToggleSource(source, nextEnabled)}
                      trackColor={{ false: '#333', true: '#6C63FF' }}
                      thumbColor="#FFF"
                      disabled={sourceOperationId === source.id}
                    />
                  </View>

                  <View style={styles.sourceMetaRow}>
                    <Text style={styles.sourceMetaText}>
                      {source.lastError
                        ? `Last error: ${source.lastError}`
                        : source.lastIngestedAt
                          ? `Last ingested: ${formatTimestamp(source.lastIngestedAt)}`
                          : 'Not ingested yet'}
                    </Text>
                  </View>

                  <View style={styles.sourceActionsRow}>
                    <TouchableOpacity
                      style={styles.sourceActionButton}
                      onPress={() => void handleIngestSingleSource(source)}
                      disabled={sourceOperationId === source.id || isIngesting || !source.enabled}
                    >
                      <Text style={styles.sourceActionButtonText}>Ingest now</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sourceActionButtonDanger}
                      testID={`docustream-source-remove-${source.id}`}
                      onPress={() => void handleRemoveSource(source)}
                      disabled={sourceOperationId === source.id}
                    >
                      <Text style={styles.sourceActionButtonText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function formatTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return timestamp
  return new Date(parsed).toLocaleString()
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: aesthetic.color.bgNight,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: aesthetic.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: aesthetic.color.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: aesthetic.color.textHigh,
  },
  headerSubtitle: {
    fontSize: 13,
    color: aesthetic.color.textMid,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addButton: {
    padding: 4,
  },
  filterRow: {
    backgroundColor: aesthetic.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: aesthetic.color.border,
  },
  adapterHint: {
    backgroundColor: aesthetic.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: aesthetic.color.border,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  adapterHintText: {
    color: aesthetic.color.textLow,
    fontSize: 12,
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
    backgroundColor: aesthetic.color.chip,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: aesthetic.color.accent,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: aesthetic.color.textMid,
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
  emptyStateCard: {
    backgroundColor: aesthetic.color.surface,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 14,
    padding: 16,
  },
  emptyStateText: {
    color: aesthetic.color.textMid,
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    backgroundColor: aesthetic.color.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: aesthetic.color.accent,
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
    color: aesthetic.color.textHigh,
    marginLeft: 8,
  },
  cardTimestamp: {
    fontSize: 12,
    color: aesthetic.color.textLow,
    fontWeight: '500',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: aesthetic.color.textHigh,
    marginBottom: 6,
  },
  cardContent: {
    fontSize: 14,
    color: aesthetic.color.textMid,
    lineHeight: 20,
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
  },
  actionLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '500',
    color: aesthetic.color.textLow,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalBackdropTapArea: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: aesthetic.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 22,
    minHeight: 420,
    maxHeight: '90%',
  },
  modalHandle: {
    width: 48,
    height: 5,
    borderRadius: 999,
    backgroundColor: aesthetic.color.border,
    alignSelf: 'center',
    marginBottom: 10,
  },
  modalTitle: {
    color: aesthetic.color.textHigh,
    fontSize: 20,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: aesthetic.color.textMid,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 12,
  },
  addSourceRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  sourceInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: aesthetic.color.textHigh,
  },
  addSourceButton: {
    backgroundColor: aesthetic.color.accent,
    borderRadius: 10,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  addSourceButtonText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  sourceErrorText: {
    marginTop: 8,
    color: '#EF4444',
    fontSize: 13,
    lineHeight: 18,
  },
  selectedPresetText: {
    color: aesthetic.color.textMid,
    fontSize: 12,
    marginBottom: 10,
  },
  presetLabel: {
    color: aesthetic.color.textMid,
    fontSize: 12,
    marginBottom: 8,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: aesthetic.color.chip,
  },
  presetChipText: {
    color: aesthetic.color.textHigh,
    fontSize: 12,
    fontWeight: '600',
  },
  sourceListLabel: {
    color: aesthetic.color.textMid,
    fontSize: 12,
    marginBottom: 8,
  },
  sourceList: {
    maxHeight: 340,
  },
  sourceEmptyText: {
    color: aesthetic.color.textLow,
    fontSize: 13,
  },
  sourceCard: {
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  sourceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sourceHeaderTextWrap: {
    flex: 1,
  },
  sourceTitle: {
    color: aesthetic.color.textHigh,
    fontWeight: '700',
    fontSize: 13,
  },
  sourceUrl: {
    color: aesthetic.color.textLow,
    fontSize: 12,
    marginTop: 2,
  },
  sourceMetaRow: {
    marginTop: 8,
  },
  sourceMetaText: {
    color: aesthetic.color.textLow,
    fontSize: 11,
  },
  sourceActionsRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
  },
  sourceActionButton: {
    backgroundColor: aesthetic.color.accent,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sourceActionButtonDanger: {
    backgroundColor: '#6B1F1F',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  sourceActionButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
})
