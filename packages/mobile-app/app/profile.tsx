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
import { useLocalSearchParams } from 'expo-router'
import { useSolid } from '../src/contexts/SolidContext'
import { ProfileManager, SocialGraph, type UserProfile } from '@nodezero/solid-pod-sync'

// Stub — remove when @expo/vector-icons is installed (L3)
const Ionicons = (_props: { name: string; size?: number; color?: string }) => null

const EMPTY_PROFILE: UserProfile = {
  displayName: '',
  bio: '',
  avatarUrl: undefined,
  externalUrl: undefined,
  interests: [],
  isNsfw: false,
}

export default function ProfileScreen(): JSX.Element {
  const { session, webId, isLoggedIn } = useSolid()
  const managerRef = useRef<ProfileManager | null>(null)

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [nsfwWarningDismissed, setNsfwWarningDismissed] = useState(false)
  const [interestsInput, setInterestsInput] = useState('')
  const [sharedThreads, setSharedThreads] = useState<string[]>(['ZK cryptography', 'Stellar blockchain'])
  const [zkTooltipOpen, setZkTooltipOpen] = useState(false)

  const { peerWebId } = useLocalSearchParams<{ peerWebId?: string }>()

  // Peer view: load semantic overlap when viewing another user's profile.
  useEffect(() => {
    if (!peerWebId || !isLoggedIn) return
    new SocialGraph(session)
      .findSemanticOverlap(peerWebId)
      .then((threads) => {
        if (threads.length > 0) setSharedThreads(threads)
      })
      .catch(() => {
        // Keep mock default on error
      })
  }, [peerWebId, isLoggedIn, session])

  // Initialise ProfileManager once session is available.
  useEffect(() => {
    if (isLoggedIn) {
      managerRef.current = new ProfileManager(session)
    }
  }, [isLoggedIn, session])

  // Load profile from Pod.
  useEffect(() => {
    if (!webId || !managerRef.current) {
      setLoading(false)
      return
    }

    void managerRef.current.readProfile(webId).then((p) => {
      if (p) {
        setProfile(p)
        setInterestsInput(p.interests.join(', '))
      }
      setLoading(false)
    })
  }, [webId])

  const saveProfile = useCallback(async () => {
    if (!webId || !managerRef.current) return

    const podRoot = webId.split('/profile/')[0] + '/'
    const updatedProfile: UserProfile = {
      ...profile,
      interests: interestsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }

    setSaving(true)
    try {
      await managerRef.current.writeProfile(podRoot, updatedProfile)
      // Re-read to pick up any server-side mutations (e.g. NSFW auto-tag).
      const saved = await managerRef.current.readProfile(`${podRoot}profile/card#me`)
      if (saved) setProfile(saved)
      Alert.alert('Saved', 'Your profile has been updated in your Solid Pod.')
    } catch (err) {
      Alert.alert('Error', 'Failed to save profile. Please try again.')
      console.error('[ProfileScreen] saveProfile error:', err)
    } finally {
      setSaving(false)
    }
  }, [profile, interestsInput, webId])

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
              tagged as NSFW. NodeZero does not penalise users for legal content –
              this notice is shown so you can make an informed choice.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setNsfwWarningDismissed(true)}
            >
              <Text style={styles.modalButtonText}>I understand – show profile</Text>
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
            <Text style={styles.modalTitle}>🛡 Zero-Knowledge Identity</Text>
            <Text style={styles.modalBody}>
              <Text style={{ fontWeight: '700', color: '#10B981' }}>{'What NodeZero knows:\n'}</Text>
              {'You are a unique human.\n\n'}
              <Text style={{ fontWeight: '700', color: '#FF6B6B' }}>{"What it doesn't know:\n"}</Text>
              {'Your name, location, or IP.'}
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setZkTooltipOpen(false)}
            >
              <Text style={styles.modalButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {profile.isNsfw && nsfwWarningDismissed && (
          <View style={styles.nsfwBanner}>
            <Text style={styles.nsfwBannerText}>🔞 NSFW content detected in this profile</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>WebID</Text>
        <View style={styles.webIdRow}>
          <Text style={[styles.webIdText, { marginBottom: 0, flex: 1 }]} numberOfLines={2}>{webId}</Text>
          {profile.isNsfw === false && (
            <TouchableOpacity
              onPress={() => setZkTooltipOpen(true)}
              style={styles.zkBadge}
              accessibilityLabel="ZK Proof of Humanity badge"
            >
              <Ionicons name="shield-checkmark" size={20} color="#10B981" />
            </TouchableOpacity>
          )}
        </View>

        {sharedThreads.length > 0 && (
          <View style={styles.sharedThreadsCard}>
            <Text style={styles.sharedThreadsTitle}>✦ Shared Threads</Text>
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
          accessibilityRole="button"
          accessibilityLabel="Save profile"
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.saveButtonText}>Save to Solid Pod</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  scrollContent: { padding: 20, paddingBottom: 48 },
  centred: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0D0D0D' },
  infoText: { color: '#888', fontSize: 14 },
  nsfwBanner: { backgroundColor: '#3D1515', borderRadius: 8, padding: 10, marginBottom: 16 },
  nsfwBannerText: { color: '#FF6B6B', fontSize: 13, fontWeight: '600' },
  sectionLabel: { color: '#555', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  webIdText: { color: '#6C63FF', fontSize: 12, marginBottom: 20, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  label: { color: '#AAA', fontSize: 13, fontWeight: '600', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#1A1A1A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    paddingHorizontal: 14,
    paddingVertical: 11,
    color: '#FFF',
    fontSize: 14,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top', paddingTop: 11 },
  saveButton: { marginTop: 28, backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  // Shared Threads + ZK badge
  webIdRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  zkBadge: { marginLeft: 8, marginTop: 1 },
  sharedThreadsCard: { backgroundColor: '#667eea', borderRadius: 14, padding: 16, marginBottom: 20 },
  sharedThreadsTitle: { color: '#FFF', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  sharedThreadsSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginBottom: 10 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4, marginRight: 8, marginBottom: 4 },
  pillText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  // NSFW modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#1A1A1A', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#3D1515' },
  modalTitle: { color: '#FF6B6B', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  modalBody: { color: '#CCC', fontSize: 14, lineHeight: 22, marginBottom: 20 },
  modalButton: { backgroundColor: '#6C63FF', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalButtonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
})
