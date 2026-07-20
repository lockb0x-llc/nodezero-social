/**
 * @module WakuContext
 *
 * Provides the Waku pub/sub transport to the component tree.
 *
 * The transport is the ephemeral messaging plane (presence beacons, local
 * broadcast, DMs); durable state stays in the user's Solid Pod. It starts
 * only when ALL of the following hold:
 *  - NZ_WAKU_BOOTSTRAP_PEERS is configured for the active profile,
 *  - the NodeZero session is authenticated, and
 *  - the on-chain lockb0x attestation is verified.
 * Otherwise the context reports 'disabled'/'idle' and the app behaves exactly
 * as before the Waku rollout (dual-stack safety until the Phase 5 cutover).
 *
 * Envelopes are signed with the device Stellar key via the embedded wallet;
 * the secret never leaves the WalletContext.
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
import Constants from 'expo-constants'
import {
  appPrefixForProfile,
  createWakuTransport,
  type EnvelopeSigner,
  type MessageTransport,
} from '@nodezero/waku-comms'
import { useNodeZeroSession } from './NodeZeroSessionContext'
import { useWallet } from './WalletContext'

/** Lifecycle of the app-level Waku transport. */
export type WakuStatus =
  /** No bootstrap peers configured for this profile — Waku plane is off. */
  | 'disabled'
  /** Waiting for an authenticated + attested session. */
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error'

interface WakuContextValue {
  /** Started transport, or null unless status is 'connected'/'connecting'. */
  transport: MessageTransport | null
  status: WakuStatus
  /** Human-readable error detail when status is 'error'. */
  error: string | null
  /** Environment-scoped content-topic prefix (e.g. 'nodezero-staging'). */
  appPrefix: string
  /** Envelope signer bound to the device Stellar key, or null pre-wallet. */
  signer: EnvelopeSigner | null
}

const WakuContext = createContext<WakuContextValue | null>(null)

function readExtra(): { bootstrapPeers: string[]; clusterId: number; envProfile: string } {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>
  const rawPeers = extra.wakuBootstrapPeers
  const bootstrapPeers = Array.isArray(rawPeers)
    ? rawPeers.filter((peer): peer is string => typeof peer === 'string' && peer.length > 0)
    : []
  const clusterId = Number.parseInt(String(extra.wakuClusterId ?? '0'), 10) || 0
  const envProfile = typeof extra.envProfile === 'string' ? extra.envProfile : 'local'
  return { bootstrapPeers, clusterId, envProfile }
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

/** Provides the Waku transport + envelope signer to child components. */
export function WakuProvider({ children }: { children: ReactNode }): JSX.Element {
  const { status: sessionStatus } = useNodeZeroSession()
  const { walletInfo, attestationStatus, signAttestationChallenge } = useWallet()

  const { bootstrapPeers, clusterId, envProfile } = useMemo(readExtra, [])
  const appPrefix = useMemo(() => appPrefixForProfile(envProfile), [envProfile])

  const [transport, setTransport] = useState<MessageTransport | null>(null)
  const [status, setStatus] = useState<WakuStatus>(bootstrapPeers.length > 0 ? 'idle' : 'disabled')
  const [error, setError] = useState<string | null>(null)
  const generationRef = useRef(0)

  const walletPublicKey = walletInfo?.publicKey ?? null

  // Canonical envelope bytes are UTF-8 JSON text, so they round-trip through
  // the wallet's string-based challenge signer without loss.
  const signer = useMemo<EnvelopeSigner | null>(() => {
    if (!walletPublicKey) return null
    return {
      stellarPublicKey: walletPublicKey,
      sign: async (payload: Uint8Array): Promise<Uint8Array> => {
        const { signatureBase64 } = await signAttestationChallenge(
          new TextDecoder().decode(payload),
        )
        return base64ToBytes(signatureBase64)
      },
    }
  }, [signAttestationChallenge, walletPublicKey])

  const enabled =
    bootstrapPeers.length > 0 &&
    sessionStatus === 'authenticated' &&
    attestationStatus === 'verified' &&
    walletPublicKey !== null

  useEffect((): (() => void) | void => {
    if (!enabled) {
      setTransport(null)
      setStatus(bootstrapPeers.length > 0 ? 'idle' : 'disabled')
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    let active: MessageTransport | null = null

    setStatus('connecting')
    setError(null)

    void (async (): Promise<void> => {
      try {
        const created = await createWakuTransport({
          bootstrapPeers,
          appPrefix,
          clusterId,
          allowInsecureWs: envProfile === 'local',
        })
        created.on('connected', () => {
          if (generationRef.current === generation) setStatus('connected')
        })
        created.on('disconnected', () => {
          if (generationRef.current === generation) setStatus('connecting')
        })
        created.on('error', (err) => {
          if (generationRef.current === generation) setError(err.message)
        })
        await created.start()
        if (generationRef.current !== generation) {
          await created.stop().catch(() => undefined)
          return
        }
        active = created
        setTransport(created)
        setStatus('connected')
      } catch (err) {
        if (generationRef.current === generation) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to start Waku transport.')
        }
      }
    })()

    return () => {
      generationRef.current += 1
      setTransport(null)
      if (active) {
        void active.stop().catch(() => undefined)
      }
    }
    // bootstrapPeers/clusterId/envProfile are stable for an app session (from
    // the build-time config); enabled captures the auth/attestation gates.
  }, [enabled])

  const value = useMemo<WakuContextValue>(
    () => ({ transport, status, error, appPrefix, signer }),
    [transport, status, error, appPrefix, signer],
  )

  return <WakuContext.Provider value={value}>{children}</WakuContext.Provider>
}

/**
 * Hook to access the Waku transport state.
 * Must be used inside a `WakuProvider`.
 */
export function useWaku(): WakuContextValue {
  const ctx = useContext(WakuContext)
  if (!ctx) throw new Error('useWaku must be used inside <WakuProvider>')
  return ctx
}
