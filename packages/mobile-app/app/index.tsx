/**
 * LandingScreen – NodeZero.social entry point.
 *
 * Introduces the platform and provides the Solid Pod login / creation flow.
 * Unauthenticated users land here; they are redirected to the feed after
 * successful authentication.
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
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSolid } from '../src/contexts/SolidContext'

const DEFAULT_IDP = 'https://solidcommunity.net'

export default function LandingScreen(): JSX.Element {
  const { signIn, isLoggedIn, isRestoring } = useSolid()
  const router = useRouter()

  const [idpUrl, setIdpUrl] = useState(DEFAULT_IDP)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Redirect to feed once authenticated.
  React.useEffect(() => {
    if (!isRestoring && isLoggedIn) {
      router.replace('/feed')
    }
  }, [isLoggedIn, isRestoring, router])

  const handleSignIn = async (): Promise<void> => {
    setError(null)
    setIsSigningIn(true)
    try {
      await signIn(idpUrl.trim())
    } catch (err) {
      setError('Login failed. Please check the Identity Provider URL and try again.')
      console.error('[LandingScreen] signIn error:', err)
    } finally {
      setIsSigningIn(false)
    }
  }

  if (isRestoring) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>NodeZero</Text>
          <Text style={styles.heroTagline}>Your data. Your rules. Your network.</Text>
        </View>

        {/* Value proposition */}
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <Text style={styles.featureIcon}>{f.icon}</Text>
              <View style={styles.featureText}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Login form */}
        <View style={styles.form}>
          <Text style={styles.formLabel}>Solid Identity Provider</Text>
          <TextInput
            style={styles.input}
            value={idpUrl}
            onChangeText={setIdpUrl}
            placeholder="https://solidcommunity.net"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Solid Identity Provider URL"
          />
          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, isSigningIn && styles.buttonDisabled]}
            onPress={() => void handleSignIn()}
            disabled={isSigningIn}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Solid Pod"
          >
            {isSigningIn ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Sign in with Solid Pod</Text>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            {"Don't have a Pod? "}
            <Text
              style={styles.link}
              onPress={() => void signIn('https://solidcommunity.net')}
            >
              Create one for free at solidcommunity.net
            </Text>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const FEATURES = [
  { icon: '🔐', title: 'Data Sovereignty', desc: 'Your profile lives in your Solid Pod, not our servers.' },
  { icon: '🌍', title: 'Local Nodes', desc: 'Discover people near you using H3 hexagonal grids.' },
  { icon: '🚫', title: 'No Algorithms', desc: 'Strictly chronological feeds. No engagement farming.' },
  { icon: '🛡️', title: 'Privacy First', desc: 'Zero-Knowledge proofs verify you\'re human without revealing who you are.' },
]

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { flexGrow: 1, padding: 24 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D0D' },
  hero: { alignItems: 'center', marginTop: 48, marginBottom: 40 },
  heroTitle: { fontSize: 48, fontWeight: '900', color: '#6C63FF', letterSpacing: -1 },
  heroTagline: { fontSize: 16, color: '#AAA', marginTop: 8, textAlign: 'center' },
  features: { marginBottom: 40 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  featureIcon: { fontSize: 24, marginRight: 12, marginTop: 2 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  featureDesc: { fontSize: 13, color: '#888', marginTop: 2 },
  form: {},
  formLabel: { fontSize: 13, color: '#AAA', marginBottom: 6, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#FFF',
    fontSize: 15,
    backgroundColor: '#1A1A1A',
    marginBottom: 12,
  },
  errorText: { color: '#FF4D4D', fontSize: 13, marginBottom: 10 },
  button: {
    backgroundColor: '#6C63FF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 13, color: '#666', textAlign: 'center' },
  link: { color: '#6C63FF' },
})
