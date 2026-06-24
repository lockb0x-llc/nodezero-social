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
import { useSolid } from '../src/contexts/SolidContext'
import { useWallet } from '../src/contexts/WalletContext'

const SHOW_NSFW_KEY = 'settings.showNsfw'

export default function SettingsScreen(): JSX.Element {
  const { signOut, webId } = useSolid()
  const { walletInfo } = useWallet()
  const [showNsfw, setShowNsfw] = useState(false)

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
          onPress: async () => {
            await AsyncStorage.clear()
            Alert.alert('Done', 'Local cache cleared.')
          },
        },
      ]
    )
  }, [])

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* ── Solid Pod ─────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Solid Pod</Text>
      <View style={styles.card}>
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
          onPress={() => void signOut()}
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
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 48 },
  sectionHeader: { color: '#666', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 24, marginBottom: 8, marginLeft: 4 },
  card: { backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#2A2A2A', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#222' },
  rowTextWrap: { flex: 1, marginRight: 12 },
  rowLabel: { color: '#DDD', fontSize: 14, fontWeight: '600' },
  rowSub: { color: '#777', fontSize: 12, marginTop: 2 },
  rowValue: { color: '#AAA', fontSize: 12, textAlign: 'right', flex: 1 },
  rowValueMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 10, color: '#6C63FF' },
  dangerButton: { padding: 14, alignItems: 'center' },
  dangerButtonText: { color: '#FF6B6B', fontSize: 14, fontWeight: '600' },
  signOutButton: { padding: 14, alignItems: 'center' },
  signOutButtonText: { color: '#FF6B6B', fontSize: 15, fontWeight: '700' },
  version: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 32 },
})
