/**
 * LandingScreen – NodeZero.social public entry point.
 *
 * Marketing landing page for new and returning visitors.
 * New users: "Create Your Node" → solidcommunity.net Pod creation flow.
 * Returning users: "Sign In" → IDP URL entry → Solid Pod auth.
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
} from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import Constants from 'expo-constants'
import { useSolid } from '../src/contexts/SolidContext'

const DEFAULT_IDP = 'https://solidcommunity.net'
const NEW_POD_URL = 'https://solidcommunity.net/register'

function getSolidAuthMode(): 'external-css' | 'jss-local' {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return appExtra?.solidAuthMode === 'jss-local' ? 'jss-local' : 'external-css'
}

export default function LandingScreen(): JSX.Element {
  const { signIn, isLoggedIn, isRestoring } = useSolid()
  const router = useRouter()
  const pathname = usePathname()
  const solidAuthMode = getSolidAuthMode()
  const usesJssLocal = solidAuthMode === 'jss-local'
  const authModeLabel = usesJssLocal ? 'JSS Local' : 'External CSS'

  const [showSignIn, setShowSignIn] = useState(false)
  const [showModeInfo, setShowModeInfo] = useState(false)
  const [idpUrl, setIdpUrl] = useState(DEFAULT_IDP)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    if (!isRestoring && isLoggedIn && pathname === '/') {
      router.replace('/feed')
    }
  }, [isLoggedIn, isRestoring, pathname, router])

  const handleSignIn = async (): Promise<void> => {
    setError(null)
    const trimmed = idpUrl.trim()
    if (!trimmed) {
      setError('Enter your Identity Provider URL.')
      return
    }
    if (!trimmed.startsWith('https://')) {
      setError('URL must start with https://')
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

  const handleGetStarted = async (): Promise<void> => {
    // In JSS local mode, this bootstraps to the configured local WebID.
    // In external mode, this opens the standard Solid OIDC flow.
    setIsSigningIn(true)
    setError(null)
    try {
      await signIn(DEFAULT_IDP)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect. Try again.')
    } finally {
      setIsSigningIn(false)
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Top nav ─────────────────────────────────── */}
        <View style={styles.nav}>
          <Text style={styles.navLogo}>⊙ NodeZero</Text>
          <View style={styles.navRight}>
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>{authModeLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowModeInfo((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Auth mode information"
              style={styles.modeInfoButton}
            >
              <Text style={styles.modeInfoButtonText}>?</Text>
            </TouchableOpacity>
            {!usesJssLocal && (
              <TouchableOpacity
                onPress={() => setShowSignIn((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel="Sign in"
              >
                <Text style={styles.navSignIn}>Sign In</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {showModeInfo && (
          <View style={styles.modeTooltip}>
            <Text style={styles.modeTooltipText}>
              {usesJssLocal
                ? 'JSS Local mode signs in immediately using the configured bootstrap WebID and avoids external provider redirects.'
                : 'External CSS mode uses the standard Solid OIDC redirect to your Identity Provider.'}
            </Text>
          </View>
        )}

        {/* ── Hero ────────────────────────────────────── */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Decentralized · Private · Yours</Text>
          <Text style={styles.heroHeadline}>The social network{'\n'}you actually own.</Text>
          <Text style={styles.heroBody}>
            {usesJssLocal
              ? 'Your profile, posts, and connections launch from a local Solid Pod mode for instant onboarding. NodeZero keeps your identity and data portable from day one.'
              : 'Your profile, posts, and connections live in a personal data vault - not our servers. NodeZero cannot sell you, and you can leave any time with everything you built.'}
          </Text>

          <TouchableOpacity
            style={[styles.btnPrimary, isSigningIn && styles.btnDisabled]}
            onPress={() => void handleGetStarted()}
            disabled={isSigningIn}
            accessibilityRole="button"
            accessibilityLabel="Create your Node"
          >
            {isSigningIn && !showSignIn ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>{usesJssLocal ? 'Create Your Node (JSS Fast Path)  →' : 'Create Your Node  →'}</Text>
            )}
          </TouchableOpacity>

          {!usesJssLocal && (
            <TouchableOpacity
              style={styles.btnSecondary}
              onPress={() => setShowSignIn((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Sign in as returning user"
            >
              <Text style={styles.btnSecondaryText}>Already have a Pod? Sign In</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── Sign-in panel (collapsible) ──────────────── */}
        {showSignIn && !usesJssLocal && (
          <View style={styles.signInPanel}>
            <Text style={styles.signInTitle}>Sign in with your Solid Pod</Text>
            <Text style={styles.signInHint}>Enter your Identity Provider URL</Text>
            <TextInput
              style={styles.input}
              value={idpUrl}
              onChangeText={setIdpUrl}
              placeholder="https://solidcommunity.net"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Identity Provider URL"
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            <TouchableOpacity
              style={[styles.btnPrimary, isSigningIn && styles.btnDisabled]}
              onPress={() => void handleSignIn()}
              disabled={isSigningIn}
            >
              {isSigningIn ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.btnPrimaryText}>Sign In</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => void Linking.openURL(NEW_POD_URL)} style={styles.createPodLink}>
              <Text style={styles.createPodText}>Need a Pod? Create one free →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── How it works ────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionEyebrow}>Three steps</Text>
          <Text style={styles.sectionTitle}>Own your identity in minutes</Text>
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
            "NodeZero cannot read your data, sell your profile, or shut down your identity."
          </Text>
          <Text style={styles.trustSub}>Your Pod. Your keys. Your network.</Text>
        </View>

        {/* ── Final CTA ───────────────────────────────── */}
        <View style={styles.finalCta}>
          <Text style={styles.finalCtaTitle}>Ready to own your network?</Text>
          <TouchableOpacity
            style={[styles.btnPrimary, isSigningIn && styles.btnDisabled]}
            onPress={() => void handleGetStarted()}
            disabled={isSigningIn}
          >
            <Text style={styles.btnPrimaryText}>Create Your Node — It's Free</Text>
          </TouchableOpacity>
          <Text style={styles.finalCtaSub}>
            Powered by{' '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://solidproject.org')}>Solid</Text>
            {' '}·{' '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://stellar.org')}>Stellar</Text>
            {' '}·{' '}
            {usesJssLocal ? 'JSS Fast Onboarding' : 'Open source'}
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ── Content ─────────────────────────────────────────────────────────────────

const STEPS = [
  {
    title: 'Get your Pod',
    desc: 'Start with a fast local Solid Pod onboarding path. You can still use external Solid providers when needed.',
  },
  {
    title: 'Link your identity',
    desc: 'Connect your Stellar wallet. A zero-knowledge attestation links your Web3 identity to your Pod without exposing private data.',
  },
  {
    title: 'Start broadcasting',
    desc: 'Post to your local H3 grid, your close circles, or verified humans nearby. Your feed — chronological, unmanipulated.',
  },
]

const FEATURES = [
  {
    icon: '🔐',
    title: 'You own every byte',
    desc: 'Your profile lives in your Solid Pod. Delete your NodeZero account and your data stays with you.',
  },
  {
    icon: '📍',
    title: 'Find people nearby',
    desc: 'H3 hexagonal grids surface real people in your vicinity. No global firehose, no follower counts.',
  },
  {
    icon: '🚫',
    title: 'No feed manipulation',
    desc: 'Posts arrive in the order they were sent. No engagement scoring, no recommendation engine.',
  },
  {
    icon: '🛡️',
    title: 'Verified, not surveilled',
    desc: 'Zero-knowledge proofs confirm you\'re a real human. NodeZero never learns your name, location, or IP.',
  },
]

// ── Styles ───────────────────────────────────────────────────────────────────

const PURPLE = '#6C63FF'
const BG = '#0D0D0D'
const SURFACE = '#161616'
const BORDER = '#2A2A2A'
const TEXT = '#F0F0F0'
const MUTED = '#888'
const DIM = '#555'

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
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 15,
    backgroundColor: '#111',
    marginBottom: 12,
  },
  errorText: { color: '#FF4D4D', fontSize: 13, marginBottom: 10 },
  createPodLink: { marginTop: 8, alignItems: 'center' },
  createPodText: { color: PURPLE, fontSize: 13 },

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
