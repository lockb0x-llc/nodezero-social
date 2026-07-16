import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { useWallet } from '../src/contexts/WalletContext'
import { ProgressStepLadder } from '../src/components/ProgressStepLadder'
import { aesthetic } from '../src/theme/aesthetic'

const STATUS_TEXT: Record<string, string> = {
  idle: 'Preparing your attestation checks...',
  verifying: 'Verifying your Solid-WebID and Stellar Lockb0x pairing...',
  verified: 'Pairing verified. Redirecting you to your feed...',
  unlinked: 'Your lockb0x attestation is not linked. Sign in to start migration and complete relinking.',
  error: 'Attestation validation failed. Sign in to retry verification or restart secure onboarding.',
}

export default function OnboardingScreen(): JSX.Element {
  const { status, signOut } = useNodeZeroSession()
  const { attestationStatus, attestationMessage, verificationSteps } = useWallet()
  const router = useRouter()

  React.useEffect(() => {
    if (status === 'restoring') return

    if (status === 'unauthenticated') {
      router.replace('/')
    }
  }, [router, status])

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
          onPress={() => {
            void signOut().finally(() => router.replace('/'))
          }}
          accessibilityRole="button"
          accessibilityLabel="Return to sign in and continue secure onboarding"
        >
          <Text style={styles.buttonText}>Return to Sign In</Text>
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
