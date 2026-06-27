/**
 * LocalNodeScreen
 *
 * Shows active users within the same H3 hexagonal cell or its immediate ring.
 * Uses `@nodezero/geo-discovery` to determine the local node and broadcasts
 * ephemeral messages over the P2P WebRTC channel.
 *
 * Privacy note: the raw GPS coordinate is NEVER displayed or transmitted.
 * Only the H3 cell index is shared.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { useDiscovery } from '../src/contexts/DiscoveryContext'
import { useSolid } from '../src/contexts/SolidContext'
import Constants from 'expo-constants'
import { P2PChannel, SignalRelay, type SignalMessage } from '@nodezero/p2p-comms'
import { SocialGraph } from '@nodezero/solid-pod-sync'
import { aesthetic } from '../src/theme/aesthetic'
import { Ionicons } from '@expo/vector-icons'

interface LocalMessage {
  id: string
  senderWebId: string
  body: string
  timestamp: string
}

function getSolidAuthMode(): 'external-css' | 'jss-local' {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return appExtra?.solidAuthMode === 'jss-local' ? 'jss-local' : 'external-css'
}

export default function LocalNodeScreen(): JSX.Element {
  const { currentNode, surroundingNodes, locationStatus, refresh } = useDiscovery()
  const { webId, isLoggedIn, isRestoring, session } = useSolid()
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const relayUrl = appExtra?.relayUrl ?? ''
  const usesJssLocal = getSolidAuthMode() === 'jss-local'
  const authModeLabel = usesJssLocal ? 'JSS Local' : 'External CSS'

  const [message, setMessage] = useState('')
  const [targetWebId, setTargetWebId] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [sending, setSending] = useState(false)
  const [relayState, setRelayState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [relayError, setRelayError] = useState<string | null>(null)
  const [openPeers, setOpenPeers] = useState<Record<string, boolean>>({})
  const [knownPeers, setKnownPeers] = useState<string[]>([])
  const [showAuthModeHint, setShowAuthModeHint] = useState(false)

  const relayRef = useRef<SignalRelay | null>(null)
  const channelsRef = useRef<Map<string, P2PChannel>>(new Map())

  const upsertChannel = useCallback((remoteWebId: string): P2PChannel | null => {
    if (!webId) return null
    const existing = channelsRef.current.get(remoteWebId)
    if (existing) return existing

    const channel = new P2PChannel({ localWebId: webId, remoteWebId })

    channel.on('message', (incoming) => {
      setMessages((prev) => [incoming, ...prev])
    })

    channel.on('open', () => {
      setOpenPeers((prev) => ({ ...prev, [remoteWebId]: true }))
    })

    channel.on('close', () => {
      setOpenPeers((prev) => ({ ...prev, [remoteWebId]: false }))
    })

    channel.on('iceCandidate', (candidate) => {
      if (!relayRef.current || !webId) return
      relayRef.current.send({
        type: 'ice-candidate',
        from: webId,
        to: remoteWebId,
        payload: candidate,
      })
    })

    channel.on('error', (err) => {
      console.warn('[LocalNodeScreen] P2P channel error:', err)
    })

    channelsRef.current.set(remoteWebId, channel)
    return channel
  }, [webId])

  useEffect(() => {
    if (!isLoggedIn || !webId || !relayUrl) {
      setRelayState('idle')
      return
    }

    setRelayState('connecting')
    setRelayError(null)

    const relay = new SignalRelay({ relayUrl, localWebId: webId })
    relayRef.current = relay

    relay.on('connected', () => {
      setRelayState('connected')
      setRelayError(null)
    })

    relay.on('disconnected', () => {
      setRelayState('idle')
    })

    relay.on('error', (err) => {
      setRelayState('error')
      setRelayError(err.message)
    })

    relay.on('signal', (signal: SignalMessage) => {
      void (async (): Promise<void> => {
        if (!webId || signal.to !== webId) return
        const channel = upsertChannel(signal.from)
        if (!channel || !relayRef.current) return

        try {
          if (signal.type === 'offer') {
            await channel.receiveOffer(signal.payload as RTCSessionDescriptionInit)
            const answer = await channel.createAnswer()
            relayRef.current.send({
              type: 'answer',
              from: webId,
              to: signal.from,
              payload: answer,
            })
            return
          }

          if (signal.type === 'answer') {
            await channel.receiveAnswer(signal.payload as RTCSessionDescriptionInit)
            return
          }

          await channel.addIceCandidate(signal.payload as RTCIceCandidateInit)
        } catch (err) {
          console.warn('[LocalNodeScreen] Failed to process signal:', err)
        }
      })()
    })

    relay.connect()

    return () => {
      relay.disconnect()
      relayRef.current = null
      for (const channel of channelsRef.current.values()) {
        channel.close()
      }
      channelsRef.current.clear()
      setOpenPeers({})
    }
  }, [isLoggedIn, relayUrl, upsertChannel, webId])

  useEffect(() => {
    if (!isLoggedIn || !webId) {
      setKnownPeers([])
      return
    }

    const socialGraph = new SocialGraph(session)
    const podRoot = webId.split('/profile/')[0] + '/'

    void socialGraph
      .listConnections(podRoot)
      .then((connections) => {
        setKnownPeers(connections.map((connection) => connection.webId).filter((peer) => peer !== webId))
      })
      .catch(() => {
        setKnownPeers([])
      })
  }, [isLoggedIn, session, webId])

  const sendMessage = useCallback(async () => {
    if (!message.trim() || !webId || !targetWebId.trim()) return
    if (!relayRef.current || relayState !== 'connected') {
      setRelayError('Relay is not connected yet. Please wait and retry.')
      return
    }

    setSending(true)

    const target = targetWebId.trim()

    try {
      const channel = upsertChannel(target)
      if (!channel) return

      if (!openPeers[target]) {
        const offer = await channel.createOffer()
        relayRef.current.send({
          type: 'offer',
          from: webId,
          to: target,
          payload: offer,
        })
        setRelayError('Establishing secure channel. Tap send again once connected.')
        return
      }

      const sent = channel.send(message.trim())
      setMessages((prev) => [sent, ...prev])
      setMessage('')
      setRelayError(null)
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : 'Failed to send message.')
      console.warn('[LocalNodeScreen] sendMessage error:', err)
    } finally {
      setSending(false)
    }
  }, [message, openPeers, relayState, targetWebId, upsertChannel, webId])

  if (isRestoring) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
        <Text style={styles.infoText}>Restoring your session…</Text>
      </View>
    )
  }

  if (!isLoggedIn) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Sign in to join your Local Node.</Text>
      </View>
    )
  }

  if (locationStatus === 'requesting' || locationStatus === 'idle') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
        <Text style={styles.infoText}>Detecting your Local Node…</Text>
      </View>
    )
  }

  if (locationStatus === 'denied' || locationStatus === 'unavailable') {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>
          Location access is required to join a Local Node.{"\n"}
          Please grant permission in your device settings.
        </Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => void refresh()}
          activeOpacity={aesthetic.motion.pressOpacity}
        >
          <Text style={styles.refreshBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Node info header */}
      <View style={styles.nodeHeader}>
        <View style={styles.nodeHeaderTop}>
          <View style={styles.nodeTitleRow}>
            <Ionicons name="location" size={16} color={aesthetic.color.accentSoft} />
            <Text style={styles.nodeTitle}>Your Local Node</Text>
          </View>
          <View style={styles.nodeHeaderRight}>
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
          </View>
        </View>
        {showAuthModeHint ? (
          <Text style={styles.authModeHintText}>
            {usesJssLocal
              ? 'JSS Local: uses bootstrap WebID sign-in without provider redirect.'
              : 'External CSS: uses standard Solid OIDC provider redirect.'}
          </Text>
        ) : null}
        {currentNode && (
          <>
            <Text style={styles.nodeIndex}>{currentNode.h3Index}</Text>
            <Text style={styles.nodeSubtitle}>
              {surroundingNodes.length} hex cells active · resolution {currentNode.resolution}
            </Text>
          </>
        )}
      </View>

      {/* Nearby cells strip */}
      <FlatList
        horizontal
        data={surroundingNodes}
        keyExtractor={(n) => n.h3Index}
        style={styles.cellStrip}
        contentContainerStyle={styles.cellStripContent}
        renderItem={({ item }) => (
          <View style={[styles.cellChip, item.isOrigin && styles.cellChipOrigin]}>
            <Text style={styles.cellChipText} numberOfLines={1}>
              {item.isOrigin ? 'Here ' : ''}{item.h3Index.slice(-6)}
            </Text>
          </View>
        )}
      />

      {/* Message feed */}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        ListEmptyComponent={
          <View style={styles.emptyMessages}>
            <Text style={styles.infoText}>
              No messages yet. Start the first local check-in.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.messageBubble}>
            <Text style={styles.messageSender} numberOfLines={1}>{item.senderWebId}</Text>
            <Text style={styles.messageBody}>{item.body}</Text>
            <Text style={styles.messageTime}>{new Date(item.timestamp).toLocaleTimeString()}</Text>
          </View>
        )}
      />

      {knownPeers.length > 0 && (
        <View style={styles.peerRow}>
          <Text style={styles.peerRowLabel}>Known peers</Text>
          <FlatList
            horizontal
            data={knownPeers}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const selected = targetWebId.trim() === item
              return (
                <TouchableOpacity
                  onPress={() => setTargetWebId(item)}
                  style={[styles.peerChip, selected && styles.peerChipSelected]}
                  activeOpacity={aesthetic.motion.pressOpacity}
                >
                  <Text
                    style={[styles.peerChipText, selected && styles.peerChipTextSelected]}
                    numberOfLines={1}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              )
            }}
          />
        </View>
      )}

      {/* Compose row */}
      <View style={styles.composeRow}>
        <TextInput
          style={styles.targetInput}
          value={targetWebId}
          onChangeText={setTargetWebId}
          placeholder="Recipient WebID"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Recipient WebID"
        />
      </View>

      {relayState !== 'connected' && (
        <Text style={styles.systemText}>
          {relayState === 'connecting' ? 'Connecting to secure relay…' : 'Relay disconnected.'}
        </Text>
      )}
      {relayError && <Text style={styles.errorText}>{relayError}</Text>}

      <View style={styles.composeRow}>
        <TextInput
          style={styles.composeInput}
          value={message}
          onChangeText={setMessage}
          placeholder="Send encrypted message…"
          placeholderTextColor="#555"
          multiline
          maxLength={280}
          accessibilityLabel="Message input"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled]}
          onPress={() => void sendMessage()}
          disabled={!message.trim() || sending || !targetWebId.trim()}
          activeOpacity={aesthetic.motion.pressOpacity}
          accessibilityRole="button"
          accessibilityLabel="Send message"
        >
          <Text style={styles.sendBtnText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: aesthetic.color.bgNight },
  infoText: { color: aesthetic.color.textMid, fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 12 },
  refreshBtn: { marginTop: 16, backgroundColor: aesthetic.color.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  refreshBtnText: { color: '#FFF', fontWeight: '700' },
  nodeHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  nodeHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nodeTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nodeHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nodeTitle: { color: aesthetic.color.textHigh, fontWeight: '800', fontSize: 16 },
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
  authModeHintText: { color: aesthetic.color.textMid, fontSize: 12, lineHeight: 17, marginTop: 8 },
  nodeIndex: { color: aesthetic.color.accentSoft, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginTop: 4 },
  nodeSubtitle: { color: aesthetic.color.textLow, fontSize: 12, marginTop: 2 },
  cellStrip: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  cellStripContent: { paddingHorizontal: 12, alignItems: 'center' },
  cellChip: { backgroundColor: aesthetic.color.surface, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6 },
  cellChipOrigin: { backgroundColor: '#2E2060' },
  cellChipText: { color: aesthetic.color.textMid, fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  messageList: { flex: 1 },
  messageListContent: { padding: 12, flexGrow: 1, justifyContent: 'flex-end' },
  emptyMessages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
  messageBubble: { backgroundColor: aesthetic.color.surface, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: aesthetic.color.border },
  messageSender: { color: aesthetic.color.accentSoft, fontSize: 11, marginBottom: 4 },
  messageBody: { color: aesthetic.color.textMid, fontSize: 14, lineHeight: 20 },
  messageTime: { color: aesthetic.color.textLow, fontSize: 10, marginTop: 4, textAlign: 'right' },
  peerRow: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
  peerRowLabel: { color: '#666', fontSize: 11, marginBottom: 6 },
  peerChip: {
    backgroundColor: aesthetic.color.surface,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    maxWidth: 240,
  },
  peerChipSelected: { borderColor: '#6C63FF' },
  peerChipText: { color: aesthetic.color.textMid, fontSize: 11 },
  peerChipTextSelected: { color: aesthetic.color.textHigh },
  targetInput: {
    width: '100%',
    backgroundColor: aesthetic.color.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: aesthetic.color.textHigh,
    fontSize: 13,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
  },
  systemText: { color: aesthetic.color.textMid, fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  errorText: { color: '#FF7A7A', fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
    backgroundColor: aesthetic.color.bgNight,
  },
  composeInput: {
    flex: 1,
    backgroundColor: aesthetic.color.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: aesthetic.color.textHigh,
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: aesthetic.color.accent,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#FFF', fontSize: 20, fontWeight: '900', lineHeight: 24 },
})
