/**
 * LandingScreen – NodeZero.social public entry point.
 *
 * Marketing landing page for new and returning visitors.
 * New users: "Create Your Node" → Node Zero Community Server Pod creation.
 * Returning users: "Sign In" → Node Zero Community Server OIDC by default
 * (solidcommunity.net offered as a secondary external-Pod option).
 * Authenticated users are immediately redirected to /feed.
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
import { useRouter, usePathname } from 'expo-router'
import Constants from 'expo-constants'
import { useSolid } from '../src/contexts/SolidContext'
import { useWallet } from '../src/contexts/WalletContext'
import { aesthetic } from '../src/theme/aesthetic'
import { beginSolidSignup } from '../src/onboarding/signupBridge'
import { createSeamlessNode, getSeamlessSignupConfig } from '../src/onboarding/seamlessSignup'
import { ProgressStepLadder, type ProgressStep } from '../src/components/ProgressStepLadder'
import type { NodeSessionRecord } from '../src/onboarding/nodeSession'

const PRESS_OPACITY = 0.82

interface IssuerOption {
  /** Short display name shown in the dropdown. */
  label: string
  /** Secondary descriptive line. */
  sublabel: string
  /** The OIDC issuer URL used to start the sign-in flow. */
  value: string
  /** Optional brand glyph rendered before the label (e.g. the NodeZero mark). */
  mark?: string
}

/**
 * Builds the identity-provider options for the sign-in dropdown. The NodeZero
 * authentication flow (the self-hosted NodeZero identity provider) is always
 * the default first option; solidcommunity.net is offered second for users
 * with an external Solid Pod.
 */
function getIssuerOptions(): IssuerOption[] {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const nodeZeroIssuer = appExtra?.nodeZeroIssuerUrl?.trim() ?? ''
  const solidIssuer = appExtra?.solidOidcIssuerUrl?.trim() || 'https://solidcommunity.net/'

  const options: IssuerOption[] = []
  if (nodeZeroIssuer) {
    options.push({
      label: 'Node Zero Community Server',
      sublabel: 'Sign in with the hosted Node Zero Community Server (recommended)',
      value: nodeZeroIssuer,
      mark: '⊙',
    })
  }
  options.push({
    label: 'solidcommunity.net',
    sublabel: 'Sign in with an external Solid Pod',
    value: solidIssuer,
  })
  return options
}

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
  return err.message || 'Could not create your node. Try again.'
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

interface LandingAuthCardProps {
  source: AuthCardSource
  showResumeHint: boolean
  issuerOptions: IssuerOption[]
  selectedIssuer: string
  signupResumeActive: boolean
  signupReturnDetected: boolean
  error: string | null
  isSigningIn: boolean
  seamlessEnabled: boolean
  nodeHandle: string
  notificationEmail: string
  isCreating: boolean
  walletReady: boolean
  createNotice: string | null
  createSteps: ProgressStep[]
  onIssuerChange: (nextIssuer: string) => void
  onNodeHandleChange: (value: string) => void
  onNotificationEmailChange: (value: string) => void
  onSignIn: () => Promise<void>
  onCreateNode: () => Promise<void>
  onGetStarted: (source: AuthCardSource) => Promise<void>
  onClearError: () => void
}

function LandingAuthCard({
  source,
  showResumeHint,
  issuerOptions,
  selectedIssuer,
  signupResumeActive,
  signupReturnDetected,
  error,
  isSigningIn,
  seamlessEnabled,
  nodeHandle,
  notificationEmail,
  isCreating,
  walletReady,
  createNotice,
  createSteps,
  onIssuerChange,
  onNodeHandleChange,
  onNotificationEmailChange,
  onSignIn,
  onCreateNode,
  onGetStarted,
  onClearError,
}: LandingAuthCardProps): JSX.Element {
  const [issuerMenuOpen, setIssuerMenuOpen] = useState(false)
  const selectedOption = issuerOptions.find((option) => option.value === selectedIssuer) ?? issuerOptions[0]

  return (
    <View style={styles.signInPanel}>
      <View style={styles.signInBrand}>
        <Text style={styles.signInBrandMark}>⊙</Text>
        <Text style={styles.signInBrandName}>NodeZero</Text>
      </View>
      <Text style={styles.signInTitle}>Sign in with your Solid Pod</Text>
      <Text style={styles.signInHint}>Choose your identity provider</Text>
      {showResumeHint && signupResumeActive ? (
        <Text style={styles.resumeHint}>
          {signupReturnDetected
            ? 'Signup return detected. Continue by signing in with your new Solid Pod identity.'
            : 'Need a Pod first? Create one, then return here to continue onboarding.'}
        </Text>
      ) : null}
      <View style={styles.dropdownWrap}>
        <TouchableOpacity
          style={styles.dropdownField}
          onPress={() => setIssuerMenuOpen((open) => !open)}
          activeOpacity={PRESS_OPACITY}
          accessibilityRole="button"
          accessibilityLabel="Identity provider"
          accessibilityState={{ expanded: issuerMenuOpen }}
        >
          <View style={styles.dropdownFieldText}>
            <View style={styles.dropdownLabelRow}>
              {selectedOption?.mark ? <Text style={styles.dropdownMark}>{selectedOption.mark}</Text> : null}
              <Text style={styles.dropdownLabel}>{selectedOption?.label ?? 'Select provider'}</Text>
            </View>
            <Text style={styles.dropdownSub}>{selectedOption?.sublabel ?? ''}</Text>
          </View>
          <Text style={styles.dropdownChevron}>{issuerMenuOpen ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {issuerMenuOpen ? (
          <View style={styles.dropdownMenu}>
            {issuerOptions.map((opt, i) => (
              <TouchableOpacity
                key={opt.value || opt.label}
                style={[
                  styles.dropdownOption,
                  i < issuerOptions.length - 1 && styles.dropdownOptionDivider,
                  opt.value === selectedIssuer && styles.dropdownOptionActive,
                ]}
                onPress={() => {
                  onIssuerChange(opt.value)
                  setIssuerMenuOpen(false)
                  onClearError()
                }}
                activeOpacity={PRESS_OPACITY}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
              >
                <View style={styles.dropdownFieldText}>
                  <View style={styles.dropdownLabelRow}>
                    {opt.mark ? <Text style={styles.dropdownMark}>{opt.mark}</Text> : null}
                    <Text style={styles.dropdownLabel}>{opt.label}</Text>
                  </View>
                  <Text style={styles.dropdownSub}>{opt.sublabel}</Text>
                </View>
                {opt.value === selectedIssuer ? <Text style={styles.dropdownCheck}>✓</Text> : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity
        style={[styles.btnPrimary, isSigningIn && styles.btnDisabled]}
        onPress={() => void onSignIn()}
        disabled={isSigningIn}
        activeOpacity={PRESS_OPACITY}
        accessibilityRole="button"
        accessibilityLabel="Sign In"
      >
        {isSigningIn ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.btnPrimaryText}>Sign In</Text>
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
          <TouchableOpacity
            style={[styles.btnPrimary, (isCreating || !walletReady) && styles.btnDisabled]}
            onPress={() => void onCreateNode()}
            disabled={isCreating || !walletReady}
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
      ) : (
        <TouchableOpacity
          onPress={() => void onGetStarted(source)}
          style={styles.createPodLink}
          activeOpacity={PRESS_OPACITY}
        >
          <Text style={styles.createPodText}>Need a Pod? Create one free →</Text>
        </TouchableOpacity>
      )}
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
          <Text style={styles.redirectOverlayTitle}>Continuing to sign in</Text>
          <Text style={styles.redirectOverlayBody}>
            Taking you to the Node Zero Community Server to complete secure sign-in.
          </Text>
          <ActivityIndicator color={PURPLE} size="small" />
        </View>
      </View>
    </Modal>
  )
}

export default function LandingScreen(): JSX.Element {
  const {
    signIn,
    signInWithNode,
    nodeSession,
    isLoggedIn,
    isRestoring,
    signupResumeActive,
    signupReturnDetected,
  } = useSolid()
  const { attestationStatus, walletInfo, createSeamlessAttestation } = useWallet()
  const router = useRouter()
  const pathname = usePathname()
  const landingMode = getLandingMode()
  const showMarketingContent = landingMode === 'marketing'
  const issuerOptions = getIssuerOptions()
  const seamlessConfig = getSeamlessSignupConfig()

  const [selectedIssuer, setSelectedIssuer] = useState(issuerOptions[0]?.value ?? '')
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nodeHandle, setNodeHandle] = useState('')
  const [notificationEmail, setNotificationEmail] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createNotice, setCreateNotice] = useState<string | null>(null)
  const [createSteps, setCreateSteps] = useState<ProgressStep[]>([])

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
    if (!isRestoring && isLoggedIn && pathname === '/') {
      // Fail-closed routing: only verified sessions enter the app. Seamless node
      // users (already anchored on-chain) go straight to their Local node;
      // everyone else must pass through onboarding, which blocks until the
      // on-chain lockb0x pairing is verified.
      if (attestationStatus === 'verified') {
        router.replace(nodeSession ? '/local' : '/feed')
      } else {
        router.replace('/onboarding')
      }
    }
  }, [attestationStatus, isLoggedIn, isRestoring, nodeSession, pathname, router])

  const handleSignIn = async (): Promise<void> => {
    setError(null)
    const trimmed = selectedIssuer.trim()
    if (!trimmed) {
      setError('Select an identity provider to continue.')
      return
    }
    if (!trimmed.startsWith('https://')) {
      setError('Identity provider must use https://')
      return
    }
    setIsSigningIn(true)
    try {
      await signIn(trimmed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Check the URL and try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleGetStarted = async (source: 'card' | 'footer'): Promise<void> => {
    setError(null)
    try {
      await beginSolidSignup(source)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open account creation. Try again.')
    }
  }

  const handleCreateNode = async (): Promise<void> => {
    setError(null)
    setCreateNotice(null)

    // Fail-closed: the embedded wallet must be provisioned before onboarding.
    // Without a Stellar public key the provisioner silently skips on-chain
    // lockb0x creation, which previously let users continue un-anchored.
    if (!walletInfo?.publicKey) {
      setError('Your wallet is still initializing. Wait a moment and try again.')
      return
    }

    setIsCreating(true)
    try {
      // Produce the real on-device attestation first: a pod_ownership Groth16
      // proof (identity commitment) + Stellar-encrypted claim. Bound to the
      // deterministic WebID/Pod the provisioner will create for this handle.
      const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
      const issuerBase = (appExtra?.nodeZeroIssuerUrl ?? '').replace(/\/+$/, '')
      const normalizedHandle = nodeHandle.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
      if (!issuerBase || !normalizedHandle) {
        setError('Node identity provider is not configured. Try again later.')
        return
      }
      const expectedWebId = `${issuerBase}/${normalizedHandle}/profile/card#me`
      const expectedPodUrl = `${issuerBase}/${normalizedHandle}/`

      // Show the step ladder: the wallet is ready (checked above), so it is
      // pre-completed and proof generation becomes the active step.
      setCreateSteps(
        CREATE_STEP_DEFS.map(([key, label]) => ({
          key,
          label,
          status: key === 'wallet' ? 'done' : key === 'proof' ? 'active' : 'pending',
        })),
      )

      setCreateNotice('Generating your zero-knowledge proof…')
      const attestation = await createSeamlessAttestation(
        expectedWebId,
        expectedPodUrl,
        walletInfo.publicKey,
      )
      advanceCreateStep('proof')
      setCreateNotice('Creating your Pod on the Node Zero Community Server…')

      const result = await createSeamlessNode({
        handle: nodeHandle,
        notificationEmail,
        stellarPublicKey: walletInfo.publicKey,
        accountCommitmentHex: attestation.accountCommitmentHex,
        ciphertextHex: attestation.ciphertextHex,
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
        return
      }

      // Fail-closed: the real ZK attestation (identity commitment + encrypted
      // claim) must be anchored on-chain. Without it the node is unverifiable.
      if (!result.attestation) {
        failActiveCreateStep()
        setError('Node created, but the on-chain attestation was not anchored. Please try again.')
        return
      }
      advanceCreateStep('anchor')

      const root = result.lockbox.proofRootHex
      setCreateNotice(
        `Node created. WebID: ${result.webId}\nStellar key: ${result.stellarPublicKey}\nLockb0x (on-chain): ${anchored}\nIdentity anchor: ${result.attestation.accountCommitmentHex}${root ? `\nPairing root: ${root}` : ''}\nSigning you in…`,
      )

      // Auto sign-in: the provisioner already persisted the account to the Pod
      // and anchored the pairing on-chain, so we record the non-secret node
      // session locally and land the user in their Local node.
      const record: NodeSessionRecord = {
        webId: result.webId,
        podUrl: result.podUrl,
        stellarPublicKey: result.stellarPublicKey,
        userLockboxContractId: anchored,
        lockboxFactoryContractId: result.lockbox.factoryContractId ?? null,
        proofRootHex: result.lockbox.proofRootHex ?? null,
        accountDocumentUrl: result.accountDocumentUrl,
        createdAt: new Date().toISOString(),
      }
      await signInWithNode(record)
      advanceCreateStep('signin')
      router.replace('/local')
    } catch (err) {
      failActiveCreateStep()
      setError(mapCreateNodeError(err))
    } finally {
      setIsCreating(false)
    }
  }

  if (isRestoring) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    )
  }

  return (
    <>
      <AuthRedirectOverlay visible={isSigningIn} />
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
                {'Sign in with the Node Zero Community Server in one tap. New here? Create your node in seconds and you are ready to post.'}
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
                {'Returning user: sign in with the Node Zero Community Server or your existing Solid identity provider.'}
              </Text>
              <Text style={styles.heroBody}>
                {'New user: create your node with the streamlined flow below. The Node Zero Community Server creates your Pod, then you will be signed in automatically.'}
              </Text>
            </>
          )}
        </View>

        {/* ── Sign-in panel (always visible) ───────────── */}
        <LandingAuthCard
          source="card"
          showResumeHint
          issuerOptions={issuerOptions}
          selectedIssuer={selectedIssuer}
          signupResumeActive={signupResumeActive}
          signupReturnDetected={signupReturnDetected}
          error={error}
          isSigningIn={isSigningIn}
          seamlessEnabled={seamlessConfig.enabled}
          nodeHandle={nodeHandle}
          notificationEmail={notificationEmail}
          isCreating={isCreating}
          walletReady={Boolean(walletInfo?.publicKey)}
          createNotice={createNotice}
          createSteps={createSteps}
          onIssuerChange={setSelectedIssuer}
          onNodeHandleChange={setNodeHandle}
          onNotificationEmailChange={setNotificationEmail}
          onSignIn={handleSignIn}
          onCreateNode={handleCreateNode}
          onGetStarted={handleGetStarted}
          onClearError={() => setError(null)}
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
                showResumeHint={false}
                issuerOptions={issuerOptions}
                selectedIssuer={selectedIssuer}
                signupResumeActive={signupResumeActive}
                signupReturnDetected={signupReturnDetected}
                error={error}
                isSigningIn={isSigningIn}
                seamlessEnabled={seamlessConfig.enabled}
                nodeHandle={nodeHandle}
                notificationEmail={notificationEmail}
                isCreating={isCreating}
                walletReady={Boolean(walletInfo?.publicKey)}
                createNotice={createNotice}
                createSteps={createSteps}
                onIssuerChange={setSelectedIssuer}
                onNodeHandleChange={setNodeHandle}
                onNotificationEmailChange={setNotificationEmail}
                onSignIn={handleSignIn}
                onCreateNode={handleCreateNode}
                onGetStarted={handleGetStarted}
                onClearError={() => setError(null)}
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
  errorText: { color: DANGER, fontSize: 13, marginBottom: 10 },
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
