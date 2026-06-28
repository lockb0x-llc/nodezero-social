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

interface AttestationDetails {
  registeredWebId: string | null
  lockboxStateRoot: string | null
  registerTxHash: string | null
  verifiedAt: string | null
  custodyClaimHash: string | null
}

interface CustodyReceipt {
  jobId: string
  challengeId: string
  verifiedAt: string
  claimHash: string
}

interface PairingAttestationRecord {
  proofVersion: number
  webId: string
  stellarPublicKey: string
  identityContractId: string
  lockboxContractId: string
  lockboxStateRoot: string
  registerTxHash: string
  verifiedAt: string
  custodyReceipt?: CustodyReceipt
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
    record.proofVersion >= 1 &&
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
      custodyReceipt:
        parsed.custodyReceipt &&
        typeof parsed.custodyReceipt.jobId === 'string' &&
        typeof parsed.custodyReceipt.challengeId === 'string' &&
        typeof parsed.custodyReceipt.verifiedAt === 'string' &&
        typeof parsed.custodyReceipt.claimHash === 'string'
          ? {
              jobId: parsed.custodyReceipt.jobId,
              challengeId: parsed.custodyReceipt.challengeId,
              verifiedAt: parsed.custodyReceipt.verifiedAt,
              claimHash: parsed.custodyReceipt.claimHash,
            }
          : undefined,
    }
  } catch {
    return null
  }
}

interface ProvisionerChallenge {
  challengeId: string
  nonce: string
  domain: string
  expiresAt: string
  envProfile: string
  handle: string
  webId: string
  podUrl: string
}

interface ProvisionerSubmitResponse {
  status: 'ready' | 'pending'
  jobId: string
}

interface ProvisionerStatusReady {
  status: 'ready'
  jobId: string
  custodyReceipt?: {
    challengeId: string
    verifiedAt: string
    claimHash: string
  }
}

function extractPodIdentity(webId: string): { handle: string; podUrl: string; podSlug: string } {
  const parsed = new URL(webId)
  const hostname = parsed.hostname
  const hostLabel = hostname.split('.')[0] ?? 'nodezero'
  const cleaned = hostLabel.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const handle = cleaned.length > 0 ? cleaned : 'nodezero'
  return {
    handle,
    podSlug: handle,
    podUrl: `${parsed.origin}/`,
  }
}

function buildAttestationChallengePayload(challenge: ProvisionerChallenge): string {
  return [
    'NZ_ATTEST_V1',
    challenge.domain,
    challenge.envProfile,
    challenge.nonce,
    challenge.expiresAt,
    challenge.handle,
    challenge.webId,
    challenge.podUrl,
  ].join('|')
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T
  if (!response.ok) {
    const maybeError = body as { error?: string }
    throw new Error(maybeError.error ?? `Provisioner request failed (${response.status}).`)
  }
  return body
}

async function runCustodyProvisioning(params: {
  provisionerUrl: string
  webId: string
  wallet: WalletService
}): Promise<CustodyReceipt> {
  const { provisionerUrl, webId, wallet } = params
  const baseUrl = provisionerUrl.replace(/\/$/, '')
  const identity = extractPodIdentity(webId)

  const challengeResponse = await fetch(`${baseUrl}/v1/bootstrap-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: identity.handle,
      webId,
      podUrl: identity.podUrl,
    }),
  })
  const challenge = await parseJsonResponse<ProvisionerChallenge>(challengeResponse)
  const challengePayload = buildAttestationChallengePayload(challenge)
  const signature = await wallet.signAttestationChallenge(challengePayload)

  const submitResponse = await fetch(`${baseUrl}/v1/provision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: identity.handle,
      podSlug: identity.podSlug,
      webId,
      podUrl: identity.podUrl,
      stellarPublicKey: signature.stellarPublicKey,
      challengeId: challenge.challengeId,
      signatureBase64: signature.signatureBase64,
    }),
  })
  const submit = await parseJsonResponse<ProvisionerSubmitResponse>(submitResponse)

  const statusResponse = await fetch(`${baseUrl}/v1/provision/${submit.jobId}`)
  const status = await parseJsonResponse<ProvisionerStatusReady>(statusResponse)

  if (status.status !== 'ready' || !status.custodyReceipt) {
    throw new Error('Provisioner did not return a ready custody receipt.')
  }

  return {
    jobId: status.jobId,
    challengeId: status.custodyReceipt.challengeId,
    verifiedAt: status.custodyReceipt.verifiedAt,
    claimHash: status.custodyReceipt.claimHash,
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
  /** Machine-verifiable attestation details for QA and diagnostics. */
  attestationDetails: AttestationDetails
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
  const [attestationDetails, setAttestationDetails] = useState<AttestationDetails>({
    registeredWebId: null,
    lockboxStateRoot: null,
    registerTxHash: null,
    verifiedAt: null,
    custodyClaimHash: null,
  })
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
      setAttestationDetails({
        registeredWebId: null,
        lockboxStateRoot: null,
        registerTxHash: null,
        verifiedAt: null,
        custodyClaimHash: null,
      })
      lastCheckedKeyRef.current = null
      return
    }

    void (async (): Promise<void> => {
      const service = getWalletService()
      const info = walletInfo ?? (await service.getWalletInfo())
      const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
      const identityContractId = appExtra?.identityContractId ?? ''
      const lockboxContractId = appExtra?.lockboxContractId ?? ''
      const provisionerUrl = appExtra?.jssProvisionerUrl ?? ''

      if (!identityContractId || !lockboxContractId) {
        setAttestationStatus('error')
        setAttestationMessage('Missing identity or lockbox contract ID in app configuration.')
        setAttestationDetails({
          registeredWebId: null,
          lockboxStateRoot: null,
          registerTxHash: null,
          verifiedAt: null,
          custodyClaimHash: null,
        })
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
        let custodyReceipt = priorRecord?.custodyReceipt

        if (!isReturningSignIn && mappedWebId !== webId) {
          registerTxHash = await registerIdentity(webId, identityContractId)
          mappedWebId = await service.getRegisteredWebId(identityContractId)
        }

        if (!isReturningSignIn && provisionerUrl) {
          custodyReceipt = await runCustodyProvisioning({
            provisionerUrl,
            webId,
            wallet: service,
          })
        }

        const lockboxRoot = await service.getLockboxStateRoot(lockboxContractId)

        if (mappedWebId !== webId) {
          setAttestationStatus('unlinked')
          setAttestationMessage('Wallet/WebID on-chain mapping mismatch. Please relink your identity.')
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: lockboxRoot,
            registerTxHash: registerTxHash || null,
            verifiedAt: null,
            custodyClaimHash: custodyReceipt?.claimHash ?? null,
          })
          return
        }

        if (!lockboxRoot) {
          setAttestationStatus('unlinked')
          setAttestationMessage('No attested lockbox root found yet for pairing verification.')
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: null,
            registerTxHash: registerTxHash || null,
            verifiedAt: null,
            custodyClaimHash: custodyReceipt?.claimHash ?? null,
          })
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
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: lockboxRoot,
            registerTxHash: priorRecord.registerTxHash || null,
            verifiedAt: priorRecord.verifiedAt,
            custodyClaimHash: priorRecord.custodyReceipt?.claimHash ?? null,
          })
          return
        }

        const verifiedAt = new Date().toISOString()

        const record: PairingAttestationRecord = {
          proofVersion: 2,
          webId,
          stellarPublicKey: info.publicKey,
          identityContractId,
          lockboxContractId,
          lockboxStateRoot: lockboxRoot,
          registerTxHash,
          verifiedAt,
          custodyReceipt,
        }
        await AsyncStorage.setItem(PAIRING_ATTESTATION_STORAGE_KEY, JSON.stringify(record))

        setAttestationStatus('verified')
        setAttestationDetails({
          registeredWebId: mappedWebId,
          lockboxStateRoot: lockboxRoot,
          registerTxHash: registerTxHash || priorRecord?.registerTxHash || null,
          verifiedAt,
          custodyClaimHash: custodyReceipt?.claimHash ?? null,
        })
        setAttestationMessage(
          isReturningSignIn
            ? 'Returning sign-in proof verified against current lockbox root.'
            : 'Pairing attestation verified against current lockbox root.'
        )
      } catch (err) {
        setAttestationStatus('error')
        setAttestationMessage(err instanceof Error ? err.message : 'Pairing verification failed.')
        setAttestationDetails({
          registeredWebId: null,
          lockboxStateRoot: null,
          registerTxHash: null,
          verifiedAt: null,
          custodyClaimHash: null,
        })
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
      attestationDetails,
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
