/**
 * SettingsScreen
 *
 * User-configurable settings for NodeZero.social:
 * - NSFW content display toggle
 * - Solid Pod URL configuration
 * - Stellar wallet info (read-only) / export
 * - Clear local cache
 */

import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  Switch,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { useSolid } from '../src/contexts/SolidContext'
import { useWallet } from '../src/contexts/WalletContext'
import { aesthetic } from '../src/theme/aesthetic'

const SHOW_NSFW_KEY = 'settings.showNsfw'

function getSolidAuthMode(): 'external-css' | 'jss-local' {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return appExtra?.solidAuthMode === 'jss-local' ? 'jss-local' : 'external-css'
}

export default function SettingsScreen(): JSX.Element {
  const { signOut, webId } = useSolid()
  const router = useRouter()
  const { walletInfo, attestationStatus, attestationMessage, attestationDetails } = useWallet()
  const [showNsfw, setShowNsfw] = useState(false)
  const [showAuthModeHint, setShowAuthModeHint] = useState(false)
  const usesJssLocal = getSolidAuthMode() === 'jss-local'

  // Load persisted NSFW setting on mount.
  React.useEffect(() => {
    void AsyncStorage.getItem(SHOW_NSFW_KEY).then((val) => {
      if (val !== null) setShowNsfw(val === 'true')
    })
  }, [])

  const toggleNsfw = useCallback(async (val: boolean) => {
    setShowNsfw(val)
    await AsyncStorage.setItem(SHOW_NSFW_KEY, String(val))
  }, [])

  const clearCache = useCallback(() => {
    Alert.alert(
      'Clear Local Cache',
      'This will delete all locally cached data. Your Solid Pod data will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void AsyncStorage.clear().then(() => {
              Alert.alert('Done', 'Local cache cleared.')
            })
          },
        },
      ]
    )
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut()
    router.replace('/')
  }, [router, signOut])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Solid Pod ─────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Solid Pod</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Auth Mode</Text>
          <View style={styles.authModeWrap}>
            <View style={styles.authModeBadge}>
              <Text style={styles.authModeBadgeText}>{usesJssLocal ? 'JSS Local' : 'External CSS'}</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowAuthModeHint((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Auth mode explanation"
              style={styles.authModeInfoButton}
            >
              <Text style={styles.authModeInfoText}>?</Text>
            </TouchableOpacity>
          </View>
        </View>
        {showAuthModeHint ? (
          <Text style={styles.rowSubDetail}>
            {usesJssLocal
              ? 'JSS Local: uses the configured bootstrap WebID to start quickly without external redirect.'
              : 'External CSS: uses standard Solid OIDC redirect and provider-hosted sign-in.'}
          </Text>
        ) : null}
        <Row label="WebID" value={webId ?? 'Not signed in'} mono />
      </View>

      {/* ── Content Preferences ──────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Content Preferences</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.rowTextWrap}>
            <Text style={styles.rowLabel}>Show NSFW Content</Text>
            <Text style={styles.rowSub}>
              Displays profiles and posts flagged as adult content.
            </Text>
          </View>
          <Switch
            value={showNsfw}
            onValueChange={(v) => void toggleNsfw(v)}
            trackColor={{ false: '#333', true: '#6C63FF' }}
            thumbColor="#FFF"
            accessibilityLabel="Show NSFW content toggle"
          />
        </View>
      </View>

      {/* ── Embedded Wallet ──────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Embedded Wallet</Text>
      <View style={styles.card}>
        <Row
          label="Stellar Public Key"
          value={walletInfo?.publicKey ?? 'Provisioning…'}
          mono
        />
        <Row
          label="Network Status"
          value={walletInfo?.isFunded ? '✅ Active on Testnet' : '⏳ Not yet funded'}
        />
        <Row
          label="Pairing Attestation"
          value={attestationStatus === 'verified' ? '✅ Verified' : attestationStatus === 'verifying' ? '⏳ Verifying' : attestationStatus === 'unlinked' ? '⚠️ Unlinked' : attestationStatus === 'error' ? '❌ Error' : '—'}
        />
        {attestationMessage ? (
          <Text style={styles.rowSubDetail}>{attestationMessage}</Text>
        ) : null}
        <Row
          label="Registered WebID"
          value={attestationDetails.registeredWebId ?? 'Not verified'}
          mono
        />
        <Row
          label="Lockb0x Root"
          value={attestationDetails.lockboxStateRoot ?? 'Not verified'}
          mono
        />
        <Row
          label="Registration Tx"
          value={attestationDetails.registerTxHash ?? 'Not submitted this session'}
          mono
        />
        <Row
          label="Verified At"
          value={attestationDetails.verifiedAt ?? 'Not verified'}
        />
      </View>

      {/* ── Data Management ──────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Data Management</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.dangerButton}
          onPress={clearCache}
          accessibilityRole="button"
          accessibilityLabel="Export and erase local cache"
        >
          <Text style={styles.dangerButtonText}>🗑  Export & Erase Local Cache</Text>
        </TouchableOpacity>
      </View>

      {/* ── Account ──────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={() => void handleSignOut()}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.version}>NodeZero.social v0.0.1</Text>
    </ScrollView>
  )
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}): JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, mono && styles.rowValueMono]}
        numberOfLines={2}
        selectable
      >
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  content: { padding: 16, paddingBottom: 48 },
  sectionHeader: { color: aesthetic.color.textLow, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 24, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: aesthetic.color.surface, borderRadius: 12, borderWidth: 1, borderColor: aesthetic.color.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  rowTextWrap: { flex: 1, marginRight: 12 },
  rowLabel: { color: aesthetic.color.textHigh, fontSize: 14, fontWeight: '600' },
  rowSub: { color: aesthetic.color.textMid, fontSize: 12, marginTop: 2 },
  rowSubDetail: { color: aesthetic.color.textMid, fontSize: 12, marginHorizontal: 14, marginBottom: 12, marginTop: -4 },
  rowValue: { color: aesthetic.color.textMid, fontSize: 12, textAlign: 'right', flex: 1 },
  rowValueMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, color: aesthetic.color.accentSoft },
  authModeWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authModeBadge: {
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 999,
    backgroundColor: aesthetic.color.bgInk,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  authModeBadgeText: { color: aesthetic.color.textHigh, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  authModeInfoButton: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authModeInfoText: { color: aesthetic.color.textLow, fontSize: 11, fontWeight: '700' },
  dangerButton: { padding: 14, alignItems: 'center' },
  dangerButtonText: { color: aesthetic.color.danger, fontSize: 14, fontWeight: '600' },
  signOutButton: { padding: 14, alignItems: 'center' },
  signOutButtonText: { color: aesthetic.color.danger, fontSize: 15, fontWeight: '700' },
  version: { color: aesthetic.color.textLow, fontSize: 12, textAlign: 'center', marginTop: 32 },
})
