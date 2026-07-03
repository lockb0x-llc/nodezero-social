import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSolid } from '../src/contexts/SolidContext'
import { useWallet } from '../src/contexts/WalletContext'
import { ProgressStepLadder } from '../src/components/ProgressStepLadder'
import { aesthetic } from '../src/theme/aesthetic'

const STATUS_TEXT: Record<string, string> = {
  idle: 'Preparing your attestation checks...',
  verifying: 'Verifying your Solid-WebID and Stellar Lockb0x pairing...',
  verified: 'Pairing verified. Redirecting you to your feed...',
  unlinked: 'Pairing is not linked yet. Continue to Settings to relink your identity.',
  error: 'Attestation validation failed. Continue to Settings for details.',
}

export default function OnboardingScreen(): JSX.Element {
  const { isLoggedIn, isRestoring, nodeSession } = useSolid()
  const { attestationStatus, attestationMessage, verificationSteps } = useWallet()
  const router = useRouter()

  React.useEffect(() => {
    if (isRestoring) return

    if (!isLoggedIn) {
      router.replace('/')
      return
    }

    if (attestationStatus === 'verified') {
      router.replace(nodeSession ? '/local' : '/feed')
    }
  }, [attestationStatus, isLoggedIn, isRestoring, nodeSession, router])

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Finalizing your onboarding</Text>
      <Text style={styles.subtitle}>{STATUS_TEXT[attestationStatus] ?? 'Running onboarding checks...'}</Text>

      {verificationSteps.length > 0 ? (
        <View style={styles.ladderWrap}>
          <ProgressStepLadder steps={verificationSteps} />
        </View>
      ) : null}

      {(attestationStatus === 'idle' || attestationStatus === 'verifying') && verificationSteps.length === 0 ? (
        <ActivityIndicator size="large" color={aesthetic.color.accent} style={styles.spinner} />
      ) : null}

      {attestationMessage ? <Text style={styles.detail}>{attestationMessage}</Text> : null}

      {(attestationStatus === 'unlinked' || attestationStatus === 'error') ? (
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Open settings to resolve pairing"
        >
          <Text style={styles.buttonText}>Open Settings</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: aesthetic.color.bgNight,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: aesthetic.color.textHigh,
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    color: aesthetic.color.textMid,
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 500,
  },
  spinner: {
    marginTop: 24,
  },
  ladderWrap: {
    marginTop: 24,
    width: '100%',
    maxWidth: 420,
  },
  detail: {
    marginTop: 16,
    color: aesthetic.color.textLow,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 520,
  },
  button: {
    marginTop: 24,
    backgroundColor: aesthetic.color.accent,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
})
