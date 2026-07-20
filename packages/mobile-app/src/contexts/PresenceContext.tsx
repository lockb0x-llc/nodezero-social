/**
 * @module PresenceContext
 *
 * Live "who is actually here" state for the Local Node experience.
 *
 * When the Waku transport is connected, this provider:
 *  - publishes a signed, ephemeral presence beacon for the user's current H3
 *    cell every PRESENCE_BEACON_INTERVAL_MS,
 *  - subscribes to the presence topics of the current cell + its 6 immediate
 *    neighbours (resubscribing whenever the cell set changes), and
 *  - maintains a live peer map with expiry sweeping via PresenceTracker.
 *
 * Privacy: beacons carry a rotating WebID commitment, never the raw WebID.
 * The raw WebID is only exchanged during the mutual-reveal handshake: a
 * signed 'reveal' envelope whose body is ECIES-sealed to the target peer's
 * DM session key, published on the target commitment's reveal topic. Both
 * sides must actively reveal before either can DM the other by WebID.
 * Raw GPS never appears anywhere — only H3 cell indexes.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  PRESENCE_BEACON_INTERVAL_MS,
  PRESENCE_BEACON_TTL_MS,
  PresenceTracker,
  createEnvelope,
  createPresenceBeaconBody,
  createRevealBody,
  createRevealPayload,
  decryptDmBody,
  encryptDmBody,
  parseRevealBody,
  parseRevealPayload,
  presenceCommitment,
  presenceEpoch,
  presenceSenderId,
  presenceTopic,
  revealTopic,
  type DmPublicJwk,
  type InboundMessage,
  type PresencePeer,
} from '@nodezero/waku-comms'
import { useDiscovery } from './DiscoveryContext'
import { useNodeZeroSession } from './NodeZeroSessionContext'
import { useWaku } from './WakuContext'

/** How often the live peer map is swept for expired beacons. */
const SWEEP_INTERVAL_MS = 10_000

/** Lifecycle of the presence layer. */
export type PresenceStatus =
  /** Waku plane is off (no bootstrap peers configured). */
  | 'disabled'
  /** Waiting for transport connection and/or a current H3 cell. */
  | 'waiting'
  /** Beaconing and listening on the surrounding cells. */
  | 'active'
  | 'error'

/** A nearby peer who revealed their WebID to us via the reveal handshake. */
export interface RevealedPeer {
  /** Presence commitment the reveal was linked to. */
  commitment: string
  /** The peer's raw WebID (only ever delivered E2EE). */
  webId: string
  /** The peer's DM session public key for E2EE chat. */
  dmPublicKeyJwk: DmPublicJwk
  /** Stellar key that signed the reveal envelope. */
  stellarPublicKey: string
  /** ISO timestamp when the reveal arrived. */
  revealedAt: string
}

interface PresenceContextValue {
  /** Verified, unexpired peers present in the surrounding cells. */
  presentPeers: PresencePeer[]
  presenceStatus: PresenceStatus
  /** Human-readable error detail when presenceStatus is 'error'. */
  presenceError: string | null
  /** Peers who revealed their WebID to us, most recent first. */
  revealedPeers: RevealedPeer[]
  /** Commitments we have already sent a reveal to (this session). */
  revealedTo: string[]
  /**
   * Reveal our WebID + DM key to a present peer (E2EE to their beacon key).
   * Rejects when the peer advertises no DM key or the Waku plane is down.
   */
  revealToPeer: (peer: PresencePeer) => Promise<void>
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

/** Publishes presence beacons and tracks live peers in nearby cells. */
export function PresenceProvider({ children }: { children: ReactNode }): JSX.Element {
  const { transport, status: wakuStatus, appPrefix, signer, dmKeyPair } = useWaku()
  const { currentNode, surroundingNodes } = useDiscovery()
  const { webId } = useNodeZeroSession()

  const [presentPeers, setPresentPeers] = useState<PresencePeer[]>([])
  const [presenceError, setPresenceError] = useState<string | null>(null)
  const [revealedPeers, setRevealedPeers] = useState<RevealedPeer[]>([])
  const [revealedTo, setRevealedTo] = useState<string[]>([])
  const [ownCommitments, setOwnCommitments] = useState<string[]>([])

  const trackerRef = useRef(new PresenceTracker())
  // Own commitments for the current + previous epoch, so the user's own
  // beacons (including ones straddling an epoch rotation) never show as a peer.
  const ownCommitmentsRef = useRef<Set<string>>(new Set())

  const connected = wakuStatus === 'connected' && transport !== null
  const currentH3 = currentNode?.h3Index ?? null

  // Stable key for the surrounding cell set so the subscription effect only
  // re-runs when the actual set of cells changes.
  const topicKey = useMemo(() => {
    const indexes = new Set(surroundingNodes.map((node) => node.h3Index))
    if (currentH3) indexes.add(currentH3)
    return [...indexes].sort().join(',')
  }, [currentH3, surroundingNodes])

  // Subscribe to the presence topics of the surrounding cells.
  useEffect((): (() => void) | void => {
    if (!connected || !transport || topicKey.length === 0) {
      trackerRef.current.clear()
      setPresentPeers([])
      return
    }

    const topics = topicKey.split(',').map((h3Index) => presenceTopic(appPrefix, h3Index))
    let cancelled = false
    let unsubscribe: (() => Promise<void>) | null = null

    const handler = (message: InboundMessage): void => {
      if (cancelled) return
      const beaconCommitment = message.envelope.senderWebId
      if (
        [...ownCommitmentsRef.current].some(
          (commitment) => beaconCommitment === presenceSenderId(commitment),
        )
      ) {
        return
      }
      if (trackerRef.current.ingest(message)) {
        setPresentPeers(trackerRef.current.peers())
      }
    }

    void transport
      .subscribe(topics, handler)
      .then((unsub) => {
        if (cancelled) {
          void unsub().catch(() => undefined)
          return
        }
        unsubscribe = unsub
        setPresenceError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPresenceError(err instanceof Error ? err.message : 'Presence subscription failed.')
        }
      })

    return () => {
      cancelled = true
      trackerRef.current.clear()
      setPresentPeers([])
      if (unsubscribe) {
        void unsubscribe().catch(() => undefined)
      }
    }
  }, [appPrefix, connected, topicKey, transport])

  // Publish our own beacon on an interval while connected and located.
  useEffect((): (() => void) | void => {
    if (!connected || !transport || !currentH3 || !webId || !signer) {
      return
    }

    let cancelled = false

    const publishBeacon = async (): Promise<void> => {
      try {
        const now = new Date()
        const commitment = await presenceCommitment(webId, presenceEpoch(now))
        const previous = await presenceCommitment(
          webId,
          presenceEpoch(new Date(now.getTime() - 60 * 60_000)),
        )
        ownCommitmentsRef.current = new Set([commitment, previous])
        setOwnCommitments((existing) =>
          existing[0] === commitment && existing[1] === previous ? existing : [commitment, previous],
        )
        if (cancelled) return

        const envelope = await createEnvelope(signer, {
          senderWebId: presenceSenderId(commitment),
          kind: 'presence',
          body: createPresenceBeaconBody({
            webIdCommitment: commitment,
            h3Index: currentH3,
            capabilities: ['chat'],
            expiresAt: new Date(now.getTime() + PRESENCE_BEACON_TTL_MS).toISOString(),
            ...(dmKeyPair ? { dmPublicKeyJwk: dmKeyPair.publicJwk } : {}),
          }),
        })
        if (cancelled) return
        await transport.publish(presenceTopic(appPrefix, currentH3), envelope, { ephemeral: true })
        if (!cancelled) setPresenceError(null)
      } catch (err) {
        if (!cancelled) {
          setPresenceError(err instanceof Error ? err.message : 'Presence beacon failed.')
        }
      }
    }

    void publishBeacon()
    const interval = setInterval(() => void publishBeacon(), PRESENCE_BEACON_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [appPrefix, connected, currentH3, dmKeyPair, signer, transport, webId])

  // Listen for E2EE reveals addressed to our current (and previous) presence
  // commitment. Payloads are sealed to our DM session key; a reveal is only
  // accepted when its sender commitment maps to a tracked peer signed by the
  // same Stellar key (anti-spoof) or the peer is no longer tracked but the
  // envelope still verified.
  useEffect((): (() => void) | void => {
    if (!connected || !transport || !dmKeyPair || ownCommitments.length === 0) {
      return
    }

    let cancelled = false
    let unsubscribe: (() => Promise<void>) | null = null
    const topics = [...new Set(ownCommitments)].map((c) => revealTopic(appPrefix, c))

    const handler = (message: InboundMessage): void => {
      if (cancelled || message.envelope.kind !== 'reveal' || !message.verified) return
      const sealed = parseRevealBody(message.envelope.body)
      if (!sealed) return
      void decryptDmBody(dmKeyPair.privateKey, sealed)
        .then((plaintext) => {
          if (cancelled) return
          const payload = parseRevealPayload(plaintext)
          if (!payload) return
          const tracked = trackerRef.current
            .peers()
            .find((peer) => peer.webIdCommitment === payload.senderCommitment)
          if (tracked && tracked.stellarPublicKey !== message.envelope.senderStellarPublicKey) {
            return
          }
          const revealed: RevealedPeer = {
            commitment: payload.senderCommitment,
            webId: payload.webId,
            dmPublicKeyJwk: payload.dmPublicKeyJwk,
            stellarPublicKey: message.envelope.senderStellarPublicKey,
            revealedAt: new Date().toISOString(),
          }
          setRevealedPeers((existing) => [
            revealed,
            ...existing.filter((peer) => peer.webId !== revealed.webId),
          ])
        })
        .catch(() => undefined)
    }

    void transport
      .subscribe(topics, handler)
      .then((unsub) => {
        if (cancelled) {
          void unsub().catch(() => undefined)
          return
        }
        unsubscribe = unsub
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPresenceError(err instanceof Error ? err.message : 'Reveal subscription failed.')
        }
      })

    return () => {
      cancelled = true
      if (unsubscribe) {
        void unsubscribe().catch(() => undefined)
      }
    }
  }, [appPrefix, connected, dmKeyPair, ownCommitments, transport])

  const revealToPeer = useCallback(
    async (peer: PresencePeer): Promise<void> => {
      if (!connected || !transport || !signer || !webId) {
        throw new Error('Local mesh is not connected.')
      }
      if (!dmKeyPair) {
        throw new Error('No DM session key available on this device.')
      }
      if (!peer.dmPublicKeyJwk) {
        throw new Error('This peer does not accept reveals (no DM key in their beacon).')
      }
      const commitment =
        ownCommitments[0] ?? (await presenceCommitment(webId, presenceEpoch(new Date())))
      const sealed = await encryptDmBody(
        peer.dmPublicKeyJwk,
        createRevealPayload({
          webId,
          dmPublicKeyJwk: dmKeyPair.publicJwk,
          senderCommitment: commitment,
        }),
      )
      const envelope = await createEnvelope(signer, {
        senderWebId: presenceSenderId(commitment),
        kind: 'reveal',
        body: createRevealBody(sealed),
      })
      await transport.publish(revealTopic(appPrefix, peer.webIdCommitment), envelope, {
        ephemeral: true,
      })
      setRevealedTo((existing) =>
        existing.includes(peer.webIdCommitment) ? existing : [...existing, peer.webIdCommitment],
      )
    },
    [appPrefix, connected, dmKeyPair, ownCommitments, signer, transport, webId],
  )

  // Sweep expired peers on a slower cadence.
  useEffect((): (() => void) | void => {
    if (!connected) return
    const interval = setInterval(() => {
      if (trackerRef.current.sweep() > 0) {
        setPresentPeers(trackerRef.current.peers())
      }
    }, SWEEP_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [connected])

  const presenceStatus: PresenceStatus =
    wakuStatus === 'disabled'
      ? 'disabled'
      : presenceError !== null
        ? 'error'
        : connected && currentH3
          ? 'active'
          : 'waiting'

  const value = useMemo<PresenceContextValue>(
    () => ({ presentPeers, presenceStatus, presenceError, revealedPeers, revealedTo, revealToPeer }),
    [presentPeers, presenceStatus, presenceError, revealedPeers, revealedTo, revealToPeer],
  )

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
}

/**
 * Hook to access live presence state.
 * Must be used inside a `PresenceProvider`.
 */
export function usePresence(): PresenceContextValue {
  const ctx = useContext(PresenceContext)
  if (!ctx) throw new Error('usePresence must be used inside <PresenceProvider>')
  return ctx
}
