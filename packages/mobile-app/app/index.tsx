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
import { useWallet } from '../src/contexts/WalletContext'
import { aesthetic } from '../src/theme/aesthetic'
import { beginSolidSignup } from '../src/onboarding/signupBridge'

const PRESS_OPACITY = 0.82

function getSolidOidcIssuerUrl(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return appExtra?.solidOidcIssuerUrl?.trim() || 'https://solidcommunity.net/.account/login/password/register/'
}

export default function LandingScreen(): JSX.Element {
  const {
    signIn,
    isLoggedIn,
    isRestoring,
    signupResumeActive,
    signupReturnDetected,
  } = useSolid()
  const { attestationStatus } = useWallet()
  const router = useRouter()
  const pathname = usePathname()
  const defaultIdp = getSolidOidcIssuerUrl()

  const [idpUrl, setIdpUrl] = useState(defaultIdp)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  React.useEffect(() => {
    if (!isRestoring && isLoggedIn && pathname === '/') {
      if (attestationStatus === 'verified') {
        router.replace('/feed')
      } else {
        router.replace('/onboarding')
      }
    }
  }, [attestationStatus, isLoggedIn, isRestoring, pathname, router])

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

  const handleGetStarted = async (source: 'card' | 'footer'): Promise<void> => {
    setError(null)
    try {
      await beginSolidSignup(source)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open account creation. Try again.')
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
        </View>

        {/* ── Hero ────────────────────────────────────── */}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>Decentralized · Private · Yours</Text>
          <Text style={styles.heroHeadline}>The social network{'\n'}you actually own.</Text>
          <Text style={styles.heroBody}>
            {'Create a real Solid account with your own Pod, then sign in through OIDC. Your profile, posts, and connections stay portable from day one.'}
          </Text>
        </View>

        {/* ── Sign-in panel (always visible) ───────────── */}
        <View style={styles.signInPanel}>
          <Text style={styles.signInTitle}>Sign in with your Solid Pod</Text>
          <Text style={styles.signInHint}>Enter your Identity Provider URL</Text>
          {signupResumeActive ? (
            <Text style={styles.resumeHint}>
              {signupReturnDetected
                ? 'Signup return detected. Continue by signing in with your new Solid Pod identity.'
                : 'Need a Pod first? Create one, then return here to continue onboarding.'}
            </Text>
          ) : null}
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
            activeOpacity={PRESS_OPACITY}
          >
            {isSigningIn ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnPrimaryText}>Sign In</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => void handleGetStarted('card')}
            style={styles.createPodLink}
            activeOpacity={PRESS_OPACITY}
          >
            <Text style={styles.createPodText}>Need a Pod? Create one free →</Text>
          </TouchableOpacity>
        </View>

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
            "NodeZero cannot read your data, sell your profile, or take your identity away."
          </Text>
          <Text style={styles.trustSub}>Your Pod. Your keys. Your network.</Text>
        </View>

        {/* ── Final CTA ───────────────────────────────── */}
        <View style={styles.finalCta}>
          <Text style={styles.finalCtaTitle}>Ready to own your network?</Text>
          <TouchableOpacity
            style={[styles.btnPrimary, isSigningIn && styles.btnDisabled]}
            onPress={() => void handleGetStarted('footer')}
            disabled={isSigningIn}
            activeOpacity={PRESS_OPACITY}
          >
            <Text style={styles.btnPrimaryText}>Create Your Node - Free</Text>
          </TouchableOpacity>
          <Text style={styles.finalCtaSub}>
            Powered by{' '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://solidproject.org')}>Solid</Text>
            {' '}·{' '}
            <Text style={styles.link} onPress={() => void Linking.openURL('https://stellar.org')}>Stellar</Text>
            {' '}·{' '}
            {'Open source'}
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
    desc: 'Create a Solid account with your Pod using the configured staging identity provider.',
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

const PURPLE = aesthetic.color.accent
const BG = aesthetic.color.bgNight
const SURFACE = aesthetic.color.surface
const BORDER = aesthetic.color.border
const TEXT = aesthetic.color.textHigh
const MUTED = aesthetic.color.textMid
const DIM = aesthetic.color.textLow

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
  resumeHint: { fontSize: 12, color: DIM, marginBottom: 12, lineHeight: 18 },
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
