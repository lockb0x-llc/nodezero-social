/**
 * @module WalletContext
 *
 * Provides the embedded Stellar wallet to all components.
 * The wallet is provisioned silently on first launch – users never see a
 * seed phrase or wallet address unless they explicitly navigate to Settings.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { EnclaveAdapter, WalletService, type WalletInfo } from '@nodezero/embedded-wallet'
import Constants from 'expo-constants'
import { useSolid } from './SolidContext'

type AttestationStatus = 'idle' | 'verifying' | 'verified' | 'unlinked' | 'error'

interface PairingAttestationRecord {
  proofVersion: number
  webId: string
  stellarPublicKey: string
  identityContractId: string
  lockboxContractId: string
  lockboxStateRoot: string
  registerTxHash: string
  verifiedAt: string
}

const PAIRING_ATTESTATION_STORAGE_KEY = 'attestation.pairing.v1'

interface PairingProofInputs {
  webId: string
  stellarPublicKey: string
  identityContractId: string
  lockboxContractId: string
  lockboxStateRoot: string
}

function normalizeRoot(root: string): string {
  return root.trim().toLowerCase()
}

function hasMatchingProof(record: PairingAttestationRecord, inputs: PairingProofInputs): boolean {
  return (
    record.proofVersion === 1 &&
    record.webId === inputs.webId &&
    record.stellarPublicKey === inputs.stellarPublicKey &&
    record.identityContractId === inputs.identityContractId &&
    record.lockboxContractId === inputs.lockboxContractId &&
    normalizeRoot(record.lockboxStateRoot) === normalizeRoot(inputs.lockboxStateRoot)
  )
}

async function loadPairingRecord(): Promise<PairingAttestationRecord | null> {
  const raw = await AsyncStorage.getItem(PAIRING_ATTESTATION_STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<PairingAttestationRecord>
    if (
      typeof parsed.webId !== 'string' ||
      typeof parsed.stellarPublicKey !== 'string' ||
      typeof parsed.identityContractId !== 'string' ||
      typeof parsed.lockboxContractId !== 'string' ||
      typeof parsed.lockboxStateRoot !== 'string' ||
      typeof parsed.verifiedAt !== 'string' ||
      typeof parsed.proofVersion !== 'number'
    ) {
      return null
    }

    return {
      proofVersion: parsed.proofVersion,
      webId: parsed.webId,
      stellarPublicKey: parsed.stellarPublicKey,
      identityContractId: parsed.identityContractId,
      lockboxContractId: parsed.lockboxContractId,
      lockboxStateRoot: parsed.lockboxStateRoot,
      registerTxHash: typeof parsed.registerTxHash === 'string' ? parsed.registerTxHash : '',
      verifiedAt: parsed.verifiedAt,
    }
  } catch {
    return null
  }
}

/** Shape of the wallet context value. */
interface WalletContextValue {
  /** Basic wallet info (public key, funded status), or `null` while loading. */
  walletInfo: WalletInfo | null
  /** Whether the wallet is currently loading / initialising. */
  isLoading: boolean
  /** Registers the user's WebID on-chain against their Stellar public key. */
  registerIdentity: (webId: string, contractId?: string) => Promise<string>
  /** Current pairing verification status for this session. */
  attestationStatus: AttestationStatus
  /** Human-readable status detail for pairing checks. */
  attestationMessage: string | null
}

const WalletContext = createContext<WalletContextValue | null>(null)

// Singleton instances – only created once per app session.
let _adapter: EnclaveAdapter | null = null
let _walletService: WalletService | null = null

function assertNetworkCoherence(appExtra: Record<string, string> | undefined): void {
  const envProfile = appExtra?.envProfile ?? 'local'
  const rpcUrl = appExtra?.stellarRpcUrl ?? ''
  const networkPassphrase = appExtra?.stellarNetworkPassphrase ?? ''

  const expected = {
    'staging-testnet': {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      passphrase: 'Test SDF Network ; September 2015',
    },
    'production-mainnet': {
      rpcUrl: 'https://soroban.stellar.org',
      passphrase: 'Public Global Stellar Network ; September 2015',
    },
  } as const

  if (envProfile === 'local') return

  const profile = expected[envProfile as keyof typeof expected]
  if (!profile) {
    throw new Error(`Unsupported envProfile '${envProfile}'.`)
  }

  if (rpcUrl !== profile.rpcUrl || networkPassphrase !== profile.passphrase) {
    throw new Error(
      `Environment mismatch for '${envProfile}'. Expected rpc/passphrase '${profile.rpcUrl}'/'${profile.passphrase}'.`
    )
  }
}

function getWalletService(): WalletService {
  if (!_adapter) {
    // expo-secure-store relies on native bridge methods (getValueWithKeyAsync)
    // that are unavailable in web/browser contexts. Fall back to EnclaveAdapter's
    // built-in in-memory store on web so the wallet can still provision.
    const store = Platform.OS === 'web' ? undefined : SecureStore
    _adapter = new EnclaveAdapter(store)
  }
  if (!_walletService) {
    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const rpcUrl = appExtra?.stellarRpcUrl ?? 'https://soroban-testnet.stellar.org'
    const networkPassphrase = appExtra?.stellarNetworkPassphrase ?? 'Test SDF Network ; September 2015'
    assertNetworkCoherence(appExtra)

    _walletService = new WalletService(_adapter, rpcUrl, networkPassphrase)
  }
  return _walletService
}

/**
 * Provisions and exposes the embedded Stellar wallet.
 */
export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const { isLoggedIn, isRestoring, webId } = useSolid()
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [attestationStatus, setAttestationStatus] = useState<AttestationStatus>('idle')
  const [attestationMessage, setAttestationMessage] = useState<string | null>(null)
  const lastCheckedKeyRef = useRef<string | null>(null)

  useEffect(() => {
    void (async (): Promise<void> => {
      try {
        const info = await getWalletService().getWalletInfo()
        setWalletInfo(info)
      } catch (err) {
        console.warn('[WalletContext] Failed to load wallet info:', err)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const registerIdentity = useCallback(async (webId: string, contractId?: string): Promise<string> => {
    const service = getWalletService()
    const info = walletInfo ?? (await service.getWalletInfo())
    const defaultContractId =
      (Constants.expoConfig?.extra as Record<string, string> | undefined)?.identityContractId ?? ''
    const resolvedContractId = contractId ?? defaultContractId

    if (!resolvedContractId) {
      throw new Error('Missing identity contract ID. Set NZ_IDENTITY_CONTRACT_ID in app configuration.')
    }

    const result = await service.registerIdentityOnChain(
      { webId, stellarPublicKey: info.publicKey },
      resolvedContractId
    )
    return result.hash
  }, [walletInfo])

  useEffect(() => {
    if (isRestoring) return

    if (!isLoggedIn || !webId) {
      setAttestationStatus('idle')
      setAttestationMessage(null)
      lastCheckedKeyRef.current = null
      return
    }

    void (async (): Promise<void> => {
      const service = getWalletService()
      const info = walletInfo ?? (await service.getWalletInfo())
      const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
      const identityContractId = appExtra?.identityContractId ?? ''
      const lockboxContractId = appExtra?.lockboxContractId ?? ''

      if (!identityContractId || !lockboxContractId) {
        setAttestationStatus('error')
        setAttestationMessage('Missing identity or lockbox contract ID in app configuration.')
        return
      }

      const checkKey = `${webId}|${info.publicKey}|${identityContractId}|${lockboxContractId}`
      if (lastCheckedKeyRef.current === checkKey) return
      lastCheckedKeyRef.current = checkKey

      setAttestationStatus('verifying')
      setAttestationMessage('Validating Stellar<->Solid pairing attestation...')

      try {
        let mappedWebId = await service.getRegisteredWebId(identityContractId)
        const priorRecord = await loadPairingRecord()
        const isReturningSignIn =
          priorRecord?.webId === webId &&
          priorRecord.stellarPublicKey === info.publicKey &&
          priorRecord.identityContractId === identityContractId &&
          priorRecord.lockboxContractId === lockboxContractId

        let registerTxHash = ''

        if (!isReturningSignIn && mappedWebId !== webId) {
          registerTxHash = await registerIdentity(webId, identityContractId)
          mappedWebId = await service.getRegisteredWebId(identityContractId)
        }

        const lockboxRoot = await service.getLockboxStateRoot(lockboxContractId)

        if (mappedWebId !== webId) {
          setAttestationStatus('unlinked')
          setAttestationMessage('Wallet/WebID on-chain mapping mismatch. Please relink your identity.')
          return
        }

        if (!lockboxRoot) {
          setAttestationStatus('unlinked')
          setAttestationMessage('No attested lockbox root found yet for pairing verification.')
          return
        }

        const proofInputs: PairingProofInputs = {
          webId,
          stellarPublicKey: info.publicKey,
          identityContractId,
          lockboxContractId,
          lockboxStateRoot: lockboxRoot,
        }

        if (isReturningSignIn && priorRecord && !hasMatchingProof(priorRecord, proofInputs)) {
          setAttestationStatus('unlinked')
          setAttestationMessage('Stored pairing proof no longer matches the current lockbox root. Relink required.')
          return
        }

        const record: PairingAttestationRecord = {
          proofVersion: 1,
          webId,
          stellarPublicKey: info.publicKey,
          identityContractId,
          lockboxContractId,
          lockboxStateRoot: lockboxRoot,
          registerTxHash,
          verifiedAt: new Date().toISOString(),
        }
        await AsyncStorage.setItem(PAIRING_ATTESTATION_STORAGE_KEY, JSON.stringify(record))

        setAttestationStatus('verified')
        setAttestationMessage(
          isReturningSignIn
            ? 'Returning sign-in proof verified against current lockbox root.'
            : 'Pairing attestation verified against current lockbox root.'
        )
      } catch (err) {
        setAttestationStatus('error')
        setAttestationMessage(err instanceof Error ? err.message : 'Pairing verification failed.')
      }
    })()
  }, [isLoggedIn, isRestoring, registerIdentity, walletInfo, webId])

  return (
    <WalletContext.Provider value={{
      walletInfo,
      isLoading,
      registerIdentity,
      attestationStatus,
      attestationMessage,
    }}>
      {children}
    </WalletContext.Provider>
  )
}

/**
 * Hook to access the embedded wallet.
 * Must be used inside a `WalletProvider`.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>')
  return ctx
}
