/**
 * LandingScreen – NodeZero.social public entry point.
 *
 * Marketing landing page for new and returning visitors.
 * New users: "Create Your Node" → provisioner creates the Pod and returns a
 * ready NodeZero session — no redirect, no password.
 * Returning users: "Sign In" → one-tap Stellar signature login on-device.
 * Authenticated users are immediately redirected into the app.
 */

import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Linking,
  Modal,
} from 'react-native'
import { useLocalSearchParams, useRouter, usePathname } from 'expo-router'
import Constants from 'expo-constants'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { useWallet } from '../src/contexts/WalletContext'
import { aesthetic } from '../src/theme/aesthetic'
import {
  checkSeamlessEmailExists,
  createSeamlessNode,
  getCompatibleOnboardingConfig,
  getSeamlessSignupConfig,
} from '../src/onboarding/seamlessSignup'
import { ProgressStepLadder, type ProgressStep } from '../src/components/ProgressStepLadder'
import {
  useStellarSignIn,
  NoAccountError,
  AccountSelectionRequiredError,
} from '../src/auth/useStellarSignIn'

const PRESS_OPACITY = 0.82

type AuthCardSource = 'card' | 'footer'

/** Major operations of the "Create Your Node" flow, in execution order. */
const CREATE_STEP_DEFS: Array<[key: string, label: string]> = [
  ['wallet', 'Prepare your secure wallet'],
  ['proof', 'Generate your zero-knowledge proof'],
  ['pod', 'Create your Pod on the Node Zero Community Server'],
  ['anchor', 'Anchor your identity on-chain (lockb0x)'],
  ['signin', 'Sign you in'],
]

/**
 * Maps low-level node-creation failures to actionable user-facing messages.
 * ZK artifact delivery problems (wasm fetch returning HTML/XML, missing
 * manifest entries, blocked storage access) otherwise surface as raw
 * WebAssembly parser internals like "module doesn't start with '\\0asm'".
 */
function mapCreateNodeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return 'Could not create your node. Try again.'
  }
  const lower = (err.message ?? '').toLowerCase()
  const isZkArtifactFailure =
    lower.includes("doesn't start with") ||
    lower.includes('webassembly.module') ||
    lower.includes('webassembly.compile') ||
    lower.includes('compileerror') ||
    lower.includes('unable to load zk artifact manifest') ||
    lower.includes('zk artifact manifest is not valid json') ||
    lower.includes('pod ownership proving artifacts are missing')
  if (isZkArtifactFailure) {
    return (
      'Zero-knowledge proof assets could not be loaded. This is usually a temporary ' +
      'artifact delivery issue — please try again shortly. If it keeps failing, ' +
      'contact support and mention "ZK artifact access".'
    )
  }
  if (lower.includes('lock expired after') || lower.includes('pod provisioning is temporarily busy')) {
    return 'Pod provisioning is temporarily busy. Please wait a few seconds and tap Create Your Node again.'
  }
  if (lower.includes('bridge proof claimhash does not match')) {
    return (
      'Your zero-knowledge proof did not match the active Testnet bridge configuration. ' +
      'Refresh the page to load the current release, then create a new test node.'
    )
  }
  return err.message || 'Could not create your node. Try again.'
}

function isEmailAlreadyRegisteredError(err: unknown): boolean {
  if (!(err instanceof Error)) return false

  const lower = (err.message ?? '').toLowerCase()
  return (
    lower.includes('already is a login for this e-mail address') ||
    lower.includes('already is a login for this email address') ||
    (lower.includes('badrequesthttperror') && lower.includes('login/password') && lower.includes('h400'))
  )
}

type LandingMode = 'marketing' | 'onboarding'

function getLandingMode(): LandingMode {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return 'onboarding'
  }

  const host = window.location.hostname.toLowerCase()
  if (host === 'nodezero.social' || host === 'www.nodezero.social') {
    return 'marketing'
  }

  return 'onboarding'
}

function shouldHandoffToInternalStaging(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>
  const browserSessionsEnabled = (extra.browserSessionEnabled ?? '').trim().toLowerCase() === 'true'
  const host = window.location.hostname.toLowerCase()
  return browserSessionsEnabled && (host === 'nodezero.social' || host === 'www.nodezero.social')
}

function handoffToInternalStaging(): void {
  window.location.assign('https://staging.nodezero.social/feed')
}

interface LandingAuthCardProps {
  source: AuthCardSource
  error: string | null
  errorAction: { label: string; url: string } | null
  isSigningIn: boolean
  isIdentityBusy: boolean
  seamlessEnabled: boolean
  identities: Array<{ keyId: string; label: string }>
  activeIdentityKeyId: string | null
  nodeHandle: string
  notificationEmail: string
  isCreating: boolean
  walletReady: boolean
  createNotice: string | null
  createSteps: ProgressStep[]
  onNodeHandleChange: (value: string) => void
  onNotificationEmailChange: (value: string) => void
  onSelectIdentity: (keyId: string) => Promise<void>
  onCreateIdentity: () => Promise<void>
  onSignIn: () => Promise<void>
  onCreateNode: () => Promise<void>
}

function LandingAuthCard({
  source,
  error,
  errorAction,
  isSigningIn,
  isIdentityBusy,
  seamlessEnabled,
  identities,
  activeIdentityKeyId,
  nodeHandle,
  notificationEmail,
  isCreating,
  walletReady,
  createNotice,
  createSteps,
  onNodeHandleChange,
  onNotificationEmailChange,
  onSelectIdentity,
  onCreateIdentity,
  onSignIn,
  onCreateNode,
}: LandingAuthCardProps): JSX.Element {

  void source
  return (
    <View style={styles.signInPanel}>
      <View style={styles.signInBrand}>
        <Text style={styles.signInBrandMark}>⊙</Text>
        <Text style={styles.signInBrandName}>NodeZero</Text>
      </View>
      <Text style={styles.signInTitle}>Sign in to your node</Text>
      <Text style={styles.signInHint}>
        Your device key signs you in — no passwords, no redirects.
      </Text>
      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
          {errorAction ? (
            <TouchableOpacity
              onPress={() => void Linking.openURL(errorAction.url)}
              activeOpacity={PRESS_OPACITY}
              accessibilityRole="link"
              accessibilityLabel={errorAction.label}
            >
              <Text style={styles.errorActionText}>{errorAction.label}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      <View style={styles.dropdownWrap}>
        <TouchableOpacity
          style={styles.createPodLink}
          onPress={() => void onCreateIdentity()}
          activeOpacity={PRESS_OPACITY}
          disabled={isIdentityBusy}
          accessibilityRole="button"
          accessibilityLabel="Create new identity"
        >
          <Text style={styles.createPodText}>
            {isIdentityBusy ? 'Preparing identity…' : 'Create a new identity'}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        style={[styles.btnPrimary, (isSigningIn || isIdentityBusy || !walletReady) && styles.btnDisabled]}
        onPress={() => void onSignIn()}
        disabled={isSigningIn || isIdentityBusy || !walletReady}
        activeOpacity={PRESS_OPACITY}
        accessibilityRole="button"
        accessibilityLabel="Sign In"
      >
        {isSigningIn ? (
            <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.btnPrimaryText}>{walletReady ? 'Sign In' : 'Preparing wallet…'}</Text>
        )}
      </TouchableOpacity>
      {seamlessEnabled ? (
        <View style={styles.createNodeBlock}>
          <Text style={styles.createNodeTitle}>Or create your node in seconds</Text>
          {createSteps.length > 0 ? <ProgressStepLadder steps={createSteps} /> : null}
          {createNotice ? <Text style={styles.createNotice}>{createNotice}</Text> : null}
          <TextInput
            style={styles.input}
            value={nodeHandle}
            onChangeText={onNodeHandleChange}
            placeholder="Choose a handle (e.g. alice)"
            placeholderTextColor={DIM}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Node handle"
          />
          <TextInput
            style={styles.input}
            value={notificationEmail}
            onChangeText={onNotificationEmailChange}
            placeholder="Notification email"
            placeholderTextColor={DIM}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            accessibilityLabel="Notification email"
          />
          <Text style={styles.createHintText}>
            Your device wallet is your key. There is no account password — keep
            your recovery bundle safe to restore access on a new device.
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, (isCreating || isIdentityBusy || !walletReady) && styles.btnDisabled]}
            onPress={() => void onCreateNode()}
            disabled={isCreating || isIdentityBusy || !walletReady}
            activeOpacity={PRESS_OPACITY}
          >
            {isCreating ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>
                {walletReady ? 'Create Your Node' : 'Preparing wallet…'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  )
}

function NodeZeroConceptDiagram(): JSX.Element {
  return (
    <View style={styles.diagramCard}>
      <View style={styles.diagramRowTop}>
        <View style={[styles.diagramNode, styles.diagramNodePrimary]}>
          <Text style={styles.diagramNodeTitle}>Your device</Text>
          <Text style={styles.diagramNodeSub}>Active Node Zero</Text>
        </View>
        <Text style={styles.diagramArrow}>syncs with</Text>
        <View style={styles.diagramNode}>
          <Text style={styles.diagramNodeTitle}>Your Pod</Text>
          <Text style={styles.diagramNodeSub}>Source of truth</Text>
          <Text style={styles.diagramNodeMeta}>profile + FOAF graph</Text>
        </View>
      </View>

      <View style={styles.diagramDivider} />

      <View style={styles.diagramRowBottom}>
        <View style={styles.diagramChip}>
          <Text style={styles.diagramChipTitle}>Connected devices</Text>
          <Text style={styles.diagramChipSub}>phone · laptop · tablet</Text>
          <Text style={styles.diagramChipMeta}>Any can become your active Node Zero</Text>
        </View>
        <View style={styles.diagramChip}>
          <Text style={styles.diagramChipTitle}>NodeZero network layer</Text>
          <Text style={styles.diagramChipSub}>local discovery + chronological feed</Text>
          <Text style={styles.diagramChipMeta}>Built from Pod-based FOAF connections</Text>
        </View>
      </View>
    </View>
  )
}

function AuthRedirectOverlay({ visible }: { visible: boolean }): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.redirectOverlayBackdrop}>
        <View style={styles.redirectOverlayCard}>
          <Text style={styles.redirectOverlayMark}>⊙</Text>
          <Text style={styles.redirectOverlayTitle}>Signing you in</Text>
          <Text style={styles.redirectOverlayBody}>
            Verifying your device key and establishing your session.
          </Text>
          <ActivityIndicator color={PURPLE} size="small" />
        </View>
      </View>
    </Modal>
  )
}

function accountDisplayLabel(account: { webId: string; podUrl: string }): string {
  try {
    const pod = new URL(account.podUrl)
    const slug = pod.pathname.split('/').filter(Boolean)[0]
    if (slug) return `@${slug}`
  } catch {
    // Fallback to WebID parsing.
  }
  try {
    const webId = new URL(account.webId)
    const slug = webId.pathname.split('/').filter(Boolean)[0]
    if (slug) return `@${slug}`
  } catch {
    // ignore malformed URL and return a generic label.
  }
  return 'Node account'
}

function AccountSelectionModal({
  visible,
  accounts,
  selectedWebId,
  onSelect,
  onCancel,
  onContinue,
  isSubmitting,
}: {
  visible: boolean
  accounts: Array<{ webId: string; podUrl: string }>
  selectedWebId: string | null
  onSelect: (webId: string) => void
  onCancel: () => void
  onContinue: () => Promise<void>
  isSubmitting: boolean
}): JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.accountModalBackdrop}>
        <View style={styles.accountModalCard}>
          <Text style={styles.accountModalTitle}>Choose an account</Text>
          <Text style={styles.accountModalBody}>
            This device identity has more than one NodeZero account. Select the one you want to sign into.
          </Text>
          <View style={styles.accountModalList}>
            {accounts.map((account) => {
              const isSelected = selectedWebId === account.webId
              return (
                <TouchableOpacity
                  key={account.webId}
                  style={[styles.accountOption, isSelected && styles.accountOptionSelected]}
                  onPress={() => onSelect(account.webId)}
                  activeOpacity={PRESS_OPACITY}
                  disabled={isSubmitting}
                >
                  <Text style={styles.accountOptionTitle}>{accountDisplayLabel(account)}</Text>
                  <Text style={styles.accountOptionMeta}>{account.webId}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <View style={styles.accountModalActions}>
            <TouchableOpacity
              style={[styles.accountActionSecondary, isSubmitting && styles.btnDisabled]}
              onPress={onCancel}
              activeOpacity={PRESS_OPACITY}
              disabled={isSubmitting}
            >
              <Text style={styles.accountActionSecondaryText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.accountActionPrimary,
                (isSubmitting || !selectedWebId) && styles.btnDisabled,
              ]}
              onPress={() => void onContinue()}
              activeOpacity={PRESS_OPACITY}
              disabled={isSubmitting || !selectedWebId}
            >
              {isSubmitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.accountActionPrimaryText}>Continue</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function LandingScreen(): JSX.Element {
  const { status, adoptSession } = useNodeZeroSession()
  const {
    attestationStatus,
    walletInfo,
    identities,
    activeIdentityKeyId,
    isIdentityBusy,
    initializationError,
    selectIdentity,
    createIdentity,
    createSeamlessAttestation,
  } = useWallet()
  const router = useRouter()
  const pathname = usePathname()
  const { reason } = useLocalSearchParams<{ reason?: string }>()
  const landingMode = getLandingMode()
  const showMarketingContent = landingMode === 'marketing'
  const seamlessConfig = getSeamlessSignupConfig()

  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorAction, setErrorAction] = useState<{ label: string; url: string } | null>(null)
  const [nodeHandle, setNodeHandle] = useState('')
  const [notificationEmail, setNotificationEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createNotice, setCreateNotice] = useState<string | null>(null)
  const [createSteps, setCreateSteps] = useState<ProgressStep[]>([])
  const [accountChoices, setAccountChoices] = useState<Array<{ webId: string; podUrl: string }>>([])
  const [selectedAccountWebId, setSelectedAccountWebId] = useState<string | null>(null)
  const knownExistingEmailsRef = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    if (reason === 'legacy-attestation') {
      setError(
        'This device belongs to a legacy Testnet node without a V3 on-chain attestation. ' +
        'It cannot sign in to this release. Create a new test node with a new identity.',
      )
      setErrorAction(null)
    }
  }, [reason])

  React.useEffect(() => {
    if (!initializationError) return
    setError(initializationError)
    setErrorAction(null)
  }, [initializationError])

  /** Marks the given step done and activates the next pending step. */
  const advanceCreateStep = (doneKey: string): void => {
    setCreateSteps((steps) => {
      const doneIndex = steps.findIndex((step) => step.key === doneKey)
      if (doneIndex === -1) return steps
      return steps.map((step, index) => {
        if (index <= doneIndex) return step.status === 'done' ? step : { ...step, status: 'done' }
        if (index === doneIndex + 1 && step.status === 'pending') return { ...step, status: 'active' }
        return step
      })
    })
  }

  /** Marks whichever step is currently running as failed. */
  const failActiveCreateStep = (): void => {
    setCreateSteps((steps) =>
      steps.map((step) => (step.status === 'active' ? { ...step, status: 'error' } : step)),
    )
  }

  React.useEffect(() => {
    if (status === 'authenticated' && pathname === '/') {
      // Fail-closed routing: only verified sessions enter the app. Everyone
      // else passes through onboarding, which blocks until the on-chain
      // lockb0x pairing is verified.
      if (attestationStatus === 'verified') {
        router.replace('/feed')
      } else {
        router.replace('/onboarding')
      }
    }
  }, [attestationStatus, pathname, router, status])

  const stellarSignIn = useStellarSignIn()

  const handleSignIn = async (webId?: string): Promise<void> => {
    setError(null)
    setErrorAction(null)
    setIsSigningIn(true)
    try {
      // One-tap sign-in: challenge → on-device Stellar signature → NodeZero
      // session. The provisioner only issues the session after proving live
      // Solid access (fail-closed) — no redirect, no password, no CSS UI.
      const result = await stellarSignIn({ webId })
      setAccountChoices([])
      setSelectedAccountWebId(null)
      if (shouldHandoffToInternalStaging()) {
        handoffToInternalStaging()
        return
      }
      await adoptSession(result)
    } catch (err) {
      if (err instanceof NoAccountError) {
        setError('No node exists for this device key yet. Create your node below to get started.')
      } else if (err instanceof AccountSelectionRequiredError) {
        setAccountChoices(err.accounts)
        setSelectedAccountWebId(err.accounts[0]?.webId ?? null)
        setError('Multiple accounts are available for this device identity. Choose one to sign in.')
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.')
      }
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleCreateNode = async (): Promise<void> => {
    setError(null)
    setErrorAction(null)
    setCreateNotice(null)

    const normalizedEmail = notificationEmail.trim().toLowerCase()
    if (normalizedEmail && knownExistingEmailsRef.current.has(normalizedEmail)) {
      setError('This email address is already registered. If this is your account, sign in with the device that created it.')
      return
    }

    // Fail-closed: the embedded wallet must be provisioned before onboarding.
    // Without a Stellar public key the provisioner cannot anchor the on-chain
    // lockb0x, so creation is blocked until the wallet is ready.
    if (!walletInfo?.publicKey) {
      setError('Your wallet is still initializing. Wait a moment and try again.')
      return
    }

    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const issuerBase = (appExtra?.nodeZeroIssuerUrl ?? '').replace(/\/+$/, '')
    if (!issuerBase) {
      setError('Node identity provider is not configured. Try again later.')
      return
    }

    const normalizedHandle = nodeHandle.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!normalizedHandle) {
      setError('Choose a node handle using letters and numbers.')
      return
    }

    setIsCreating(true)
    setCreateSteps(
      CREATE_STEP_DEFS.map(([key, label]) => ({
        key,
        label,
        status: key === 'wallet' ? 'done' : key === 'proof' ? 'active' : 'pending',
      })),
    )
    setCreateNotice('Checking account availability…')

    try {
      setCreateNotice('Verifying the active Testnet configuration…')
      const onboardingConfig = await getCompatibleOnboardingConfig()

      // Fast path: ask the provisioner for a server-side duplicate check before
      // we spend time generating ZK artifacts for an already-registered email.
      if (normalizedEmail) {
        const emailAlreadyRegistered = await checkSeamlessEmailExists(normalizedEmail)
        if (emailAlreadyRegistered) {
          knownExistingEmailsRef.current.add(normalizedEmail)
          setError('This email address is already registered. If this is your account, sign in with the device that created it.')
          return
        }
      }

      // Produce the real on-device attestation first: a pod_ownership Groth16
      // proof (identity commitment) + Stellar-encrypted claim. Bound to the
      // deterministic WebID/Pod the provisioner will create for this handle.
      const expectedWebId = `${issuerBase}/${normalizedHandle}/profile/card#me`
      const expectedPodUrl = `${issuerBase}/${normalizedHandle}/`

      setCreateNotice('Generating your zero-knowledge proof…')
      const attestation = await createSeamlessAttestation(
        expectedWebId,
        expectedPodUrl,
        walletInfo.publicKey,
        onboardingConfig,
      )
      advanceCreateStep('proof')
      setCreateNotice('Creating your Pod on the Node Zero Community Server…')

      const result = await createSeamlessNode({
        handle: nodeHandle,
        notificationEmail,
        stellarPublicKey: walletInfo.publicKey,
        accountCommitmentHex: attestation.accountCommitmentHex,
        ciphertextHex: attestation.ciphertextHex,
        proofHex: attestation.proofHex,
        proofHashHex: attestation.proofHashHex,
        publicSignals: attestation.publicSignals,
        circuitVersion: attestation.claim.circuitVersion ?? 1,
        configFingerprint: onboardingConfig.configFingerprint,
      })
      advanceCreateStep('pod')
      setCreateNotice('Confirming your on-chain lockb0x anchor…')

      // Fail-closed: onboarding is only complete when the per-user lockb0x was
      // created AND anchored on-chain. If the provisioner did not return a
      // ready lockbox, do NOT sign the user in — surface an actionable error.
      const anchored = result.lockbox?.userLockboxContractId
      if (!result.lockbox || result.lockbox.status !== 'ready' || !anchored) {
        failActiveCreateStep()
        setError('Node created, but on-chain lockb0x provisioning did not complete. Please try again.')
        setErrorAction(null)
        return
      }

      // Fail-closed: the real ZK attestation (identity commitment + encrypted
      // claim) must be anchored on-chain. Without it the node is unverifiable.
      if (!result.attestation) {
        failActiveCreateStep()
        setError('Node created, but the on-chain attestation was not anchored. Please try again.')
        setErrorAction(null)
        return
      }

      // Fail-closed: the provisioner must return a ready NodeZero session —
      // it only does so after proving live Solid access against the new Pod.
      if (!result.session?.accessToken) {
        failActiveCreateStep()
        setError('Node created, but no session was issued. Please try again.')
        setErrorAction(null)
        return
      }
      advanceCreateStep('anchor')

      const root = result.lockbox.proofRootHex
      setCreateNotice(
        `Node created. WebID: ${result.webId}\nStellar key: ${result.stellarPublicKey}\nLockb0x (on-chain): ${anchored}\nIdentity anchor: ${result.attestation.accountCommitmentHex}${root ? `\nPairing root: ${root}` : ''}\nSigning you in…`,
      )

      advanceCreateStep('signin')
      setIsSigningIn(true)

      // Adopt the inline session — the user lands in the app authenticated,
      // with the RouteGuard driving the attestation-verified transition.
      const sessionInput = {
        session: result.session,
        webId: result.webId,
        podUrl: result.podUrl,
        lockbox: {
          userLockboxContractId: anchored,
          factoryContractId: result.lockbox.factoryContractId ?? null,
          proofRootHex: result.lockbox.proofRootHex ?? null,
        },
        createdAt: new Date().toISOString(),
      }
      if (shouldHandoffToInternalStaging()) {
        handoffToInternalStaging()
        return
      }
      await adoptSession(sessionInput)
    } catch (err) {
      console.error('[LandingScreen] create node failed:', err)
      failActiveCreateStep()
      if (isEmailAlreadyRegisteredError(err)) {
        if (normalizedEmail) {
          knownExistingEmailsRef.current.add(normalizedEmail)
        }
        setError(
          'This email address is already registered. If this is your account, sign in with the device that created it.',
        )
        setErrorAction(null)
      } else {
        setError(mapCreateNodeError(err))
        setErrorAction(null)
      }
    } finally {
      setIsCreating(false)
      setIsSigningIn(false)
    }
  }

  const handleSelectIdentity = async (keyId: string): Promise<void> => {
    setError(null)
    setErrorAction(null)
    setCreateNotice(null)
    setAccountChoices([])
    setSelectedAccountWebId(null)
    await selectIdentity(keyId)
  }

  const handleCreateIdentity = async (): Promise<void> => {
    setError(null)
    setErrorAction(null)
    setCreateNotice('Preparing a new local identity…')
    try {
      await createIdentity()
      setCreateNotice('New identity ready. You can sign in or create your node with it.')
    } catch (err) {
      setCreateNotice(null)
      setError(err instanceof Error ? err.message : 'Failed to create a new identity.')
    }
  }

  const handleCancelAccountSelection = (): void => {
    setAccountChoices([])
    setSelectedAccountWebId(null)
  }

  const handleContinueSelectedAccount = async (): Promise<void> => {
    if (!selectedAccountWebId) return
    await handleSignIn(selectedAccountWebId)
  }

  if (status === 'restoring') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    )
  }

  return (
    <>
      <AuthRedirectOverlay visible={isSigningIn} />
      <AccountSelectionModal
        visible={accountChoices.length > 0}
        accounts={accountChoices}
        selectedWebId={selectedAccountWebId}
        onSelect={setSelectedAccountWebId}
        onCancel={handleCancelAccountSelection}
        onContinue={handleContinueSelectedAccount}
        isSubmitting={isSigningIn}
      />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Top nav ─────────────────────────────────── */}
        <View style={styles.nav}>
          <Text style={styles.navLogo}>⊙ NodeZero</Text>
        </View>

        {/* ── Hero ────────────────────────────────────── */}
        <View style={styles.hero}>
          {showMarketingContent ? (
            <>
              <Text style={styles.heroEyebrow}>Local · Private · Human</Text>
              <Text style={styles.heroHeadline}>A calmer social network{`\n`}for real communities.</Text>
              <Text style={styles.heroBody}>
                {'Sign in with your device key in one tap. New here? Create your node in seconds and you are ready to post.'}
              </Text>
              <Text style={styles.heroBody}>
                {'NodeZero keeps the experience simple up front: chronological feed, optional nearby discovery, and privacy controls that you can change anytime.'}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.heroEyebrow}>NodeZero Staging</Text>
              <Text style={styles.heroHeadline}>Continue to your node</Text>
              <Text style={styles.heroBody}>
                {'Returning user: sign in with your device key — one tap, no passwords.'}
              </Text>
              <Text style={styles.heroBody}>
                {'New user: create your node with the streamlined flow below. Your Pod is created and you are signed in immediately.'}
              </Text>
            </>
          )}
        </View>

        {/* ── Sign-in panel (always visible) ───────────── */}
        <LandingAuthCard
          source="card"
          error={error}
          errorAction={errorAction}
          isSigningIn={isSigningIn}
          isIdentityBusy={isIdentityBusy}
          seamlessEnabled={seamlessConfig.enabled}
          identities={identities}
          activeIdentityKeyId={activeIdentityKeyId}
          nodeHandle={nodeHandle}
          notificationEmail={notificationEmail}
          isCreating={isCreating}
          walletReady={Boolean(walletInfo?.publicKey)}
          createNotice={createNotice}
          createSteps={createSteps}
          onNodeHandleChange={setNodeHandle}
          onNotificationEmailChange={setNotificationEmail}
          onSelectIdentity={handleSelectIdentity}
          onCreateIdentity={handleCreateIdentity}
          onSignIn={handleSignIn}
          onCreateNode={handleCreateNode}
        />

        {showMarketingContent ? (
          <>
            {/* ── How it works ────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionEyebrow}>Three steps</Text>
              <Text style={styles.sectionTitle}>Get started in minutes</Text>
              {STEPS.map((s, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{i + 1}</Text>
                  </View>
                  <View style={styles.stepContent}>
                    <Text style={styles.stepTitle}>{s.title}</Text>
                    <Text style={styles.stepDesc}>{s.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionEyebrow}>Node Zero model</Text>
              <Text style={styles.sectionTitle}>One identity, multiple devices</Text>
              <NodeZeroConceptDiagram />
            </View>

            {/* ── Features ────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={styles.sectionEyebrow}>Why NodeZero</Text>
              <Text style={styles.sectionTitle}>Built on different principles</Text>
              <View style={styles.featureGrid}>
                {FEATURES.map((f) => (
                  <View key={f.title} style={styles.featureCard}>
                    <Text style={styles.featureIcon}>{f.icon}</Text>
                    <Text style={styles.featureTitle}>{f.title}</Text>
                    <Text style={styles.featureDesc}>{f.desc}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* ── Trust statement ─────────────────────────── */}
            <View style={styles.trustBlock}>
              <Text style={styles.trustStatement}>
                "Built for real communities, not engagement hacks."
              </Text>
              <Text style={styles.trustSub}>Chronological by default. Local by choice.</Text>
            </View>

            {/* ── Final CTA ───────────────────────────────── */}
            <View style={styles.finalCta}>
              <Text style={styles.finalCtaTitle}>Ready to join your local NodeZero community?</Text>
              <LandingAuthCard
                source="footer"
                error={error}
                errorAction={errorAction}
                isSigningIn={isSigningIn}
                isIdentityBusy={isIdentityBusy}
                seamlessEnabled={seamlessConfig.enabled}
                identities={identities}
                activeIdentityKeyId={activeIdentityKeyId}
                nodeHandle={nodeHandle}
                notificationEmail={notificationEmail}
                isCreating={isCreating}
                walletReady={Boolean(walletInfo?.publicKey)}
                createNotice={createNotice}
                createSteps={createSteps}
                onNodeHandleChange={setNodeHandle}
                onNotificationEmailChange={setNotificationEmail}
                onSelectIdentity={handleSelectIdentity}
                onCreateIdentity={handleCreateIdentity}
                onSignIn={handleSignIn}
                onCreateNode={handleCreateNode}
              />
              <Text style={styles.finalCtaSub}>
                Powered by{' '}
                <Text style={styles.link} onPress={() => void Linking.openURL('https://solidproject.org')}>Solid</Text>
                {' '}·{' '}
                <Text style={styles.link} onPress={() => void Linking.openURL('https://stellar.org')}>Stellar</Text>
                {' '}·{' '}
                {'Open source'}
              </Text>
            </View>
          </>
        ) : null}

        </ScrollView>
      </KeyboardAvoidingView>
    </>
  )
}

// ── Content ─────────────────────────────────────────────────────────────────

const STEPS = [
  {
    title: 'Create your node',
    desc: 'Use the Node Zero Community Server to create your account and profile in seconds.',
  },
  {
    title: 'Set up your profile',
    desc: 'Choose a handle, add your details, and sign in from any device. Your Pod carries your profile and FOAF social graph with you.',
  },
  {
    title: 'Discover people nearby',
    desc: 'Turn on location only when you want local discovery. You can turn it off anytime.',
  },
]

const FEATURES = [
  {
    icon: '🧭',
    title: 'Community-first feed',
    desc: 'See posts in time order from people and places you care about.',
  },
  {
    icon: '🔐',
    title: 'Node Zero starts with you',
    desc: 'Your Pod is the source of truth, and any device you connect can act as your active Node Zero in your own network.',
  },
  {
    icon: '📍',
    title: 'Privacy by default',
    desc: 'Nearby discovery uses approximate H3 areas so other users never see your exact coordinates.',
  },
  {
    icon: '🛡️',
    title: 'FOAF-powered social graph',
    desc: 'Your network is grounded in FOAF connections stored in your Pod, not in a platform-owned follower database.',
  },
]

// ── Styles ───────────────────────────────────────────────────────────────────

const PURPLE = aesthetic.color.accent
const BG = aesthetic.color.bgNight
const SURFACE = aesthetic.color.surface
const BORDER = aesthetic.color.border
const TEXT = aesthetic.color.textHigh
const MUTED = aesthetic.color.textMid
const DIM = aesthetic.color.textLow
const INPUT_BG = aesthetic.color.bgInk
const CHIP = aesthetic.color.chip
const DANGER = aesthetic.color.danger

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  scroll: { paddingBottom: 60 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: BG },

  // Nav
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'web' ? 20 : 48,
    paddingBottom: 16,
  },
  navLogo: { fontSize: 18, fontWeight: '800', color: PURPLE, letterSpacing: -0.5 },
  navSignIn: { fontSize: 14, color: MUTED, fontWeight: '600' },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modeBadge: {
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modeBadgeText: { color: TEXT, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  modeInfoButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  modeInfoButtonText: { color: MUTED, fontSize: 12, fontWeight: '800' },
  modeTooltip: {
    marginHorizontal: 24,
    marginTop: 2,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: SURFACE,
    borderRadius: 10,
  },
  modeTooltipText: { color: MUTED, fontSize: 12, lineHeight: 18 },

  // Hero
  hero: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 48,
    alignItems: 'flex-start',
  },
  heroEyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: PURPLE,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  heroHeadline: {
    fontSize: Platform.OS === 'web' ? 52 : 40,
    fontWeight: '900',
    color: TEXT,
    lineHeight: Platform.OS === 'web' ? 60 : 46,
    letterSpacing: -1.5,
    marginBottom: 20,
  },
  heroBody: {
    fontSize: 16,
    color: MUTED,
    lineHeight: 26,
    marginBottom: 32,
    maxWidth: 480,
  },

  // Buttons
  btnPrimary: {
    backgroundColor: PURPLE,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 28,
    alignItems: 'center',
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  btnDisabled: { opacity: 0.5 },
  btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  btnSecondary: {
    paddingVertical: 12,
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  btnSecondaryText: { color: MUTED, fontSize: 14 },

  // Sign-in panel
  signInPanel: {
    marginHorizontal: 24,
    marginBottom: 32,
    backgroundColor: SURFACE,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: BORDER,
  },
  signInTitle: { fontSize: 17, fontWeight: '700', color: TEXT, marginBottom: 4 },
  signInHint: { fontSize: 13, color: MUTED, marginBottom: 16 },
  signInBrand: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  signInBrandMark: { fontSize: 18, color: PURPLE, marginRight: 8 },
  signInBrandName: { fontSize: 15, fontWeight: '800', color: TEXT, letterSpacing: -0.3 },
  resumeHint: { fontSize: 12, color: DIM, marginBottom: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 15,
    backgroundColor: INPUT_BG,
    marginBottom: 12,
  },
  errorBlock: { marginBottom: 10 },
  errorText: { color: DANGER, fontSize: 13, marginBottom: 6 },
  errorActionText: {
    color: PURPLE,
    fontSize: 13,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  // Identity-provider dropdown
  dropdownWrap: { marginBottom: 12 },
  dropdownField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    backgroundColor: INPUT_BG,
  },
  dropdownFieldText: { flex: 1 },
  dropdownLabelRow: { flexDirection: 'row', alignItems: 'center' },
  dropdownMark: { color: PURPLE, fontSize: 15, marginRight: 8 },
  dropdownLabel: { color: TEXT, fontSize: 15, fontWeight: '600' },
  dropdownSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  dropdownChevron: { color: MUTED, fontSize: 14, marginLeft: 12 },
  dropdownMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: INPUT_BG,
    overflow: 'hidden',
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  dropdownOptionDivider: { borderBottomWidth: 1, borderBottomColor: BORDER },
  dropdownOptionActive: { backgroundColor: CHIP },
  dropdownCheck: { color: PURPLE, fontSize: 15, fontWeight: '700', marginLeft: 12 },
  createPodLink: { marginTop: 8, alignItems: 'center' },
  createPodText: { color: PURPLE, fontSize: 13 },
  createNodeBlock: { marginTop: 16, borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 16 },
  createNodeTitle: { color: MUTED, fontSize: 13, fontWeight: '600', marginBottom: 12 },
  createHintText: { color: MUTED, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  createNotice: { color: PURPLE, fontSize: 12, lineHeight: 18, marginBottom: 12 },

  // Redirect overlay
  redirectOverlayBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  redirectOverlayCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
  },
  redirectOverlayMark: {
    fontSize: 26,
    color: PURPLE,
    marginBottom: 8,
  },
  redirectOverlayTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  redirectOverlayBody: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 10,
  },

  // Multi-account selector
  accountModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  accountModalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  accountModalTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  accountModalBody: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  accountModalList: {
    gap: 8,
    marginBottom: 14,
  },
  accountOption: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: INPUT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  accountOptionSelected: {
    borderColor: PURPLE,
    backgroundColor: CHIP,
  },
  accountOptionTitle: {
    color: TEXT,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  accountOptionMeta: {
    color: MUTED,
    fontSize: 12,
  },
  accountModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  accountActionSecondary: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: INPUT_BG,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  accountActionSecondaryText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '600',
  },
  accountActionPrimary: {
    borderRadius: 10,
    backgroundColor: PURPLE,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 96,
    alignItems: 'center',
  },
  accountActionPrimaryText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // How it works
  section: {
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 16,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: PURPLE,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: TEXT,
    letterSpacing: -0.5,
    marginBottom: 32,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    marginTop: 2,
    flexShrink: 0,
  },
  stepNumberText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 16, fontWeight: '700', color: TEXT, marginBottom: 4 },
  stepDesc: { fontSize: 14, color: MUTED, lineHeight: 22 },

  // Node Zero concept diagram
  diagramCard: {
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  diagramRowTop: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    gap: 12,
  },
  diagramRowBottom: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    gap: 10,
  },
  diagramNode: {
    flex: 1,
    minHeight: 96,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    backgroundColor: INPUT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  diagramNodePrimary: {
    borderColor: PURPLE,
    backgroundColor: CHIP,
  },
  diagramArrow: {
    color: PURPLE,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  diagramNodeTitle: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 3,
  },
  diagramNodeSub: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  diagramNodeMeta: {
    color: DIM,
    fontSize: 11,
    marginTop: 4,
  },
  diagramDivider: {
    height: 1,
    backgroundColor: BORDER,
  },
  diagramChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    backgroundColor: BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  diagramChipTitle: {
    color: TEXT,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  diagramChipSub: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },
  diagramChipMeta: {
    color: DIM,
    fontSize: 11,
    marginTop: 4,
  },

  // Features
  featureGrid: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    flexWrap: 'wrap',
    gap: 12,
  },
  featureCard: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    flex: Platform.OS === 'web' ? 1 : undefined,
    minWidth: Platform.OS === 'web' ? 200 : undefined,
  },
  featureIcon: { fontSize: 24, marginBottom: 10 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 6 },
  featureDesc: { fontSize: 13, color: MUTED, lineHeight: 20 },

  // Trust
  trustBlock: {
    marginHorizontal: 24,
    marginTop: 48,
    padding: 28,
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  trustStatement: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT,
    textAlign: 'center',
    lineHeight: 28,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  trustSub: { fontSize: 13, color: DIM, textAlign: 'center', fontWeight: '600', letterSpacing: 1 },

  // Final CTA
  finalCta: {
    paddingHorizontal: 24,
    paddingTop: 56,
    alignItems: 'center',
  },
  finalCtaTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: TEXT,
    marginBottom: 20,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  finalCtaSub: { marginTop: 12, fontSize: 12, color: DIM, textAlign: 'center' },
  link: { color: PURPLE },
})
