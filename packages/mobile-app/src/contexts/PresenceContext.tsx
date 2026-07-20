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
 * The raw WebID is only exchanged during the mutual-reveal DM handshake
 * (Phase 4). Raw GPS never appears anywhere — only H3 cell indexes.
 */

import React, {
  createContext,
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
  presenceCommitment,
  presenceEpoch,
  presenceSenderId,
  presenceTopic,
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

interface PresenceContextValue {
  /** Verified, unexpired peers present in the surrounding cells. */
  presentPeers: PresencePeer[]
  presenceStatus: PresenceStatus
  /** Human-readable error detail when presenceStatus is 'error'. */
  presenceError: string | null
}

const PresenceContext = createContext<PresenceContextValue | null>(null)

/** Publishes presence beacons and tracks live peers in nearby cells. */
export function PresenceProvider({ children }: { children: ReactNode }): JSX.Element {
  const { transport, status: wakuStatus, appPrefix, signer } = useWaku()
  const { currentNode, surroundingNodes } = useDiscovery()
  const { webId } = useNodeZeroSession()

  const [presentPeers, setPresentPeers] = useState<PresencePeer[]>([])
  const [presenceError, setPresenceError] = useState<string | null>(null)

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
        if (cancelled) return

        const envelope = await createEnvelope(signer, {
          senderWebId: presenceSenderId(commitment),
          kind: 'presence',
          body: createPresenceBeaconBody({
            webIdCommitment: commitment,
            h3Index: currentH3,
            capabilities: ['chat'],
            expiresAt: new Date(now.getTime() + PRESENCE_BEACON_TTL_MS).toISOString(),
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
  }, [appPrefix, connected, currentH3, signer, transport, webId])

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
    () => ({ presentPeers, presenceStatus, presenceError }),
    [presentPeers, presenceStatus, presenceError],
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
