/**
 * ProfileScreen
 *
 * Reads and writes the authenticated user's profile directly from/to their
 * Solid Pod using `@nodezero/solid-pod-sync`.
 *
 * NSFW interstitial: if the Pod's `isNSFW` flag is true, a dismissible
 * warning banner is shown before the profile content is rendered.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import type {
  ProfileManager,
  ProfilePreferencesManager,
  PrivateProfilePreferencesDocument,
  NsfwScanResult,
  UserProfile,
} from '@nodezero/solid-pod-sync'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { NsfwScanner } from '@nodezero/solid-pod-sync'
import { Ionicons } from '@expo/vector-icons'
import { aesthetic } from '../src/theme/aesthetic'
import { useConnections } from '../src/social/useConnections'

const EMPTY_PROFILE: UserProfile = {
  displayName: '',
  bio: '',
  avatarUrl: undefined,
  externalUrl: undefined,
  interests: [],
  isNsfw: false,
}

const nsfwScanner = new NsfwScanner()

export default function ProfileScreen(): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const isLoggedIn = status === 'authenticated'
  const managerRef = useRef<ProfileManager | null>(null)
  const preferencesManagerRef = useRef<ProfilePreferencesManager | null>(null)

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nsfwWarningDismissed, setNsfwWarningDismissed] = useState(false)
  const [interestsInput, setInterestsInput] = useState('')
  const [sharedThreads, setSharedThreads] = useState<string[]>([])
  const [zkTooltipOpen, setZkTooltipOpen] = useState(false)
  const [connectionInput, setConnectionInput] = useState('')

  const { peerWebId } = useLocalSearchParams<{ peerWebId?: string }>()
  const router = useRouter()
  const effectiveWebId = webId

  const {
    connectionsLoading,
    connections,
    connectionBusyWebId,
    connectionStatus,
    loadConnections,
    addConnection,
    removeConnection,
  } = useConnections({
    effectiveWebId,
    authFetch,
  })

  // Peer view: load semantic overlap when viewing another user's profile.
  useEffect(() => {
    if (!peerWebId || !isLoggedIn) return
    getSolidPodSyncManagers({ fetch: authFetch })
      .socialGraph
      .findSemanticOverlap(peerWebId, profile.interests)
      .then((threads) => {
        setSharedThreads(threads)
      })
      .catch(() => {
        setSharedThreads([])
      })
  }, [authFetch, peerWebId, isLoggedIn, profile.interests])

  // Initialise ProfileManager once the session is available.
  useEffect(() => {
    if (!isLoggedIn) {
      return
    }

    const managers = getSolidPodSyncManagers({ fetch: authFetch })
    managerRef.current = managers.profileManager
    preferencesManagerRef.current = managers.profilePreferencesManager
    void loadConnections()
  }, [authFetch, isLoggedIn, loadConnections])

  // Load profile from Pod.
  useEffect(() => {
    if (!effectiveWebId || !managerRef.current) {
      setLoading(false)
      return
    }

    setLoading(true)
    const podRoot = effectiveWebId.split('/profile/')[0] + '/'
    void Promise.all([
      managerRef.current.readProfile(effectiveWebId),
      preferencesManagerRef.current?.readPreferences(podRoot) ?? Promise.resolve(null),
    ])
      .then(([publicProfile, privatePreferences]) => {
        if (publicProfile) {
          const mergedProfile: UserProfile = {
            ...publicProfile,
            interests: privatePreferences?.interests ?? [],
            isNsfw: privatePreferences?.isNsfw ?? false,
          }
          setProfile(mergedProfile)
          setInterestsInput(mergedProfile.interests.join(', '))
        }
      })
      .finally(() => {
        setLoading(false)
      })
  }, [effectiveWebId])

  const saveProfile = useCallback(async () => {
    if (!effectiveWebId || !managerRef.current || !preferencesManagerRef.current) return

    // Session invariant: being authenticated guarantees a live Pod write
    // path through the proxy — there is no "restoring" write state anymore.
    const podRoot = effectiveWebId.split('/profile/')[0] + '/'
    const updatedProfile: UserProfile = {
      ...profile,
      interests: interestsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }

    setSaving(true)
    try {
      await managerRef.current.writeProfile(effectiveWebId, updatedProfile)

      const urlsToScan: string[] = []
      if (updatedProfile.externalUrl) urlsToScan.push(updatedProfile.externalUrl)
      if (updatedProfile.avatarUrl) urlsToScan.push(updatedProfile.avatarUrl)
      const scanResult: NsfwScanResult = nsfwScanner.scan(urlsToScan)

      const preferencesPayload: PrivateProfilePreferencesDocument = {
        interests: updatedProfile.interests,
        isNsfw: updatedProfile.isNsfw || scanResult.isNsfw,
      }
      await preferencesManagerRef.current.writePreferences(podRoot, preferencesPayload)

      // Re-read to pick up any server-side mutations (e.g. NSFW auto-tag).
      const [savedPublic, savedPrivate] = await Promise.all([
        managerRef.current.readProfile(`${podRoot}profile/card#me`),
        preferencesManagerRef.current.readPreferences(podRoot),
      ])
      if (savedPublic) {
        const mergedSaved: UserProfile = {
          ...savedPublic,
          interests: savedPrivate?.interests ?? [],
          isNsfw: savedPrivate?.isNsfw ?? false,
        }
        setProfile(mergedSaved)
        setInterestsInput(mergedSaved.interests.join(', '))
      }
      Alert.alert('Saved', 'Your profile has been updated in your Solid Pod.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save profile. Please try again.'
      Alert.alert('Error', message)
      console.error('[ProfileScreen] saveProfile error:', err)
    } finally {
      setSaving(false)
    }
  }, [effectiveWebId, interestsInput, profile])

  if (!isLoggedIn) {
    return (
      <View style={styles.centred}>
        <Text style={styles.infoText}>Please sign in to view your profile.</Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    )
  }

  return (
    <>
      {/* NSFW interstitial modal */}
      <Modal
        visible={profile.isNsfw && !nsfwWarningDismissed}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>🔞 Adult Content Notice</Text>
            <Text style={styles.modalBody}>
              This profile contains links to adult-oriented content and has been
              tagged as NSFW. NodeZero does not penalize users for legal content -
              this notice is shown so you can make an informed choice.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setNsfwWarningDismissed(true)}
              activeOpacity={aesthetic.motion.pressOpacity}
            >
              <Text style={styles.modalButtonText}>Continue to profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={zkTooltipOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setZkTooltipOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={[styles.modalTitle, styles.zkModalTitle]}>Zero-Knowledge Identity</Text>
            <Text style={styles.modalBody}>
              <Text style={{ fontWeight: '700', color: '#10B981' }}>{'What NodeZero knows:\n'}</Text>
              {'You are a unique human.\n\n'}
              <Text style={{ fontWeight: '700', color: '#FF6B6B' }}>{"What it doesn't know:\n"}</Text>
              {'Your name, location, or IP.'}
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setZkTooltipOpen(false)}
              activeOpacity={aesthetic.motion.pressOpacity}
            >
              <Text style={styles.modalButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {/* Settings gear — floated to the top-right; Settings screen accessible
            without occupying a permanent nav tab on narrow viewports. */}
        <View style={styles.settingsRow}>
          <TouchableOpacity
            onPress={() => router.push('/settings')}
            style={styles.settingsButton}
            accessibilityRole="button"
            accessibilityLabel="Open Settings"
            activeOpacity={aesthetic.motion.pressOpacity}
          >
            <Ionicons name="settings-outline" size={22} color={aesthetic.color.textMid} />
          </TouchableOpacity>
        </View>

        {profile.isNsfw && nsfwWarningDismissed && (
          <View style={styles.nsfwBanner}>
            <Text style={styles.nsfwBannerText}>NSFW content detected in this profile</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>WebID</Text>
        <View style={styles.webIdRow}>
          <Text style={[styles.webIdText, { marginBottom: 0, flex: 1 }]} numberOfLines={2}>{effectiveWebId}</Text>
          {profile.isNsfw === false && (
            <TouchableOpacity
              onPress={() => setZkTooltipOpen(true)}
              style={styles.zkBadge}
              accessibilityLabel="ZK Proof of Humanity badge"
              activeOpacity={aesthetic.motion.pressOpacity}
            >
              <Ionicons name="shield-checkmark" size={20} color="#10B981" />
            </TouchableOpacity>
          )}
        </View>

        {sharedThreads.length > 0 && (
          <View style={styles.sharedThreadsCard}>
            <Text style={styles.sharedThreadsTitle}>Shared Threads</Text>
            <Text style={styles.sharedThreadsSubtitle}>Topics you both care about:</Text>
            <View style={styles.pillRow}>
              {sharedThreads.map((thread) => (
                <View key={thread} style={styles.pill}>
                  <Text style={styles.pillText}>{thread}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Text style={styles.label}>Display Name</Text>
        <TextInput
          style={styles.input}
          value={profile.displayName}
          onChangeText={(v) => setProfile((p) => ({ ...p, displayName: v }))}
          placeholder="Your name"
          placeholderTextColor="#555"
        />

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={profile.bio}
          onChangeText={(v) => setProfile((p) => ({ ...p, bio: v }))}
          placeholder="Tell the world about yourself"
          placeholderTextColor="#555"
          multiline
          numberOfLines={4}
        />

        <Text style={styles.label}>Avatar URL</Text>
        <TextInput
          style={styles.input}
          value={profile.avatarUrl ?? ''}
          onChangeText={(v) => setProfile((p) => ({ ...p, avatarUrl: v || undefined }))}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="url"
        />

        <Text style={styles.label}>External URL</Text>
        <TextInput
          style={styles.input}
          value={profile.externalUrl ?? ''}
          onChangeText={(v) => setProfile((p) => ({ ...p, externalUrl: v || undefined }))}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="url"
        />

        <Text style={styles.label}>Interests (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={interestsInput}
          onChangeText={setInterestsInput}
          placeholder="web3, privacy, music, art"
          placeholderTextColor="#555"
        />

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={() => void saveProfile()}
          disabled={saving}
          activeOpacity={aesthetic.motion.pressOpacity}
          accessibilityRole="button"
          accessibilityLabel="Save profile"
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.saveButtonText}>Save to Solid Pod</Text>
          )}
        </TouchableOpacity>

        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>Connections</Text>
            {connectionsLoading ? <ActivityIndicator color={aesthetic.color.accentSoft} size="small" /> : null}
          </View>

          <View style={styles.connectionComposerRow}>
            <TextInput
              style={[styles.input, styles.connectionInput]}
              value={connectionInput}
              onChangeText={setConnectionInput}
              placeholder="https://node-handle/profile/card#me"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.connectionActionButton}
              onPress={() => {
                void addConnection(connectionInput).then((didAdd) => {
                  if (didAdd) setConnectionInput('')
                })
              }}
              disabled={Boolean(connectionBusyWebId) || connectionInput.trim().length === 0}
              activeOpacity={aesthetic.motion.pressOpacity}
            >
              <Text style={styles.connectionActionButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {connectionStatus ? (
            <Text
              style={[
                styles.connectionStatusText,
                connectionStatus.type === 'error'
                  ? styles.connectionStatusError
                  : connectionStatus.type === 'success'
                    ? styles.connectionStatusSuccess
                    : styles.connectionStatusInfo,
              ]}
            >
              {connectionStatus.message}
            </Text>
          ) : null}

          {connections.length === 0 ? (
            <Text style={styles.emptySubtleText}>No connections yet. Add a WebID to build your contact list.</Text>
          ) : (
            connections.map((connectionWebId) => (
              <View key={connectionWebId} style={styles.connectionRow}>
                <Text style={styles.connectionWebId} numberOfLines={2}>{connectionWebId}</Text>
                <TouchableOpacity
                  style={styles.connectionRemoveButton}
                  onPress={() => void removeConnection(connectionWebId)}
                  disabled={connectionBusyWebId === connectionWebId}
                  activeOpacity={aesthetic.motion.pressOpacity}
                >
                  {connectionBusyWebId === connectionWebId ? (
                    <ActivityIndicator color="#FFF" size="small" />
                  ) : (
                    <Ionicons name="person-remove" size={16} color="#FFF" />
                  )}
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  scrollContent: { padding: 20, paddingBottom: 48 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: aesthetic.color.bgNight },
  infoText: { color: aesthetic.color.textMid, fontSize: 14 },
  nsfwBanner: { backgroundColor: '#3D1515', borderRadius: 8, padding: 10, marginBottom: 16 },
  nsfwBannerText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  sectionLabel: { color: aesthetic.color.textLow, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  webIdText: { color: aesthetic.color.accentSoft, fontSize: 12, marginBottom: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  label: { color: aesthetic.color.textMid, fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: aesthetic.color.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: aesthetic.color.textHigh,
    fontSize: 14,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: 11 },
  saveButton: { marginTop: 28, backgroundColor: aesthetic.color.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  sectionCard: {
    marginTop: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    backgroundColor: aesthetic.color.surfaceAlt,
    padding: 14,
  },
  sectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionCardTitle: {
    color: aesthetic.color.textHigh,
    fontSize: 15,
    fontWeight: '800',
  },
  connectionComposerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  connectionInput: {
    flex: 1,
    marginTop: 0,
  },
  connectionActionButton: {
    backgroundColor: aesthetic.color.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  connectionActionButtonText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700',
  },
  connectionStatusText: {
    fontSize: 12,
    marginBottom: 8,
  },
  connectionStatusInfo: {
    color: '#93C5FD',
  },
  connectionStatusSuccess: {
    color: '#34D399',
  },
  connectionStatusError: {
    color: '#FCA5A5',
  },
  emptySubtleText: {
    color: aesthetic.color.textMid,
    fontSize: 12,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
    paddingTop: 10,
    marginTop: 10,
    gap: 10,
  },
  connectionWebId: {
    flex: 1,
    color: aesthetic.color.textMid,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  connectionRemoveButton: {
    backgroundColor: '#8B1E3F',
    borderRadius: 9,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Settings access
  settingsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4, marginTop: -4 },
  settingsButton: { padding: 8, borderRadius: 8 },
  // Shared Threads + ZK badge
  webIdRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  zkBadge: { marginLeft: 8, marginTop: 1 },
  sharedThreadsCard: { backgroundColor: aesthetic.color.surfaceAlt, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: aesthetic.color.border },
  sharedThreadsTitle: { color: '#FFF', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  sharedThreadsSubtitle: { color: aesthetic.color.textMid, fontSize: 12, marginBottom: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginRight: 8, marginBottom: 4 },
  pillText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  // NSFW modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: aesthetic.color.surface, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#3D1515' },
  modalTitle: { color: '#FF6B6B', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  zkModalTitle: { color: aesthetic.color.textHigh },
  modalBody: { color: aesthetic.color.textMid, fontSize: 14, lineHeight: 22, marginBottom: 20 },
  modalButton: { backgroundColor: aesthetic.color.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalButtonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
})
