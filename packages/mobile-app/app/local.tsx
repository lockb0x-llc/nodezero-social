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

interface LocalMessage {
  id: string
  senderWebId: string
  body: string
  timestamp: string
}

export default function LocalNodeScreen(): JSX.Element {
  const { currentNode, surroundingNodes, locationStatus, refresh } = useDiscovery()
  const { webId, isLoggedIn, isRestoring } = useSolid()
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const relayUrl = appExtra?.relayUrl ?? ''

  const [message, setMessage] = useState('')
  const [targetWebId, setTargetWebId] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [sending, setSending] = useState(false)
  const [relayState, setRelayState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [relayError, setRelayError] = useState<string | null>(null)
  const [openPeers, setOpenPeers] = useState<Record<string, boolean>>({})

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
          📍 Location access is required to join a Local Node.{'\n'}
          Please grant permission in your device settings.
        </Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => void refresh()}>
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
        <Text style={styles.nodeTitle}>📍 Your Local Node</Text>
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
              {item.isOrigin ? '📍 ' : ''}{item.h3Index.slice(-6)}
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
              No messages yet. Be the first to say hello to your neighbourhood! 👋
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
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#0D0D0D' },
  infoText: { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 12 },
  refreshBtn: { marginTop: 16, backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  refreshBtnText: { color: '#FFF', fontWeight: '700' },
  nodeHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  nodeTitle: { color: '#FFF', fontWeight: '800', fontSize: 16 },
  nodeIndex: { color: '#6C63FF', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, marginTop: 4 },
  nodeSubtitle: { color: '#666', fontSize: 12, marginTop: 2 },
  cellStrip: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: '#1E1E1E' },
  cellStripContent: { paddingHorizontal: 12, alignItems: 'center' },
  cellChip: { backgroundColor: '#1E1E1E', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, marginRight: 6 },
  cellChipOrigin: { backgroundColor: '#2E2060' },
  cellChipText: { color: '#AAA', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  messageList: { flex: 1 },
  messageListContent: { padding: 12, flexGrow: 1, justifyContent: 'flex-end' },
  emptyMessages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
  messageBubble: { backgroundColor: '#1A1A1A', borderRadius: 10, padding: 12, marginBottom: 8 },
  messageSender: { color: '#6C63FF', fontSize: 11, marginBottom: 4 },
  messageBody: { color: '#DDD', fontSize: 14, lineHeight: 20 },
  messageTime: { color: '#555', fontSize: 10, marginTop: 4, textAlign: 'right' },
  targetInput: {
    width: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFF',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  systemText: { color: '#8C80B3', fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  errorText: { color: '#FF7A7A', fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E1E1E',
    backgroundColor: '#0D0D0D',
  },
  composeInput: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFF',
    fontSize: 14,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  sendBtn: {
    marginLeft: 8,
    backgroundColor: '#6C63FF',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#FFF', fontSize: 20, fontWeight: '900', lineHeight: 24 },
})
