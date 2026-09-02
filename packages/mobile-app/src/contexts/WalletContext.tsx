/**
 * @module WalletContext
 *
 * Provides the embedded Stellar wallet to all components.
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
import {
  EnclaveAdapter,
  IndexedDbSecureStore,
  WalletService,
  type WalletInfo,
  type WalletIdentity,
} from '@nodezero/embedded-wallet'
import { produceSeamlessAttestation, type SeamlessAttestation } from '../onboarding/attestation'
import type { OnboardingConfigDescriptor } from '../onboarding/seamlessSignup'
import type { ProgressStep } from '../components/ProgressStepLadder'
import Constants from 'expo-constants'
import { useNodeZeroSession } from './NodeZeroSessionContext'
import { RECOVERY_BUNDLE_VERSION, sealRecoveryBundle } from '../wallet/recoveryBundle'

type AttestationStatus = 'idle' | 'verifying' | 'verified' | 'unlinked' | 'error'

interface AttestationDetails {
  registeredWebId: string | null
  lockboxStateRoot: string | null
  registerTxHash: string | null
  verifiedAt: string | null
  custodyClaimHash: string | null
  lockboxFactoryContractId: string | null
  userLockboxContractId: string | null
  lockboxIdempotencyKey: string | null
  proofHashHex: string | null
  proofRootHex: string | null
}

const PAIRING_ATTESTATION_STORAGE_KEY = 'attestation.pairing.v1'
const SOLID_WEBID_STORAGE_KEY = 'solid.webId.v1'

interface DeleteNodeDataResult {
  unlinkedIdentity: boolean
  walletDestroyed: boolean
  localStateCleared: boolean
  warnings: string[]
}

export interface WalletIdentitySummary extends WalletIdentity {
  stellarPublicKey: string | null
  secretAvailable: boolean
  active: boolean
}

/** Shape of the wallet context value. */
interface WalletContextValue {
  /** Basic wallet info (public key, funded status), or `null` while loading. */
  walletInfo: WalletInfo | null
  /** Local identities available on this device. */
  identities: WalletIdentity[]
  /** Current selected identity key id, or null while loading. */
  activeIdentityKeyId: string | null
  /** Whether the wallet is currently loading / initialising. */
  isLoading: boolean
  /** Sanitized wallet initialization failure, or null when the wallet is usable. */
  initializationError: string | null
  /** Whether identity switch/create work is currently running. */
  isIdentityBusy: boolean
  /** Current pairing verification status for this session. */
  attestationStatus: AttestationStatus
  /** Human-readable status detail for pairing checks. */
  attestationMessage: string | null
  /**
   * Step ladder for the sign-in attestation verification flow. Empty when no
   * verification is in progress. Steps advance as each major operation
   * completes; a failed operation is marked with an error status.
   */
  verificationSteps: ProgressStep[]
  /** Machine-verifiable attestation details for QA and diagnostics. */
  attestationDetails: AttestationDetails
  /** Builds a portable, password-encrypted recovery bundle for export. */
  exportRecoveryBundle: (passphrase: string) => Promise<{ fileName: string; json: string }>
  /**
   * Produces the on-device Pod-ownership attestation (a `pod_ownership` Groth16
   * proof + Stellar-encrypted claim) for the seamless onboarding flow. The
   * wallet secret never leaves the context.
   */
  createSeamlessAttestation: (
    webId: string,
    podUrl: string,
    stellarPublicKey: string,
    onboardingConfig: OnboardingConfigDescriptor,
  ) => Promise<SeamlessAttestation>
  /**
   * Signs an arbitrary UTF-8 string with the device Stellar keypair and
   * returns the base64-encoded signature together with the public key.
   * Used by the Stellar sign-in flow to prove keypair ownership to the
   * provisioner without transmitting the private key.
   */
  signAttestationChallenge: (challengePayload: string, keyId?: string) => Promise<{
    stellarPublicKey: string
    challengePayload: string
    signatureBase64: string
  }>
  /** Lists public identity metadata without exposing private keys. */
  listIdentitySummaries: () => Promise<WalletIdentitySummary[]>
  /** Reads the deployed lockb0x commitment using the active device wallet. */
  getLockboxAccountCommitment: (contractId: string) => Promise<string | null>
  /** Returns Poseidon(identitySecret) without exposing the device secret. */
  deriveAccountCommitment: () => Promise<string>
  /** Sets the active local identity used for sign-in and onboarding. */
  selectIdentity: (keyId: string) => Promise<void>
  /** Creates a new local identity and sets it active. */
  createIdentity: (label?: string) => Promise<void>
  /** Imports a recovery identity into the local encrypted wallet. */
  importRecoveryIdentity: (input: {
    secret: string
    expectedPublicKey: string
    label?: string
  }) => Promise<WalletInfo>
  /** Finds a local identity by public key without exposing its secret. */
  findIdentityKeyIdByPublicKey: (stellarPublicKey: string) => Promise<string | null>
  /** Destroys local wallet + pairing state, optionally unlinking on-chain. */
  deleteNodeData: (options?: {
    unlinkIdentity?: boolean
    clearAllLocalCache?: boolean
  }) => Promise<DeleteNodeDataResult>
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
    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const envProfile = appExtra?.envProfile ?? 'local'
    const store = Platform.OS === 'web'
      ? new IndexedDbSecureStore({ profile: envProfile })
      : SecureStore
    _adapter = new EnclaveAdapter(store)
  }
  if (!_walletService) {
    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const rpcUrl = appExtra?.stellarRpcUrl ?? 'https://soroban-testnet.stellar.org'
    const networkPassphrase =
      appExtra?.stellarNetworkPassphrase ?? 'Test SDF Network ; September 2015'
    assertNetworkCoherence(appExtra)

    _walletService = new WalletService(_adapter, rpcUrl, networkPassphrase)
  }
  return _walletService
}

/**
 * Provisions and exposes the embedded Stellar wallet.
 */
export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const {
    status: sessionStatus,
    webId,
    stellarPublicKey: sessionStellarPublicKey,
    lockbox,
    sessionCreatedAt,
  } = useNodeZeroSession()
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
  const [identities, setIdentities] = useState<WalletIdentity[]>([])
  const [activeIdentityKeyId, setActiveIdentityKeyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [initializationError, setInitializationError] = useState<string | null>(null)
  const [isIdentityBusy, setIsIdentityBusy] = useState(false)
  const [attestationStatus, setAttestationStatus] = useState<AttestationStatus>('idle')
  const [attestationMessage, setAttestationMessage] = useState<string | null>(null)
  const [verificationSteps, setVerificationSteps] = useState<ProgressStep[]>([])
  const [attestationDetails, setAttestationDetails] = useState<AttestationDetails>({
    registeredWebId: null,
    lockboxStateRoot: null,
    registerTxHash: null,
    verifiedAt: null,
    custodyClaimHash: null,
    lockboxFactoryContractId: null,
    userLockboxContractId: null,
    lockboxIdempotencyKey: null,
    proofHashHex: null,
    proofRootHex: null,
  })
  const lastCheckedKeyRef = useRef<string | null>(null)

  const listIdentitySummaries = useCallback(async (): Promise<WalletIdentitySummary[]> => {
    const service = getWalletService()
    const [listed, active] = await Promise.all([
      service.listIdentities(),
      service.getActiveIdentityKeyId(),
    ])
    return Promise.all(
      listed.map(async (identity) => {
        try {
          return {
            ...identity,
            stellarPublicKey: await service.getWalletPublicKeyForIdentity(identity.keyId),
            secretAvailable: true,
            active: identity.keyId === active,
          }
        } catch {
          return {
            ...identity,
            stellarPublicKey: null,
            secretAvailable: false,
            active: identity.keyId === active,
          }
        }
      })
    )
  }, [])

  const refreshIdentities = useCallback(async (): Promise<void> => {
    const service = getWalletService()
    const [listed, active] = await Promise.all([
      service.listIdentities(),
      service.getActiveIdentityKeyId(),
    ])
    setIdentities(listed)
    setActiveIdentityKeyId(active)
    setInitializationError(null)
  }, [])

  const hydrateSelectedWallet = useCallback(
    async (keyId: string): Promise<void> => {
      const service = getWalletService()
      const publicKey = await service.getWalletPublicKeyForIdentity(keyId)
      setWalletInfo({ keyId, publicKey, isFunded: false })

      void (async (): Promise<void> => {
        try {
          const hydrated = await service.getWalletInfoForIdentity(keyId)
          setWalletInfo(hydrated)
        } catch (err) {
          console.warn('[WalletContext] Wallet funding hydration failed:', err)
        }
      })()
    },
    []
  )

  /** Initialises the verification ladder: first step active, rest pending. */
  const initVerificationSteps = useCallback((defs: Array<[key: string, label: string]>): void => {
    setVerificationSteps(
      defs.map(([key, label], index) => ({
        key,
        label,
        status: index === 0 ? 'active' : 'pending',
      }))
    )
  }, [])

  /** Marks the given step done and activates the next pending step. */
  const advanceVerificationStep = useCallback((doneKey: string): void => {
    setVerificationSteps((steps) => {
      const doneIndex = steps.findIndex((step) => step.key === doneKey)
      if (doneIndex === -1) return steps
      return steps.map((step, index) => {
        if (index <= doneIndex) return step.status === 'done' ? step : { ...step, status: 'done' }
        if (index === doneIndex + 1 && step.status === 'pending')
          return { ...step, status: 'active' }
        return step
      })
    })
  }, [])

  // Keep the ladder consistent with the overall attestation outcome: a
  // verified session completes every step; an error/unlinked outcome marks
  // the step that was running as failed.
  useEffect(() => {
    if (attestationStatus === 'verified') {
      setVerificationSteps((steps) =>
        steps.map((step) => (step.status === 'done' ? step : { ...step, status: 'done' }))
      )
    } else if (attestationStatus === 'error' || attestationStatus === 'unlinked') {
      setVerificationSteps((steps) =>
        steps.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step))
      )
    }
  }, [attestationStatus])

  useEffect(() => {
    void (async (): Promise<void> => {
      const service = getWalletService()
      try {
        const listed = await service.listIdentities()
        if (listed.length === 0) {
          setIdentities([])
          setActiveIdentityKeyId(null)
          setWalletInfo(null)
          setInitializationError(null)
          return
        }
        const active = (await service.getActiveIdentityKeyId()) ?? listed[0]?.keyId ?? null
        if (!active) throw new Error('Stored wallet identities are unavailable.')
        if (listed.length > 0 && !(await service.getActiveIdentityKeyId())) {
          await service.setActiveIdentity(active)
        }
        await refreshIdentities()
        if (active) {
          await hydrateSelectedWallet(active)
        }
      } catch (err) {
        console.warn('[WalletContext] Failed to load wallet info:', err)
        setInitializationError(
          err instanceof Error ? err.message : 'Wallet initialization failed.'
        )
      } finally {
        setIsLoading(false)
      }
    })()
  }, [
    hydrateSelectedWallet,
    refreshIdentities,
  ])

  const selectIdentity = useCallback(
    async (keyId: string): Promise<void> => {
      setIsIdentityBusy(true)
      try {
        const service = getWalletService()
        await service.setActiveIdentity(keyId)
        await refreshIdentities()
        await hydrateSelectedWallet(keyId)
      } finally {
        setIsIdentityBusy(false)
      }
    },
    [hydrateSelectedWallet, refreshIdentities]
  )

  const createIdentity = useCallback(
    async (label?: string): Promise<void> => {
      setIsIdentityBusy(true)
      try {
        const service = getWalletService()
        const created = await service.createIdentity(label)
        await refreshIdentities()
        setWalletInfo(created)
        void (async (): Promise<void> => {
          try {
            const hydrated = await service.getWalletInfoForIdentity(created.keyId)
            setWalletInfo(hydrated)
          } catch (err) {
            console.warn('[WalletContext] Wallet funding hydration failed:', err)
          }
        })()
      } finally {
        setIsIdentityBusy(false)
      }
    },
    [refreshIdentities]
  )

  const importRecoveryIdentity = useCallback(
    async (input: {
      secret: string
      expectedPublicKey: string
      label?: string
    }): Promise<WalletInfo> => {
      const imported = await getWalletService().importIdentity(input.secret, {
        expectedPublicKey: input.expectedPublicKey,
        ...(input.label ? { label: input.label } : {}),
      })
      await refreshIdentities()
      await hydrateSelectedWallet(imported.keyId)
      return imported
    },
    [hydrateSelectedWallet, refreshIdentities],
  )

  const findIdentityKeyIdByPublicKey = useCallback(
    async (stellarPublicKey: string): Promise<string | null> => {
      const service = getWalletService()
      const identities = await service.listIdentities()
      for (const identity of identities) {
        if ((await service.getWalletPublicKeyForIdentity(identity.keyId)) === stellarPublicKey) {
          return identity.keyId
        }
      }
      return null
    },
    []
  )

  // Fail-closed post-login verification (single path): every account is
  // provisioned with an on-chain per-user lockb0x, and the session carries the
  // anchor metadata. Prove the device still controls the ZK identity anchored
  // on-chain by deriving Poseidon(identitySecret) locally and comparing it to
  // Lockb0x.get_account_commitment(). This runs entirely client-side against
  // chain RPC — the provisioner is not in the loop.
  useEffect(() => {
    if (sessionStatus === 'restoring') return

    if (sessionStatus !== 'authenticated' || !webId) {
      setAttestationStatus('idle')
      setAttestationMessage(null)
      setVerificationSteps([])
      setAttestationDetails({
        registeredWebId: null,
        lockboxStateRoot: null,
        registerTxHash: null,
        verifiedAt: null,
        custodyClaimHash: null,
        lockboxFactoryContractId: null,
        userLockboxContractId: null,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: null,
      })
      lastCheckedKeyRef.current = null
      return
    }

    // Session restoration and wallet initialization are independent.
    if (isLoading || !walletInfo?.publicKey) return

    const lockboxId = lockbox?.userLockboxContractId ?? null
    const checkKey = `session:${webId}|${lockboxId ?? 'none'}|${sessionStellarPublicKey ?? 'none'}`
    if (lastCheckedKeyRef.current === checkKey) return
    lastCheckedKeyRef.current = checkKey

    initVerificationSteps([
      ['session', 'Load your node session'],
      ['anchor', 'Read your on-chain identity anchor'],
      ['identity', 'Confirm this device controls the anchored identity'],
    ])
    advanceVerificationStep('session')

    // Fail-closed: a session is only verified when it carries an on-chain
    // per-user lockb0x contract. A session without one means provisioning did
    // not complete; never report it as verified.
    if (!lockboxId) {
      setAttestationStatus('error')
      setAttestationMessage(
        'Your session is missing its on-chain lockb0x anchor. Re-create your node to finish onboarding.'
      )
      setAttestationDetails({
        registeredWebId: webId,
        lockboxStateRoot: null,
        registerTxHash: null,
        verifiedAt: null,
        custodyClaimHash: null,
        lockboxFactoryContractId: lockbox?.factoryContractId ?? null,
        userLockboxContractId: null,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: lockbox?.proofRootHex ?? null,
      })
      return
    }

    setAttestationStatus('verifying')
    setAttestationMessage('Verifying your on-chain identity attestation…')

    void (async (): Promise<void> => {
      const details = (overrides: Partial<AttestationDetails>): AttestationDetails => ({
        registeredWebId: webId,
        lockboxStateRoot: lockbox?.proofRootHex ?? null,
        registerTxHash: null,
        verifiedAt: null,
        custodyClaimHash: null,
        lockboxFactoryContractId: lockbox?.factoryContractId ?? null,
        userLockboxContractId: lockboxId,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: lockbox?.proofRootHex ?? null,
        ...overrides,
      })
      try {
        // Fresh sessions (< 10 min) may hit Stellar RPC propagation lag where a
        // newly-created lockbox contract hasn't been indexed yet. Retry with
        // exponential backoff before treating a null result as 'unlinked'.
        const SESSION_FRESH_MS = 10 * 60 * 1000
        const isFreshSession = sessionCreatedAt
          ? Date.now() - new Date(sessionCreatedAt).getTime() < SESSION_FRESH_MS
          : false
        const MAX_RETRIES = isFreshSession ? 5 : 1
        const RETRY_BASE_MS = 3_000

        let onchain: string | null | undefined
        let lastRpcError: unknown
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          try {
            onchain = await getWalletService().getLockboxAccountCommitment(lockboxId)
            lastRpcError = undefined
            if (onchain) break
          } catch (rpcErr) {
            lastRpcError = rpcErr
            onchain = undefined
          }
          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_BASE_MS * Math.pow(2, attempt)
            setAttestationMessage(
              `Waiting for on-chain confirmation… (attempt ${attempt + 2}/${MAX_RETRIES})`
            )
            await new Promise<void>((res) => setTimeout(res, delay))
          }
        }
        if (lastRpcError !== undefined) {
          throw lastRpcError as Error
        }
        advanceVerificationStep('anchor')
        if (!onchain) {
          setAttestationStatus('unlinked')
          setAttestationMessage(
            'Your node is missing an on-chain attestation anchor. Re-create your node to link a lockb0x attestation before continuing.'
          )
          setAttestationDetails(details({}))
          return
        }
        const secret = await _adapter?.loadOrCreate(walletInfo?.keyId)
        if (!secret) throw new Error('wallet secret unavailable')
        const { deriveAccountCommitmentHex } =
          await import('@nodezero/zk-crypto/attestation-cipher')
        const deviceCommitment: string = await deriveAccountCommitmentHex(secret)
        const norm = (h: string): string => h.trim().toLowerCase().replace(/^0x/, '')
        if (norm(deviceCommitment) === norm(onchain)) {
          advanceVerificationStep('identity')
          setAttestationStatus('verified')
          setAttestationMessage('On-chain ZK identity attestation verified.')
          setAttestationDetails(
            details({ verifiedAt: sessionCreatedAt ?? new Date().toISOString() })
          )
        } else {
          // Fail-closed: the device does not control the anchored identity.
          setAttestationStatus('error')
          setAttestationMessage(
            'Your device identity does not match the on-chain attestation. Re-create your node to continue.'
          )
          setAttestationDetails(details({}))
        }
      } catch (err) {
        setAttestationStatus('error')
        setAttestationMessage(
          err instanceof Error
            ? `Attestation verification failed: ${err.message}`
            : 'Attestation verification failed.'
        )
        setAttestationDetails(details({}))
      }
    })()
  }, [
    advanceVerificationStep,
    initVerificationSteps,
    isLoading,
    lockbox,
    sessionCreatedAt,
    sessionStatus,
    sessionStellarPublicKey,
    walletInfo?.publicKey,
    webId,
  ])

  const exportRecoveryBundle = useCallback(async (passphrase: string): Promise<{
    fileName: string
    json: string
  }> => {
    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const info = walletInfo ?? (await getWalletService().getWalletInfo())
    const secret = await getWalletService().exportSecret()
    if (!secret) {
      throw new Error('This identity has no exportable secret key on this device.')
    }
    const exportedAt = new Date().toISOString()

    // Wallet keys and WebID are encrypted; only environment binding stays readable so a
    // wrong-lane bundle is rejected before a password is requested.
    const encrypted = await sealRecoveryBundle(
      { webId: webId ?? null, publicKey: info.publicKey, secretKey: secret },
      passphrase
    )

    const bundle = {
      bundleVersion: RECOVERY_BUNDLE_VERSION,
      exportedAt,
      envProfile: appExtra?.envProfile ?? 'local',
      stellarNetworkPassphrase: appExtra?.stellarNetworkPassphrase ?? null,
      encrypted,
    }

    const stamp = exportedAt.replace(/[:.]/g, '').replace(/-/g, '')
    return {
      fileName: `nodezero-recovery-${stamp}.json`,
      json: JSON.stringify(bundle, null, 2),
    }
  }, [walletInfo, webId])

  const deleteNodeData = useCallback(
    async (options?: {
      unlinkIdentity?: boolean
      clearAllLocalCache?: boolean
    }): Promise<DeleteNodeDataResult> => {
      const unlinkIdentity = options?.unlinkIdentity ?? false
      const clearAllLocalCache = options?.clearAllLocalCache ?? false
      const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
      const identityContractId = appExtra?.identityContractId ?? ''
      let unlinkedIdentity = false
      let walletDestroyed = false
      let localStateCleared = false
      const warnings: string[] = []

      if (unlinkIdentity && identityContractId) {
        try {
          await getWalletService().removeIdentityOnChain(identityContractId)
          unlinkedIdentity = true
        } catch (err) {
          const warning = err instanceof Error ? err.message : 'On-chain identity unlink failed.'
          warnings.push(warning)
          console.warn(
            '[WalletContext] On-chain identity unlink failed; continuing local delete:',
            err
          )
        }
      }

      await getWalletService().destroyWallet()
      walletDestroyed = true

      if (clearAllLocalCache) {
        await AsyncStorage.removeItem(PAIRING_ATTESTATION_STORAGE_KEY)
        await AsyncStorage.removeItem(SOLID_WEBID_STORAGE_KEY)
        await AsyncStorage.removeItem('nz.session.v2')
      } else {
        await AsyncStorage.removeItem(PAIRING_ATTESTATION_STORAGE_KEY)
      }
      localStateCleared = true

      lastCheckedKeyRef.current = null
      setWalletInfo(null)
      setIdentities([])
      setActiveIdentityKeyId(null)
      setAttestationStatus('idle')
      setAttestationMessage(null)
      setVerificationSteps([])
      setAttestationDetails({
        registeredWebId: null,
        lockboxStateRoot: null,
        registerTxHash: null,
        verifiedAt: null,
        custodyClaimHash: null,
        lockboxFactoryContractId: null,
        userLockboxContractId: null,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: null,
      })

      return { unlinkedIdentity, walletDestroyed, localStateCleared, warnings }
    },
    []
  )

  const createSeamlessAttestation = useCallback(
    async (
      webId: string,
      podUrl: string,
      stellarPublicKey: string,
      onboardingConfig: OnboardingConfigDescriptor,
    ): Promise<SeamlessAttestation> => {
      // Ensure the wallet service/adapter singletons are initialised, then read
      // the secret via loadOrCreate (mirrors runCustodyProvisioning). On web,
      // adapter.load() can return null even when the key exists, so loadOrCreate
      // is the reliable accessor.
      getWalletService()
      const secret = await _adapter?.loadOrCreate(walletInfo?.keyId)
      if (!secret) {
        throw new Error('Embedded wallet secret is unavailable for attestation.')
      }
      return produceSeamlessAttestation({
        webId,
        podUrl,
        stellarPublicKey,
        stellarSecret: secret,
        onboardingConfig,
      })
    },
    [walletInfo?.keyId]
  )

  const signAttestationChallenge = useCallback(
    async (challengePayload: string, keyId?: string) => {
      if (keyId) return getWalletService().signAttestationChallengeForIdentity(keyId, challengePayload)
      return getWalletService().signAttestationChallenge(challengePayload)
    },
    []
  )

  const getLockboxAccountCommitment = useCallback(
    async (contractId: string): Promise<string | null> => {
      return getWalletService().getLockboxAccountCommitment(contractId)
    },
    []
  )

  const deriveAccountCommitment = useCallback(async (): Promise<string> => {
    getWalletService()
    const secret = await _adapter?.loadOrCreate(walletInfo?.keyId)
    if (!secret) throw new Error('Embedded wallet secret is unavailable for commitment derivation.')
    const { deriveAccountCommitmentHex } = await import('@nodezero/zk-crypto/attestation-cipher')
    return deriveAccountCommitmentHex(secret)
  }, [walletInfo?.keyId])

  return (
    <WalletContext.Provider
      value={{
        walletInfo,
        identities,
        activeIdentityKeyId,
        isLoading,
        initializationError,
        isIdentityBusy,
        attestationStatus,
        attestationMessage,
        verificationSteps,
        attestationDetails,
        exportRecoveryBundle,
        deleteNodeData,
        createSeamlessAttestation,
        signAttestationChallenge,
        listIdentitySummaries,
        getLockboxAccountCommitment,
        deriveAccountCommitment,
        selectIdentity,
        createIdentity,
        importRecoveryIdentity,
        findIdentityKeyIdByPublicKey,
      }}
    >
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
