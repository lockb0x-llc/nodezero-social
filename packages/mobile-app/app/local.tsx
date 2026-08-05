/**
 * LocalNodeScreen
 *
 * Shows active users within the same H3 hexagonal cell or its immediate ring.
 * Uses `@nodezero/geo-discovery` to determine the local node. Messaging runs
 * over the Waku local mesh when connected (signed envelopes; E2EE DMs once a
 * peer has revealed their DM key), with the legacy WebRTC relay retained as a
 * fallback while the Waku rollout completes (Phase 5 removes it).
 *
 * Privacy note: the raw GPS coordinate is NEVER displayed or transmitted.
 * Only the H3 cell index is shared.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
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
import Constants from 'expo-constants'
import { useDiscovery } from '../src/contexts/DiscoveryContext'
import { getProvisionerUrl, useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { useWallet } from '../src/contexts/WalletContext'
import { usePresence } from '../src/contexts/PresenceContext'
import { useWaku } from '../src/contexts/WakuContext'
import { P2PChannel, SignalRelay, type SignalMessage } from '@nodezero/p2p-comms'
import {
  cellTopic,
  createEncryptedChatBody,
  createEnvelope,
  createPlainChatBody,
  decryptDmBody,
  dmTopic,
  encryptDmBody,
  parseBroadcastBody,
  parseChatBody,
  type InboundMessage,
} from '@nodezero/waku-comms'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { derivePersonActionPolicy } from '../src/social/personActionPolicy'
import { canReceiveDirectedCommunication } from '../src/social/directedCommunicationPolicy'
import { verifyWakuEnvelopeIdentity } from '../src/social/transportIdentityClient'
import { issueTransportIdentityAssertion } from '../src/social/transportIdentityClient'
import { syncRelationshipInbox } from '../src/social/relationshipInboxSync'
import {
  publishBlockStateChanged,
  subscribeBlockStateChanged,
} from '../src/social/moderationEvents'
import { useConnections } from '../src/social/useConnections'
import {
  addTrustCircleMember,
  hasTrustCircleMember,
  removeTrustCircleMember,
} from '../src/social/trustCircleStore'
import { isLikelyWebId } from '../src/directory/directorySource'
import {
  NO_DIRECTORY_FEATURES,
  readDirectoryFeatureAvailability,
  type DirectoryFeatureAvailability,
} from '../src/directory/directoryFeatureClient'
import type { RelationshipRecord } from '@nodezero/solid-pod-sync'
import { aesthetic } from '../src/theme/aesthetic'
import { Ionicons } from '@expo/vector-icons'

interface LocalMessage {
  id: string
  senderWebId: string
  body: string
  timestamp: string
}

/** How far back the store catch-up query reaches on mount/resubscribe. */
const CHAT_CATCHUP_MS = 60 * 60_000
const AUTHORITY_RECONCILE_INTERVAL_MS = 30_000
const RELAY_ASSERTION_REFRESH_MS = 5 * 60_000

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }
  return value ?? ''
}

function isValidRelayOverrideWebId(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' && parsed.pathname.includes('/profile/card')
  } catch {
    return false
  }
}

export default function LocalNodeScreen(): JSX.Element {
  const { status, authFetch } = useNodeZeroSession()
  const [features, setFeatures] = useState<DirectoryFeatureAvailability | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') {
      setFeatures(NO_DIRECTORY_FEATURES)
      return
    }
    let cancelled = false
    void readDirectoryFeatureAvailability(getProvisionerUrl(), authFetch).then((availability) => {
      if (!cancelled) setFeatures(availability)
    })
    return (): void => {
      cancelled = true
    }
  }, [authFetch, status])

  if (status === 'authenticated' && features === null) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={aesthetic.color.accent} size="large" />
      </View>
    )
  }
  if (status === 'authenticated' && !features?.relationship && !features?.transport) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Local communication is not available for this account.</Text>
      </View>
    )
  }
  return <LocalNodeScreenContent features={features ?? NO_DIRECTORY_FEATURES} />
}

function LocalNodeScreenContent({
  features,
}: {
  features: DirectoryFeatureAvailability
}): JSX.Element {
  const { peerWebId } = useLocalSearchParams<{ peerWebId?: string }>()
  const { currentNode, surroundingNodes, locationStatus, requestAccess } = useDiscovery()
  const { webId, status, authFetch } = useNodeZeroSession()
  const {
    presentPeers,
    presenceStatus,
    presenceError,
    revealedPeers,
    revealedTo,
    localBroadcastsEnabled,
    revealToPeer,
  } = usePresence()
  const { transport: wakuTransport, status: wakuStatus, appPrefix, signer, dmKeyPair } = useWaku()
  const isLoggedIn = status === 'authenticated'
  const { attestationStatus, signAttestationChallenge } = useWallet()
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const params = useLocalSearchParams<{
    qaRelayWebId?: string | string[]
    qaBypassLocation?: string | string[]
  }>()
  const relayUrl = appExtra?.relayUrl ?? ''
  const qaOverridesEnabled =
    appExtra?.qaLocalOverridesEnabled === 'true' && appExtra?.envProfile !== 'production-mainnet'
  const qaRelayWebIdParam = firstParam(params.qaRelayWebId).trim()
  const qaRelayWebId =
    qaOverridesEnabled && isValidRelayOverrideWebId(qaRelayWebIdParam) ? qaRelayWebIdParam : null
  const effectiveWebId = qaRelayWebId ?? webId
  const qaBypassLocation =
    qaOverridesEnabled &&
    ['1', 'true', 'yes'].includes(firstParam(params.qaBypassLocation).toLowerCase())
  const authModeLabel = 'NodeZero Session'

  const [message, setMessage] = useState('')
  const [targetWebId, setTargetWebId] = useState('')
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [sending, setSending] = useState(false)
  const [relayState, setRelayState] = useState<'idle' | 'connecting' | 'connected' | 'error'>(
    'idle'
  )
  const [relayError, setRelayError] = useState<string | null>(null)
  const [openPeers, setOpenPeers] = useState<Record<string, boolean>>({})
  const [knownPeers, setKnownPeers] = useState<string[]>([])
  const [relationships, setRelationships] = useState<RelationshipRecord[]>([])
  const [blockedWebIds, setBlockedWebIds] = useState<string[]>([])
  const [mutedWebIds, setMutedWebIds] = useState<string[]>([])
  const [reportedWebIds, setReportedWebIds] = useState<string[]>([])
  const [selectedInTrustCircle, setSelectedInTrustCircle] = useState(false)
  const [showAuthModeHint, setShowAuthModeHint] = useState(false)

  const relayRef = useRef<SignalRelay | null>(null)
  const channelsRef = useRef<Map<string, P2PChannel>>(new Map())
  const seenMessageIdsRef = useRef<Set<string>>(new Set())

  const wakuActive = wakuStatus === 'connected' && wakuTransport !== null
  const {
    connectionBusyWebId,
    addConnection,
    cancelConnectionRequest,
    removeConnection,
    respondToIncomingRequest,
  } = useConnections({ effectiveWebId: webId, authFetch })

  useEffect((): (() => void) | void => {
    if (typeof peerWebId === 'string' && isLikelyWebId(peerWebId)) setTargetWebId(peerWebId)
  }, [peerWebId])

  /** Append a message once, deduplicating live/store/echo deliveries by id. */
  const appendMessage = useCallback((incoming: LocalMessage): void => {
    if (seenMessageIdsRef.current.has(incoming.id)) return
    seenMessageIdsRef.current.add(incoming.id)
    setMessages((prev) => [incoming, ...prev])
  }, [])

  const authorizeInbound = useCallback(
    async (senderWebId: string): Promise<boolean> => {
      if (!webId) return false
      try {
        const podRoot = `${webId.split('/profile/')[0]}/`
        const managers = getSolidPodSyncManagers({ fetch: authFetch })
        const [currentRelationships, currentModeration] = await Promise.all([
          managers.relationshipManager.listRelationships(podRoot),
          managers.moderationManager.listModeration(podRoot),
        ])
        return canReceiveDirectedCommunication(
          senderWebId,
          webId,
          currentRelationships,
          currentModeration
        )
      } catch {
        return false
      }
    },
    [authFetch, webId]
  )

  const upsertChannel = useCallback(
    (remoteWebId: string): P2PChannel | null => {
      if (!effectiveWebId) return null
      const existing = channelsRef.current.get(remoteWebId)
      if (existing) return existing

      const channel = new P2PChannel({ localWebId: effectiveWebId, remoteWebId })

      channel.on('message', (incoming) => {
        void authorizeInbound(remoteWebId).then((authorized) => {
          if (authorized) {
            setMessages((prev) => [incoming, ...prev])
            return
          }
          channel.close()
          channelsRef.current.delete(remoteWebId)
        })
      })

      channel.on('open', () => {
        setOpenPeers((prev) => ({ ...prev, [remoteWebId]: true }))
      })

      channel.on('close', () => {
        setOpenPeers((prev) => ({ ...prev, [remoteWebId]: false }))
      })

      channel.on('iceCandidate', (candidate) => {
        if (!relayRef.current || !effectiveWebId) return
        relayRef.current.send({
          type: 'ice-candidate',
          from: effectiveWebId,
          to: remoteWebId,
          payload: candidate,
        })
      })

      channel.on('error', (err) => {
        console.warn('[LocalNodeScreen] P2P channel error:', err)
      })

      channelsRef.current.set(remoteWebId, channel)
      return channel
    },
    [authorizeInbound, effectiveWebId]
  )

  useEffect((): (() => void) | void => {
    if (!features.transport || !isLoggedIn || !webId || effectiveWebId !== webId || !relayUrl) {
      setRelayState('idle')
      return
    }

    setRelayState('connecting')
    setRelayError(null)
    let cancelled = false
    let relay: SignalRelay | null = null
    let assertionRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let relayGeneration = 0

    const connectRelay = (): void => {
      const generation = relayGeneration + 1
      relayGeneration = generation
      setRelayState('connecting')
      void issueTransportIdentityAssertion({
        provisionerUrl: getProvisionerUrl(),
        audience: 'relay',
        authFetch,
      })
        .then((identityAssertion) => {
          if (cancelled || generation !== relayGeneration) return
          relay?.disconnect()
          relay = new SignalRelay({
            relayUrl,
            localWebId: webId,
            identityAssertion,
            signIdentityChallenge: async (challenge): Promise<string> => {
              const signed = await signAttestationChallenge(challenge)
              return signed.signatureBase64
            },
          })
          const currentRelay = relay
          relayRef.current = currentRelay

          currentRelay.on('connected', () => {
            if (relayRef.current !== currentRelay) return
            setRelayState('connected')
            setRelayError(null)
          })

          currentRelay.on('disconnected', () => {
            if (cancelled || relayRef.current !== currentRelay) return
            setRelayState('idle')
            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(connectRelay, 1_000)
          })

          currentRelay.on('error', (err) => {
            if (relayRef.current !== currentRelay) return
            setRelayState('error')
            setRelayError(err.message)
          })

          currentRelay.on('signal', (signal: SignalMessage) => {
            if (relayRef.current !== currentRelay) return
            void (async (): Promise<void> => {
              if (signal.to !== webId) return
              if (!(await authorizeInbound(signal.from))) {
                channelsRef.current.get(signal.from)?.close()
                channelsRef.current.delete(signal.from)
                return
              }
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

          currentRelay.connect()
          if (assertionRefreshTimer) clearTimeout(assertionRefreshTimer)
          assertionRefreshTimer = setTimeout(connectRelay, RELAY_ASSERTION_REFRESH_MS)
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setRelayState('error')
            setRelayError(error instanceof Error ? error.message : 'Relay identity is unavailable.')
          }
        })
    }
    connectRelay()

    return () => {
      cancelled = true
      relayGeneration += 1
      if (assertionRefreshTimer) clearTimeout(assertionRefreshTimer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      relay?.disconnect()
      relayRef.current = null
      for (const channel of channelsRef.current.values()) {
        channel.close()
      }
      channelsRef.current.clear()
      setOpenPeers({})
    }
  }, [
    authFetch,
    authorizeInbound,
    effectiveWebId,
    features.transport,
    isLoggedIn,
    relayUrl,
    signAttestationChallenge,
    upsertChannel,
    webId,
  ])

  useEffect((): (() => void) | void => {
    if (!isLoggedIn || !webId) {
      setKnownPeers([])
      return
    }

    const managers = getSolidPodSyncManagers({ fetch: authFetch })
    const podRoot = webId.split('/profile/')[0] + '/'
    let cancelled = false
    const reconcile = (): void => {
      const inboxSync = features.relationship
        ? syncRelationshipInbox({
            podRoot,
            recipientWebId: webId,
            provisionerUrl: getProvisionerUrl(),
            authFetch,
            managers,
          }).catch(() => null)
        : Promise.resolve(null)
      void inboxSync
        .then(() =>
          Promise.all([
            managers.relationshipManager.listRelationships(podRoot),
            managers.moderationManager.listModeration(podRoot),
          ])
        )
        .then(([relationshipRecords, moderationRecords]) => {
          if (cancelled) return
          const blocked = moderationRecords
            .filter((record) => record.action === 'block')
            .map((record) => record.subjectWebId)
          setRelationships(relationshipRecords)
          setBlockedWebIds(blocked)
          setMutedWebIds(
            moderationRecords
              .filter((record) => record.action === 'mute')
              .map((record) => record.subjectWebId)
          )
          setReportedWebIds(
            moderationRecords
              .filter((record) => record.action === 'report')
              .map((record) => record.subjectWebId)
          )
          setKnownPeers(
            relationshipRecords
              .filter(
                (record) => record.state === 'accepted' && !blocked.includes(record.peerWebId)
              )
              .map((record) => record.peerWebId)
              .filter((peer) => peer !== webId)
          )
        })
        .catch(() => {
          if (cancelled) return
          setKnownPeers([])
          setRelationships([])
          setBlockedWebIds([])
          setMutedWebIds([])
          setReportedWebIds([])
        })
    }
    reconcile()
    const interval = setInterval(reconcile, AUTHORITY_RECONCILE_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [authFetch, features.relationship, isLoggedIn, webId])

  useEffect(() => {
    const allowed = new Set(knownPeers)
    for (const [peer, channel] of channelsRef.current) {
      if (allowed.has(peer)) continue
      channel.close()
      channelsRef.current.delete(peer)
    }
  }, [knownPeers])

  useEffect(() => {
    if (blockedWebIds.length === 0) return
    const blocked = new Set(blockedWebIds)
    setMessages((existing) => existing.filter((item) => !blocked.has(item.senderWebId)))
  }, [blockedWebIds])

  useEffect(
    () =>
      subscribeBlockStateChanged((event) => {
        if (event.ownerWebId !== webId) return
        setBlockedWebIds((existing) =>
          event.blocked
            ? [...new Set([...existing, event.subjectWebId])]
            : existing.filter((item) => item !== event.subjectWebId)
        )
        if (event.blocked) {
          setMessages((existing) =>
            existing.filter((item) => item.senderWebId !== event.subjectWebId)
          )
          channelsRef.current.get(event.subjectWebId)?.close()
          channelsRef.current.delete(event.subjectWebId)
        }
      }),
    [webId]
  )

  // Stable key for the surrounding cell set (origin + ring).
  const cellKey = useMemo(() => {
    const indexes = new Set(surroundingNodes.map((node) => node.h3Index))
    if (currentNode?.h3Index) indexes.add(currentNode.h3Index)
    return [...indexes].sort().join(',')
  }, [currentNode?.h3Index, surroundingNodes])

  // Live local-broadcast feed: signed 'broadcast' envelopes on the
  // surrounding cell topics, plus a store catch-up on (re)subscribe.
  useEffect((): (() => void) | void => {
    if (
      !features.transport ||
      !localBroadcastsEnabled ||
      !wakuActive ||
      !wakuTransport ||
      cellKey.length === 0
    )
      return

    let cancelled = false
    let unsubscribe: (() => Promise<void>) | null = null
    const topics = cellKey.split(',').map((h3Index) => cellTopic(appPrefix, h3Index))

    const handler = (inbound: InboundMessage): void => {
      if (cancelled || inbound.envelope.kind !== 'broadcast' || !inbound.verified) return
      void verifyWakuEnvelopeIdentity({
        provisionerUrl: getProvisionerUrl(),
        envelope: inbound.envelope,
      }).then(async (identityVerified) => {
        if (!identityVerified || cancelled || !webId) return
        const podRoot = `${webId.split('/profile/')[0]}/`
        const blocked = await getSolidPodSyncManagers({ fetch: authFetch })
          .moderationManager.isBlocked(podRoot, inbound.envelope.senderWebId)
          .catch(() => true)
        if (blocked || cancelled) return
        const body = parseBroadcastBody(inbound.envelope.body)
        if (!body) return
        appendMessage({
          id: inbound.envelope.id,
          senderWebId: inbound.envelope.senderWebId,
          body: body.text,
          timestamp: inbound.envelope.timestamp,
        })
      })
    }

    void wakuTransport
      .subscribe(topics, handler)
      .then((unsub) => {
        if (cancelled) {
          void unsub().catch(() => undefined)
          return
        }
        unsubscribe = unsub
      })
      .catch(() => undefined)

    const since = new Date(Date.now() - CHAT_CATCHUP_MS)
    for (const topic of topics) {
      void wakuTransport.querySince(topic, since, handler).catch(() => undefined)
    }

    return () => {
      cancelled = true
      if (unsubscribe) void unsubscribe().catch(() => undefined)
    }
  }, [
    appPrefix,
    appendMessage,
    authFetch,
    cellKey,
    features.transport,
    localBroadcastsEnabled,
    wakuActive,
    wakuTransport,
    webId,
  ])

  // Inbound DM handler: plaintext-signed or ECIES-sealed chat bodies.
  const handleDmInbound = useCallback(
    (inbound: InboundMessage): void => {
      if (inbound.envelope.kind !== 'chat' || !inbound.verified) return
      void Promise.all([
        verifyWakuEnvelopeIdentity({
          provisionerUrl: getProvisionerUrl(),
          envelope: inbound.envelope,
        }),
        authorizeInbound(inbound.envelope.senderWebId),
      ]).then(([identityVerified, authorized]) => {
        if (!identityVerified || !authorized) return
        const parsed = parseChatBody(inbound.envelope.body)
        if (!parsed) return
        const base = {
          id: inbound.envelope.id,
          senderWebId: inbound.envelope.senderWebId,
          timestamp: inbound.envelope.timestamp,
        }
        if (parsed.scheme === 'plain') {
          appendMessage({ ...base, body: parsed.text })
          return
        }
        if (!dmKeyPair) {
          appendMessage({ ...base, body: '[encrypted message — no session key]' })
          return
        }
        void decryptDmBody(dmKeyPair.privateKey, parsed.sealed)
          .then((text) => appendMessage({ ...base, body: text }))
          .catch(() => appendMessage({ ...base, body: '[encrypted message]' }))
      })
    },
    [appendMessage, authorizeInbound, dmKeyPair]
  )

  // Subscribe only to accepted, unblocked peers. Reveal state never grants
  // directed communication authority.
  const dmPeersKey = useMemo(() => {
    const peers = new Set<string>(knownPeers)
    if (effectiveWebId) peers.delete(effectiveWebId)
    return [...peers].sort().join('\n')
  }, [effectiveWebId, knownPeers])

  const selectedRelationship = relationships.find(
    (record) => record.peerWebId === targetWebId.trim()
  )
  const selectedActionPolicy = derivePersonActionPolicy({
    isSelf: targetWebId.trim() === effectiveWebId,
    relationshipState: selectedRelationship?.state ?? null,
    blocked: blockedWebIds.includes(targetWebId.trim()),
    muted: mutedWebIds.includes(targetWebId.trim()),
    reported: reportedWebIds.includes(targetWebId.trim()),
    inTrustCircle: selectedInTrustCircle,
  })

  useEffect(() => {
    const target = targetWebId.trim()
    if (!webId || !target || target === webId) {
      setSelectedInTrustCircle(false)
      return
    }
    void hasTrustCircleMember(webId, target, { fetch: authFetch })
      .then(setSelectedInTrustCircle)
      .catch(() => setSelectedInTrustCircle(false))
  }, [authFetch, targetWebId, webId])

  const toggleSelectedTrustCircle = useCallback(async (): Promise<void> => {
    const target = targetWebId.trim()
    if (!webId || !target) return
    const next = selectedInTrustCircle
      ? await removeTrustCircleMember(webId, target, { fetch: authFetch })
      : await addTrustCircleMember(webId, target, { fetch: authFetch })
    setSelectedInTrustCircle(next.includes(target))
  }, [authFetch, selectedInTrustCircle, targetWebId, webId])

  const updateSelectedModeration = useCallback(
    async (action: 'mute' | 'block' | 'report', enabled: boolean): Promise<void> => {
      const target = targetWebId.trim()
      if (!webId || !target || target === webId) return
      const podRoot = `${webId.split('/profile/')[0]}/`
      const { moderationManager } = getSolidPodSyncManagers({ fetch: authFetch })
      if (enabled) {
        await moderationManager.setModeration(podRoot, {
          subjectWebId: target,
          action,
          reasonCode: `user-${action === 'report' ? 'reported' : `${action}ed`}`,
        })
      } else {
        await moderationManager.removeModeration(podRoot, target, action)
      }
      const moderation = await moderationManager.listModeration(podRoot)
      if (action === 'block') {
        publishBlockStateChanged({ ownerWebId: webId, subjectWebId: target, blocked: enabled })
      }
      setBlockedWebIds(
        moderation
          .filter((record) => record.action === 'block')
          .map((record) => record.subjectWebId)
      )
      setMutedWebIds(
        moderation.filter((record) => record.action === 'mute').map((record) => record.subjectWebId)
      )
      setReportedWebIds(
        moderation
          .filter((record) => record.action === 'report')
          .map((record) => record.subjectWebId)
      )
    },
    [authFetch, targetWebId, webId]
  )

  // Subscribe to the pairwise DM topics for all chat partners, with a store
  // catch-up so recent messages survive app restarts.
  useEffect((): (() => void) | void => {
    if (
      !features.transport ||
      !wakuActive ||
      !wakuTransport ||
      !effectiveWebId ||
      dmPeersKey.length === 0
    )
      return

    let cancelled = false
    let unsubscribe: (() => Promise<void>) | null = null

    void (async (): Promise<void> => {
      const peers = dmPeersKey.split('\n')
      const topics = [
        ...new Set(
          await Promise.all(peers.map((peer) => dmTopic(appPrefix, effectiveWebId, peer)))
        ),
      ]
      if (cancelled) return
      try {
        const unsub = await wakuTransport.subscribe(topics, handleDmInbound)
        if (cancelled) {
          void unsub().catch(() => undefined)
          return
        }
        unsubscribe = unsub
      } catch {
        // Subscription failures surface via transport error events.
      }
      const since = new Date(Date.now() - CHAT_CATCHUP_MS)
      for (const topic of topics) {
        void wakuTransport.querySince(topic, since, handleDmInbound).catch(() => undefined)
      }
    })()

    return () => {
      cancelled = true
      if (unsubscribe) void unsubscribe().catch(() => undefined)
    }
  }, [
    appPrefix,
    dmPeersKey,
    effectiveWebId,
    features.transport,
    handleDmInbound,
    wakuActive,
    wakuTransport,
  ])

  const sendMessage = useCallback(async () => {
    if (!features.transport) return
    if (!message.trim() || !effectiveWebId || !targetWebId.trim()) return

    const target = targetWebId.trim()
    const bodyText = message.trim()
    if (!(await authorizeInbound(target))) {
      channelsRef.current.get(target)?.close()
      channelsRef.current.delete(target)
      setRelayError('Messaging requires an accepted, unblocked relationship.')
      return
    }
    const targetRelationship = relationships.find((record) => record.peerWebId === target)
    const targetPolicy = derivePersonActionPolicy({
      isSelf: target === effectiveWebId,
      relationshipState: targetRelationship?.state ?? null,
      blocked: blockedWebIds.includes(target),
      inTrustCircle: false,
      mutuallyRevealed: revealedPeers.some((peer) => peer.webId === target),
    })
    if (!targetPolicy.canMessage) {
      setRelayError('Messaging requires an accepted, unblocked relationship.')
      return
    }

    // Preferred path: signed (and E2EE where possible) chat over the Waku
    // pairwise DM topic.
    if (wakuActive && wakuTransport && signer) {
      setSending(true)
      try {
        const revealed = revealedPeers.find((peer) => peer.webId === target)
        const body = revealed
          ? createEncryptedChatBody(await encryptDmBody(revealed.dmPublicKeyJwk, bodyText))
          : createPlainChatBody(bodyText)
        const envelope = await createEnvelope(signer, {
          senderWebId: effectiveWebId,
          kind: 'chat',
          body,
        })
        await wakuTransport.publish(await dmTopic(appPrefix, effectiveWebId, target), envelope)
        appendMessage({
          id: envelope.id,
          senderWebId: effectiveWebId,
          body: bodyText,
          timestamp: envelope.timestamp,
        })
        setMessage('')
        setRelayError(null)
      } catch (err) {
        setRelayError(err instanceof Error ? err.message : 'Failed to send message.')
        console.warn('[LocalNodeScreen] Waku sendMessage error:', err)
      } finally {
        setSending(false)
      }
      return
    }

    // Fallback path: legacy WebRTC channel via the signaling relay.
    if (!relayRef.current || relayState !== 'connected') {
      setRelayError('Relay is not connected yet. Please wait and retry.')
      return
    }

    setSending(true)

    try {
      const channel = upsertChannel(target)
      if (!channel) return

      if (!openPeers[target]) {
        const offer = await channel.createOffer()
        relayRef.current.send({
          type: 'offer',
          from: effectiveWebId,
          to: target,
          payload: offer,
        })
        setRelayError('Establishing secure channel. Tap send again once connected.')
        return
      }

      const sent = channel.send(bodyText)
      setMessages((prev) => [sent, ...prev])
      setMessage('')
      setRelayError(null)
    } catch (err) {
      setRelayError(err instanceof Error ? err.message : 'Failed to send message.')
      console.warn('[LocalNodeScreen] sendMessage error:', err)
    } finally {
      setSending(false)
    }
  }, [
    appPrefix,
    appendMessage,
    authorizeInbound,
    blockedWebIds,
    effectiveWebId,
    features.transport,
    message,
    openPeers,
    relayState,
    relationships,
    revealedPeers,
    signer,
    targetWebId,
    upsertChannel,
    wakuActive,
    wakuTransport,
  ])

  if (status === 'restoring') {
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

  // Fail-closed: block Local Node access until the on-chain lockb0x pairing is
  // verified. Show a spinner while verification runs; route unverified sessions
  // back to onboarding.
  if (attestationStatus === 'idle' || attestationStatus === 'verifying') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
        <Text style={styles.infoText}>Verifying your on-chain lockb0x…</Text>
      </View>
    )
  }

  if (attestationStatus !== 'verified') {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>
          Finish onboarding to join your Local Node.{'\n'}
          Your on-chain lockb0x must be verified first.
        </Text>
      </View>
    )
  }

  if (locationStatus === 'idle') {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>
          Enable location when you are ready to discover nearby nodes in your H3 area.{'\n'}
          NodeZero does not share your raw GPS coordinates.
        </Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => void requestAccess()}
          activeOpacity={aesthetic.motion.pressOpacity}
        >
          <Text style={styles.refreshBtnText}>Enable Location</Text>
        </TouchableOpacity>
      </View>
    )
  }

  if (locationStatus === 'requesting') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
        <Text style={styles.infoText}>Requesting location permission…</Text>
      </View>
    )
  }

  if (!qaBypassLocation && (locationStatus === 'denied' || locationStatus === 'unavailable')) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>
          Location access is required to join a Local Node.{'\n'}
          Please grant permission in your device settings.
        </Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => void requestAccess()}
          activeOpacity={aesthetic.motion.pressOpacity}
        >
          <Text style={styles.refreshBtnText}>Grant Location Access</Text>
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
            {
              'Your device Stellar key signs you in through a NodeZero session. Pod access stays behind the NodeZero proxy with no passwords or redirects.'
            }
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
              {item.isOrigin ? 'Here ' : ''}
              {item.h3Index.slice(-6)}
            </Text>
          </View>
        )}
      />

      {/* Live presence: peers actually beaconing in the surrounding cells */}
      {presenceStatus !== 'disabled' && (
        <View style={styles.peerRow}>
          <Text style={styles.peerRowLabel}>
            Present now{presenceStatus === 'active' ? ` · ${presentPeers.length}` : ''}
          </Text>
          {presenceStatus === 'waiting' && (
            <Text style={styles.systemText}>Connecting to the local mesh…</Text>
          )}
          {presenceStatus === 'error' && presenceError && (
            <Text style={styles.errorText}>{presenceError}</Text>
          )}
          {presenceStatus === 'active' && presentPeers.length === 0 && (
            <Text style={styles.systemText}>No one else is present right now.</Text>
          )}
          {presentPeers.length > 0 && (
            <FlatList
              horizontal
              data={presentPeers}
              keyExtractor={(peer) => peer.webIdCommitment}
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => {
                const alreadyRevealed = revealedTo.includes(item.webIdCommitment)
                const canReveal = wakuActive && !!item.dmPublicKeyJwk && !alreadyRevealed
                return (
                  <TouchableOpacity
                    onPress={() => {
                      if (!canReveal) return
                      void revealToPeer(item)
                        .then(() => setRelayError(null))
                        .catch((err: unknown) => {
                          setRelayError(
                            err instanceof Error ? err.message : 'Failed to reveal to peer.'
                          )
                        })
                    }}
                    disabled={!canReveal}
                    style={styles.peerChip}
                    activeOpacity={aesthetic.motion.pressOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={
                      alreadyRevealed
                        ? 'Already revealed to this peer'
                        : 'Reveal your WebID to this peer'
                    }
                  >
                    <Text style={styles.peerChipText} numberOfLines={1}>
                      {item.h3Index === currentNode?.h3Index ? '● ' : '○ '}
                      {item.webIdCommitment.slice(0, 10)}
                      {alreadyRevealed ? ' ✓' : canReveal ? ' ⇄' : ''}
                    </Text>
                  </TouchableOpacity>
                )
              }}
            />
          )}
        </View>
      )}

      {/* Reveal is identity context only; accepted state is required to chat. */}
      {revealedPeers.length > 0 && (
        <View style={styles.peerRow}>
          <Text style={styles.peerRowLabel}>Revealed to you</Text>
          <FlatList
            horizontal
            data={revealedPeers}
            keyExtractor={(peer) => peer.webId}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => {
              const selected = targetWebId.trim() === item.webId
              return (
                <TouchableOpacity
                  onPress={() => setTargetWebId(item.webId)}
                  style={[styles.peerChip, selected && styles.peerChipSelected]}
                  activeOpacity={aesthetic.motion.pressOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Select revealed peer ${item.webId}`}
                >
                  <Text
                    style={[styles.peerChipText, selected && styles.peerChipTextSelected]}
                    numberOfLines={1}
                  >
                    {'🔒 '}
                    {item.webId}
                  </Text>
                </TouchableOpacity>
              )
            }}
          />
        </View>
      )}

      {/* Message feed */}
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        inverted
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        ListEmptyComponent={
          <View style={styles.emptyMessages}>
            <Text style={styles.infoText}>No messages yet. Start the first local check-in.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.messageBubble}>
            <Text style={styles.messageSender} numberOfLines={1}>
              {item.senderWebId}
            </Text>
            <Text style={styles.messageBody}>{item.body}</Text>
            <Text style={styles.messageTime}>{new Date(item.timestamp).toLocaleTimeString()}</Text>
          </View>
        )}
      />

      {knownPeers.length > 0 && (
        <View style={styles.peerRow}>
          <Text style={styles.peerRowLabel}>Accepted peers</Text>
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

      {targetWebId.trim() && targetWebId.trim() !== effectiveWebId ? (
        <View style={styles.moderationRow}>
          {features.relationship && selectedActionPolicy.canRequest ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void addConnection(targetWebId.trim())}
              disabled={connectionBusyWebId === targetWebId.trim()}
              accessibilityRole="button"
              accessibilityLabel="Request relationship with selected peer"
            >
              <Text style={styles.moderationButtonText}>Request</Text>
            </TouchableOpacity>
          ) : null}
          {features.relationship && selectedActionPolicy.canAcceptRequest ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void respondToIncomingRequest(targetWebId.trim(), 'accept')}
              disabled={connectionBusyWebId === targetWebId.trim()}
              accessibilityRole="button"
              accessibilityLabel="Accept selected peer request"
            >
              <Text style={styles.moderationButtonText}>Accept</Text>
            </TouchableOpacity>
          ) : null}
          {features.relationship && selectedActionPolicy.canDeclineRequest ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void respondToIncomingRequest(targetWebId.trim(), 'reject')}
              disabled={connectionBusyWebId === targetWebId.trim()}
              accessibilityRole="button"
              accessibilityLabel="Decline selected peer request"
            >
              <Text style={styles.moderationButtonText}>Decline</Text>
            </TouchableOpacity>
          ) : null}
          {features.relationship && selectedActionPolicy.canCancelRequest ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void cancelConnectionRequest(targetWebId.trim())}
              disabled={connectionBusyWebId === targetWebId.trim()}
              accessibilityRole="button"
              accessibilityLabel="Cancel selected peer request"
            >
              <Text style={styles.moderationButtonText}>Cancel</Text>
            </TouchableOpacity>
          ) : null}
          {features.relationship && selectedActionPolicy.canDisconnect ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void removeConnection(targetWebId.trim())}
              disabled={connectionBusyWebId === targetWebId.trim()}
              accessibilityRole="button"
              accessibilityLabel="Disconnect selected peer"
            >
              <Text style={styles.moderationButtonText}>Disconnect</Text>
            </TouchableOpacity>
          ) : null}
          {selectedActionPolicy.canAddTrustCircle || selectedActionPolicy.canRemoveTrustCircle ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void toggleSelectedTrustCircle()}
              accessibilityRole="button"
              accessibilityLabel={`${selectedInTrustCircle ? 'Remove' : 'Add'} selected peer ${selectedInTrustCircle ? 'from' : 'to'} Trust Circle`}
            >
              <Text style={styles.moderationButtonText}>
                {selectedInTrustCircle ? 'Remove Circle' : 'Add Circle'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {selectedActionPolicy.canMute || selectedActionPolicy.canUnmute ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void updateSelectedModeration('mute', selectedActionPolicy.canMute)}
              accessibilityRole="button"
              accessibilityLabel={`${selectedActionPolicy.canUnmute ? 'Unmute' : 'Mute'} selected peer`}
            >
              <Text style={styles.moderationButtonText}>
                {selectedActionPolicy.canUnmute ? 'Unmute' : 'Mute'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.moderationButton}
            onPress={() =>
              void updateSelectedModeration('block', selectedActionPolicy.reason !== 'blocked')
            }
            accessibilityRole="button"
            accessibilityLabel={`${selectedActionPolicy.reason === 'blocked' ? 'Unblock' : 'Block'} selected peer`}
          >
            <Text style={styles.moderationButtonText}>
              {selectedActionPolicy.reason === 'blocked' ? 'Unblock' : 'Block'}
            </Text>
          </TouchableOpacity>
          {selectedActionPolicy.canReport ? (
            <TouchableOpacity
              style={styles.moderationButton}
              onPress={() => void updateSelectedModeration('report', true)}
              accessibilityRole="button"
              accessibilityLabel="Report selected peer"
            >
              <Text style={styles.moderationButtonText}>Report</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {features.transport && wakuActive && (
        <Text style={styles.systemText}>
          Local mesh connected — messages are signed{dmKeyPair ? ', E2EE with revealed peers' : ''}.
        </Text>
      )}
      {features.transport && !wakuActive && relayState !== 'connected' && (
        <Text style={styles.systemText}>
          {relayState === 'connecting' ? 'Connecting to secure relay…' : 'Relay disconnected.'}
        </Text>
      )}
      {qaRelayWebId && (
        <Text style={styles.systemText}>QA relay identity override active for this session.</Text>
      )}
      {qaBypassLocation && (
        <Text style={styles.systemText}>QA geolocation bypass active for this session.</Text>
      )}
      {relayError && <Text style={styles.errorText}>{relayError}</Text>}

      {features.transport ? (
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
      ) : null}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  centred: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: aesthetic.color.bgNight,
  },
  infoText: {
    color: aesthetic.color.textMid,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 12,
  },
  refreshBtn: {
    marginTop: 16,
    backgroundColor: aesthetic.color.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
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
  authModeBadgeText: {
    color: aesthetic.color.textHigh,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
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
  nodeIndex: {
    color: aesthetic.color.accentSoft,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    marginTop: 4,
  },
  nodeSubtitle: { color: aesthetic.color.textLow, fontSize: 12, marginTop: 2 },
  cellStrip: { maxHeight: 44, borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  cellStripContent: { paddingHorizontal: 12, alignItems: 'center' },
  cellChip: {
    backgroundColor: aesthetic.color.surface,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
  },
  cellChipOrigin: { backgroundColor: '#2E2060' },
  cellChipText: {
    color: aesthetic.color.textMid,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  messageList: { flex: 1 },
  messageListContent: { padding: 12, flexGrow: 1, justifyContent: 'flex-end' },
  emptyMessages: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 },
  messageBubble: {
    backgroundColor: aesthetic.color.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
  },
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
  systemText: {
    color: aesthetic.color.textMid,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  errorText: { color: '#FF7A7A', fontSize: 12, paddingHorizontal: 12, paddingBottom: 6 },
  composeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
    backgroundColor: aesthetic.color.bgNight,
  },
  moderationRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: aesthetic.color.bgNight,
  },
  moderationButton: {
    minHeight: 34,
    justifyContent: 'center',
    backgroundColor: '#4A4F59',
    borderRadius: 6,
    paddingHorizontal: 12,
  },
  moderationButtonText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
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
