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
import type { PodOwnershipClaim } from '@nodezero/zk-crypto/pod-ownership'
import Constants from 'expo-constants'
import { useSolid } from './SolidContext'

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

interface CustodyReceipt {
  jobId: string
  challengeId: string
  verifiedAt: string
  claimHash: string
  proofHashHex?: string
  proofRootHex?: string
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
  lockboxFactoryContractId?: string
  userLockboxContractId?: string
  lockboxIdempotencyKey?: string
  proofHashHex?: string
  proofRootHex?: string
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
      lockboxFactoryContractId:
        typeof parsed.lockboxFactoryContractId === 'string' ? parsed.lockboxFactoryContractId : undefined,
      userLockboxContractId:
        typeof parsed.userLockboxContractId === 'string' ? parsed.userLockboxContractId : undefined,
      lockboxIdempotencyKey:
        typeof parsed.lockboxIdempotencyKey === 'string' ? parsed.lockboxIdempotencyKey : undefined,
      proofHashHex: typeof parsed.proofHashHex === 'string' ? parsed.proofHashHex : undefined,
      proofRootHex: typeof parsed.proofRootHex === 'string' ? parsed.proofRootHex : undefined,
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
              proofHashHex:
                typeof parsed.custodyReceipt.proofHashHex === 'string' ? parsed.custodyReceipt.proofHashHex : undefined,
              proofRootHex:
                typeof parsed.custodyReceipt.proofRootHex === 'string' ? parsed.custodyReceipt.proofRootHex : undefined,
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
  claimHash?: string
  proofHashHex?: string
  proofRootHex?: string
}

interface ProvisionerStatusReady {
  status: 'ready'
  jobId: string
  lockbox?: {
    status: 'ready' | 'skipped' | 'error'
    mode: 'mock' | 'disabled' | 'soroban'
    factoryContractId: string | null
    userLockboxContractId: string | null
    idempotencyKey: string
    verifiedAt: string
    error?: string
  }
  custodyReceipt?: {
    challengeId: string
    verifiedAt: string
    claimHash: string
    proofHashHex?: string
    proofRootHex?: string
  }
}

interface CustodyProvisioningResult {
  custodyReceipt: CustodyReceipt
  lockbox?: {
    factoryContractId: string | null
    userLockboxContractId: string | null
    idempotencyKey: string
  }
}

interface ZkArtifactManifest {
  artifacts?: Array<{ file: string }>
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

function joinUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${filePath.replace(/^packages\/zk-crypto\/build\//, '')}`
}

async function resolvePodOwnershipArtifacts(params: {
  zkArtifactsUrl: string
  zkManifestUrl: string
}): Promise<{ wasmPath: string; zkeyPath: string }> {
  const manifestResponse = await fetch(params.zkManifestUrl)
  if (!manifestResponse.ok) {
    throw new Error(`Unable to load ZK artifact manifest (${manifestResponse.status}).`)
  }
  const manifest = (await manifestResponse.json()) as ZkArtifactManifest
  const artifacts = manifest.artifacts ?? []
  const wasm = artifacts.find((artifact) => artifact.file.endsWith('pod_ownership_js/pod_ownership.wasm'))
  const zkey = artifacts.find((artifact) => artifact.file.endsWith('pod_ownership_final.zkey'))
  if (!wasm || !zkey) {
    throw new Error('Pod ownership proving artifacts are missing from the ZK manifest.')
  }
  return {
    wasmPath: joinUrl(params.zkArtifactsUrl, wasm.file),
    zkeyPath: joinUrl(params.zkArtifactsUrl, zkey.file),
  }
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
  walletInfo: WalletInfo
  wallet: WalletService
  appExtra: Record<string, string> | undefined
}): Promise<CustodyProvisioningResult> {
  const { provisionerUrl, webId, wallet, walletInfo, appExtra } = params
  const baseUrl = provisionerUrl.replace(/\/$/, '')
  const identity = extractPodIdentity(webId)
  const identityContractId = appExtra?.identityContractId ?? ''
  const lockboxFactoryContractId = appExtra?.lockboxFactoryContractId ?? ''
  const envProfile = appExtra?.envProfile ?? 'local'
  const stellarNetworkPassphrase = appExtra?.stellarNetworkPassphrase ?? 'Test SDF Network ; September 2015'
  const zkArtifactsUrl = appExtra?.zkArtifactsUrl ?? ''
  const zkManifestUrl = appExtra?.zkManifestUrl ?? ''

  if (!identityContractId || !lockboxFactoryContractId) {
    throw new Error('Identity and lockbox factory contract IDs are required for proof-backed provisioning.')
  }
  if (!zkArtifactsUrl || !zkManifestUrl) {
    throw new Error('ZK artifact URLs are required for proof-backed provisioning.')
  }

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
  const secret = await _adapter?.loadOrCreate()
  if (!secret) throw new Error('Embedded wallet secret is unavailable for proof generation.')
  const artifactPaths = await resolvePodOwnershipArtifacts({ zkArtifactsUrl, zkManifestUrl })
  const claim: PodOwnershipClaim = {
    envProfile,
    stellarNetworkPassphrase,
    webId,
    podUrl: identity.podUrl,
    stellarPublicKey: walletInfo.publicKey,
    identityContractId,
    lockboxFactoryContractId,
    challengeId: challenge.challengeId,
    nonce: challenge.nonce,
    expiresAt: challenge.expiresAt,
  }
  const { generatePodOwnershipProof } = await import('@nodezero/zk-crypto/pod-ownership')
  const podProof = await generatePodOwnershipProof({
    stellarSecretKey: secret,
    claim,
    wasmPath: artifactPaths.wasmPath,
    zkeyPath: artifactPaths.zkeyPath,
  })

  const submitResponse = await fetch(`${baseUrl}/v1/provision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handle: identity.handle,
      podSlug: identity.podSlug,
      webId,
      podUrl: identity.podUrl,
      stellarPublicKey: signature.stellarPublicKey,
      identityContractId,
      lockboxFactoryContractId,
      challengeId: challenge.challengeId,
      signatureBase64: signature.signatureBase64,
      proofVersion: 1,
      claimHash: podProof.claimHash.toString(),
      proofHex: podProof.proofHex,
      proofHashHex: podProof.proofHashHex,
      proofRootHex: podProof.proofRootHex,
      publicSignals: podProof.publicSignals,
    }),
  })
  const submit = await parseJsonResponse<ProvisionerSubmitResponse>(submitResponse)

  const statusResponse = await fetch(`${baseUrl}/v1/provision/${submit.jobId}`)
  const status = await parseJsonResponse<ProvisionerStatusReady>(statusResponse)

  if (status.status !== 'ready' || !status.custodyReceipt) {
    throw new Error('Provisioner did not return a ready custody receipt.')
  }
  if (!status.lockbox || status.lockbox.mode !== 'soroban' || !status.lockbox.userLockboxContractId) {
    throw new Error('Provisioner did not return a per-user lockbox contract.')
  }

  return {
    custodyReceipt: {
      jobId: status.jobId,
      challengeId: status.custodyReceipt.challengeId,
      verifiedAt: status.custodyReceipt.verifiedAt,
      claimHash: status.custodyReceipt.claimHash,
      proofHashHex: status.custodyReceipt.proofHashHex ?? submit.proofHashHex ?? podProof.proofHashHex,
      proofRootHex: status.custodyReceipt.proofRootHex ?? submit.proofRootHex ?? podProof.proofRootHex,
    },
    lockbox: status.lockbox
      ? {
          factoryContractId: status.lockbox.factoryContractId,
          userLockboxContractId: status.lockbox.userLockboxContractId,
          idempotencyKey: status.lockbox.idempotencyKey,
        }
      : undefined,
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
  /** Builds a portable recovery bundle (includes the private key) for export. */
  exportRecoveryBundle: () => Promise<{ fileName: string; json: string }>
  /** Destroys local wallet + pairing state, optionally unlinking on-chain. */
  deleteNodeData: (options?: {
    unlinkIdentity?: boolean
    clearAllLocalCache?: boolean
  }) => Promise<{ unlinkedIdentity: boolean }>
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
  const { isLoggedIn, isRestoring, webId, nodeSession } = useSolid()
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
    lockboxFactoryContractId: null,
    userLockboxContractId: null,
    lockboxIdempotencyKey: null,
    proofHashHex: null,
    proofRootHex: null,
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
        lockboxFactoryContractId: null,
        userLockboxContractId: null,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: null,
      })
      lastCheckedKeyRef.current = null
      return
    }

    // Seamless node sessions already had their WebID<->Stellar pairing anchored
    // on-chain server-side during provisioning. Skip the in-browser on-chain
    // verification (which needs Node-only crypto) and surface the verified
    // state directly from the node session record.
    if (nodeSession) {
      setAttestationStatus('verified')
      setAttestationMessage('Pairing anchored on-chain during node creation.')
      setAttestationDetails({
        registeredWebId: nodeSession.webId,
        lockboxStateRoot: nodeSession.proofRootHex,
        registerTxHash: null,
        verifiedAt: nodeSession.createdAt,
        custodyClaimHash: null,
        lockboxFactoryContractId: nodeSession.lockboxFactoryContractId,
        userLockboxContractId: nodeSession.userLockboxContractId,
        lockboxIdempotencyKey: null,
        proofHashHex: null,
        proofRootHex: nodeSession.proofRootHex,
      })
      lastCheckedKeyRef.current = `node:${nodeSession.webId}`
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
          lockboxFactoryContractId: null,
          userLockboxContractId: null,
          lockboxIdempotencyKey: null,
          proofHashHex: null,
          proofRootHex: null,
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
        let lockboxFactoryContractId = priorRecord?.lockboxFactoryContractId
        let userLockboxContractId = priorRecord?.userLockboxContractId
        let lockboxIdempotencyKey = priorRecord?.lockboxIdempotencyKey
        let proofHashHex = priorRecord?.proofHashHex ?? priorRecord?.custodyReceipt?.proofHashHex
        let proofRootHex = priorRecord?.proofRootHex ?? priorRecord?.custodyReceipt?.proofRootHex

        if (!isReturningSignIn && mappedWebId !== webId) {
          registerTxHash = await registerIdentity(webId, identityContractId)
          mappedWebId = await service.getRegisteredWebId(identityContractId)
        }

        if (!isReturningSignIn && provisionerUrl) {
          const provisioning = await runCustodyProvisioning({
            provisionerUrl,
            webId,
            walletInfo: info,
            wallet: service,
            appExtra,
          })
          custodyReceipt = provisioning.custodyReceipt
          lockboxFactoryContractId = provisioning.lockbox?.factoryContractId ?? undefined
          userLockboxContractId = provisioning.lockbox?.userLockboxContractId ?? undefined
          lockboxIdempotencyKey = provisioning.lockbox?.idempotencyKey ?? undefined
          proofHashHex = provisioning.custodyReceipt.proofHashHex
          proofRootHex = provisioning.custodyReceipt.proofRootHex
        }

        if (!userLockboxContractId) {
          setAttestationStatus('error')
          setAttestationMessage('Per-user lockbox provisioning is required and no user lockbox contract was returned.')
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: null,
            registerTxHash: registerTxHash || null,
            verifiedAt: null,
            custodyClaimHash: custodyReceipt?.claimHash ?? null,
            lockboxFactoryContractId: lockboxFactoryContractId ?? null,
            userLockboxContractId: null,
            lockboxIdempotencyKey: lockboxIdempotencyKey ?? null,
            proofHashHex: proofHashHex ?? null,
            proofRootHex: proofRootHex ?? null,
          })
          return
        }

        const effectiveLockboxContractId = userLockboxContractId
        const lockboxRoot = await service.getLockboxStateRoot(effectiveLockboxContractId)

        if (mappedWebId !== webId) {
          setAttestationStatus('unlinked')
          setAttestationMessage('Wallet/WebID on-chain mapping mismatch. Please relink your identity.')
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: lockboxRoot,
            registerTxHash: registerTxHash || null,
            verifiedAt: null,
            custodyClaimHash: custodyReceipt?.claimHash ?? null,
            lockboxFactoryContractId: lockboxFactoryContractId ?? null,
            userLockboxContractId: userLockboxContractId ?? null,
            lockboxIdempotencyKey: lockboxIdempotencyKey ?? null,
            proofHashHex: proofHashHex ?? null,
            proofRootHex: proofRootHex ?? null,
          })
          return
        }

        if (proofRootHex && lockboxRoot && lockboxRoot.toLowerCase() !== proofRootHex.toLowerCase()) {
          setAttestationStatus('unlinked')
          setAttestationMessage('User lockbox root does not match the browser-generated proof root. Relink required.')
          setAttestationDetails({
            registeredWebId: mappedWebId,
            lockboxStateRoot: lockboxRoot,
            registerTxHash: registerTxHash || null,
            verifiedAt: null,
            custodyClaimHash: custodyReceipt?.claimHash ?? null,
            lockboxFactoryContractId: lockboxFactoryContractId ?? null,
            userLockboxContractId: userLockboxContractId ?? null,
            lockboxIdempotencyKey: lockboxIdempotencyKey ?? null,
            proofHashHex: proofHashHex ?? null,
            proofRootHex: proofRootHex ?? null,
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
            lockboxFactoryContractId: lockboxFactoryContractId ?? null,
            userLockboxContractId: userLockboxContractId ?? null,
            lockboxIdempotencyKey: lockboxIdempotencyKey ?? null,
            proofHashHex: proofHashHex ?? null,
            proofRootHex: proofRootHex ?? null,
          })
          return
        }

        const proofInputs: PairingProofInputs = {
          webId,
          stellarPublicKey: info.publicKey,
          identityContractId,
          lockboxContractId: effectiveLockboxContractId,
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
            lockboxFactoryContractId: priorRecord.lockboxFactoryContractId ?? null,
            userLockboxContractId: priorRecord.userLockboxContractId ?? null,
            lockboxIdempotencyKey: priorRecord.lockboxIdempotencyKey ?? null,
            proofHashHex: priorRecord.proofHashHex ?? priorRecord.custodyReceipt?.proofHashHex ?? null,
            proofRootHex: priorRecord.proofRootHex ?? priorRecord.custodyReceipt?.proofRootHex ?? null,
          })
          return
        }

        const verifiedAt = new Date().toISOString()

        const record: PairingAttestationRecord = {
          proofVersion: 2,
          webId,
          stellarPublicKey: info.publicKey,
          identityContractId,
          lockboxContractId: effectiveLockboxContractId,
          lockboxStateRoot: lockboxRoot,
          registerTxHash,
          verifiedAt,
          custodyReceipt,
        }

        if (lockboxFactoryContractId) {
          record.lockboxFactoryContractId = lockboxFactoryContractId
        }
        if (userLockboxContractId) {
          record.userLockboxContractId = userLockboxContractId
        }
        if (lockboxIdempotencyKey) {
          record.lockboxIdempotencyKey = lockboxIdempotencyKey
        }
        if (proofHashHex) {
          record.proofHashHex = proofHashHex
        }
        if (proofRootHex) {
          record.proofRootHex = proofRootHex
        }
        await AsyncStorage.setItem(PAIRING_ATTESTATION_STORAGE_KEY, JSON.stringify(record))

        setAttestationStatus('verified')
        setAttestationDetails({
          registeredWebId: mappedWebId,
          lockboxStateRoot: lockboxRoot,
          registerTxHash: registerTxHash || priorRecord?.registerTxHash || null,
          verifiedAt,
          custodyClaimHash: custodyReceipt?.claimHash ?? null,
          lockboxFactoryContractId: lockboxFactoryContractId ?? null,
          userLockboxContractId: userLockboxContractId ?? null,
          lockboxIdempotencyKey: lockboxIdempotencyKey ?? null,
          proofHashHex: proofHashHex ?? null,
          proofRootHex: proofRootHex ?? null,
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
          lockboxFactoryContractId: null,
          userLockboxContractId: null,
          lockboxIdempotencyKey: null,
          proofHashHex: null,
          proofRootHex: null,
        })
      }
    })()
  }, [isLoggedIn, isRestoring, nodeSession, registerIdentity, walletInfo, webId])

  const exportRecoveryBundle = useCallback(async (): Promise<{ fileName: string; json: string }> => {
    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const info = walletInfo ?? (await getWalletService().getWalletInfo())
    const secret = await getWalletService().exportSecret()
    const pairingRaw = await AsyncStorage.getItem(PAIRING_ATTESTATION_STORAGE_KEY)
    const exportedAt = new Date().toISOString()

    const bundle = {
      bundleVersion: 1,
      exportedAt,
      envProfile: appExtra?.envProfile ?? 'local',
      stellarNetworkPassphrase: appExtra?.stellarNetworkPassphrase ?? null,
      webId: webId ?? null,
      wallet: {
        publicKey: info.publicKey,
        secretKey: secret,
      },
      attestation: attestationDetails,
      pairingRecord: pairingRaw ? (JSON.parse(pairingRaw) as unknown) : null,
    }

    const stamp = exportedAt.replace(/[:.]/g, '').replace(/-/g, '')
    return {
      fileName: `nodezero-recovery-${stamp}.json`,
      json: JSON.stringify(bundle, null, 2),
    }
  }, [attestationDetails, walletInfo, webId])

  const deleteNodeData = useCallback(
    async (options?: { unlinkIdentity?: boolean; clearAllLocalCache?: boolean }): Promise<{ unlinkedIdentity: boolean }> => {
      const unlinkIdentity = options?.unlinkIdentity ?? false
      const clearAllLocalCache = options?.clearAllLocalCache ?? false
      const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
      const identityContractId = appExtra?.identityContractId ?? ''
      let unlinkedIdentity = false

      if (unlinkIdentity && identityContractId) {
        try {
          await getWalletService().removeIdentityOnChain(identityContractId)
          unlinkedIdentity = true
        } catch (err) {
          console.warn('[WalletContext] On-chain identity unlink failed; continuing local delete:', err)
        }
      }

      await getWalletService().destroyWallet()

      if (clearAllLocalCache) {
        await AsyncStorage.clear()
      } else {
        await AsyncStorage.removeItem(PAIRING_ATTESTATION_STORAGE_KEY)
      }

      lastCheckedKeyRef.current = null
      setWalletInfo(null)
      setAttestationStatus('idle')
      setAttestationMessage(null)
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

      return { unlinkedIdentity }
    },
    []
  )

  return (
    <WalletContext.Provider value={{
      walletInfo,
      isLoading,
      registerIdentity,
      attestationStatus,
      attestationMessage,
      attestationDetails,
      exportRecoveryBundle,
      deleteNodeData,
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
