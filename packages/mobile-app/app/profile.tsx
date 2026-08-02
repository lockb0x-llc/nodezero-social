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
  Switch,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  getProvisionerUrl,
  useNodeZeroSession,
} from '../src/contexts/NodeZeroSessionContext'
import type {
  ProfileManager,
  ProfilePreferencesManager,
  UserProfile,
} from '@nodezero/solid-pod-sync'
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers'
import { Ionicons } from '@expo/vector-icons'
import { aesthetic } from '../src/theme/aesthetic'
import { useConnections } from '../src/social/useConnections'
import { deriveProfileViewState } from '../src/profile/viewState'
import {
  buildUpdatedProfileDraft,
  interestsToInput,
  mergeProfileData,
} from '../src/profile/mergeProfileData'
import { saveProfileForScreen } from '../src/profile/profileSaveCoordinator'
import {
  getProfileSaveValidationMessage,
  PROFILE_LIMITS,
} from '../src/profile/profileValidation'
import { updateDiscoveryPreferences } from '../src/directory/discoveryPreferences'
import { derivePersonActionPolicy } from '../src/social/personActionPolicy'
import {
  addTrustCircleMember,
  hasTrustCircleMember,
  removeTrustCircleMember,
} from '../src/social/trustCircleStore'
import {
  findPublicInterestOverlap,
  readPublicPeerProfile,
} from '../src/profile/publicPeerProfileClient'

const EMPTY_PROFILE: UserProfile = {
  displayName: '',
  bio: '',
  avatarUrl: undefined,
  externalUrl: undefined,
  interests: [],
  isNsfw: false,
}

export default function ProfileScreen(): JSX.Element {
  const { status, webId, authFetch } = useNodeZeroSession()
  const isLoggedIn = status === 'authenticated'
  const managerRef = useRef<ProfileManager | null>(null)
  const preferencesManagerRef = useRef<ProfilePreferencesManager | null>(null)

  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [loading, setLoading] = useState(true)
  const [managersReady, setManagersReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [nsfwWarningDismissed, setNsfwWarningDismissed] = useState(false)
  const [interestsInput, setInterestsInput] = useState('')
  const [sharedThreads, setSharedThreads] = useState<string[]>([])
  const [zkTooltipOpen, setZkTooltipOpen] = useState(false)
  const [connectionInput, setConnectionInput] = useState('')
  const [publicListing, setPublicListing] = useState(false)
  const [publicIndexing, setPublicIndexing] = useState(false)
  const [nearbyPresence, setNearbyPresence] = useState(false)
  const [localBroadcasts, setLocalBroadcasts] = useState(false)
  const [selectedPublicInterests, setSelectedPublicInterests] = useState<string[]>([])
  const [discoverySaving, setDiscoverySaving] = useState(false)
  const [discoveryStatus, setDiscoveryStatus] = useState<string | null>(null)
  const [peerInTrustCircle, setPeerInTrustCircle] = useState(false)
  const [trustCircleBusy, setTrustCircleBusy] = useState(false)

  const { peerWebId } = useLocalSearchParams<{ peerWebId?: string }>()
  const router = useRouter()
  const profileView = deriveProfileViewState(webId, peerWebId)
  const { ownerWebId, viewedWebId, isPeerView } = profileView
  const draftProfile = buildUpdatedProfileDraft(profile, interestsInput)
  const draftValidationMessage = !isPeerView
    ? getProfileSaveValidationMessage(draftProfile)
    : null

  const {
    connectionsLoading,
    connectionAuthorityReady,
    connections,
    relationships,
    blockedWebIds,
    connectionBusyWebId,
    connectionStatus,
    incomingRequests,
    inboundRequestsEnabled,
    inboxSyncing,
    loadConnections,
    syncIncomingRequests,
    setInboundRequestsEnabled,
    respondToIncomingRequest,
    addConnection,
    cancelConnectionRequest,
    removeConnection,
    setBlocked,
  } = useConnections({
    effectiveWebId: ownerWebId,
    authFetch,
  })
  const viewedRelationship = viewedWebId
    ? relationships.find((record) => record.peerWebId === viewedWebId)
    : undefined
  const peerActionPolicy = derivePersonActionPolicy({
    isSelf: !isPeerView,
    relationshipState: viewedRelationship?.state ?? null,
    blocked: Boolean(viewedWebId && blockedWebIds.includes(viewedWebId)),
    inTrustCircle: peerInTrustCircle,
  })

  useEffect(() => {
    if (!isLoggedIn || !isPeerView || !ownerWebId || !viewedWebId) {
      setPeerInTrustCircle(false)
      return
    }
    void hasTrustCircleMember(ownerWebId, viewedWebId, { fetch: authFetch })
      .then(setPeerInTrustCircle)
      .catch(() => setPeerInTrustCircle(false))
  }, [authFetch, isLoggedIn, isPeerView, ownerWebId, viewedWebId])

  const togglePeerTrustCircle = useCallback(async (): Promise<void> => {
    if (!ownerWebId || !viewedWebId) return
    setTrustCircleBusy(true)
    try {
      const next = peerInTrustCircle
        ? await removeTrustCircleMember(ownerWebId, viewedWebId, { fetch: authFetch })
        : await addTrustCircleMember(ownerWebId, viewedWebId, { fetch: authFetch })
      setPeerInTrustCircle(next.includes(viewedWebId))
    } finally {
      setTrustCircleBusy(false)
    }
  }, [authFetch, ownerWebId, peerInTrustCircle, viewedWebId])

  // Initialise ProfileManager once the session is available.
  useEffect(() => {
    if (!isLoggedIn) {
      setManagersReady(false)
      return
    }

    const managers = getSolidPodSyncManagers({ fetch: authFetch })
    managerRef.current = managers.profileManager
    preferencesManagerRef.current = managers.profilePreferencesManager
    setManagersReady(true)
    void loadConnections()
  }, [authFetch, isLoggedIn, loadConnections])

  useEffect(() => {
    if (!isLoggedIn || !ownerWebId || isPeerView) return
    const podRoot = `${ownerWebId.split('/profile/')[0]}/`
    const managers = getSolidPodSyncManagers({ fetch: authFetch })
    void Promise.all([
      managers.discoveryConsentManager.readConsent(podRoot),
      managers.discoveryManifestManager.readManifest(podRoot),
    ]).then(([consent, manifest]) => {
      setPublicListing(consent.publicListing)
      setPublicIndexing(consent.publicIndexing)
      setNearbyPresence(consent.nearbyPresence)
      setLocalBroadcasts(consent.localBroadcasts)
      setSelectedPublicInterests(manifest?.publicInterests ?? [])
    }).catch(() => {
      setPublicListing(false)
      setPublicIndexing(false)
      setNearbyPresence(false)
      setLocalBroadcasts(false)
      setSelectedPublicInterests([])
    })
  }, [authFetch, isLoggedIn, isPeerView, ownerWebId])

  const togglePublicInterest = useCallback((interest: string): void => {
    setSelectedPublicInterests((current) =>
      current.some((value) => value.toLowerCase() === interest.toLowerCase())
        ? current.filter((value) => value.toLowerCase() !== interest.toLowerCase())
        : [...current, interest]
    )
  }, [])

  const saveDiscoveryPreferences = useCallback(async (): Promise<void> => {
    if (!ownerWebId) return
    setDiscoverySaving(true)
    setDiscoveryStatus(null)
    try {
      const podRoot = `${ownerWebId.split('/profile/')[0]}/`
      const result = await updateDiscoveryPreferences({
        podRoot,
        ownerWebId,
        preferences: {
          publicListing,
          publicIndexing,
          nearbyPresence,
          localBroadcasts,
          selectedPublicInterests,
        },
        provisionerUrl: getProvisionerUrl(),
        authFetch,
        managers: getSolidPodSyncManagers({ fetch: authFetch }),
      })
      setSelectedPublicInterests(result.selectedPublicInterests)
      setDiscoveryStatus(
        result.listed
          ? 'Public directory projection updated.'
          : publicIndexing
            ? 'Public indexing manifest updated without directory listing.'
            : 'Public directory projection removed.'
      )
    } catch (error) {
      setDiscoveryStatus(error instanceof Error ? error.message : 'Unable to update discovery settings.')
    } finally {
      setDiscoverySaving(false)
    }
  }, [authFetch, localBroadcasts, nearbyPresence, ownerWebId, publicIndexing, publicListing, selectedPublicInterests])

  // Load profile from Pod.
  useEffect(() => {
    if (!viewedWebId || !managersReady || !managerRef.current) {
      setLoading(!managersReady)
      return
    }

    setLoading(true)
    if (isPeerView) {
      const ownerProfileRead = ownerWebId
        ? managerRef.current.readProfile(ownerWebId)
        : Promise.resolve(null)
      void Promise.all([
        readPublicPeerProfile(getProvisionerUrl(), viewedWebId, authFetch),
        ownerProfileRead,
      ])
        .then(([peerProfile, ownerProfile]) => {
          if (peerProfile) {
            setProfile(peerProfile)
            setInterestsInput(interestsToInput(peerProfile.interests))
            setSharedThreads(findPublicInterestOverlap(
              ownerProfile?.interests ?? [],
              peerProfile.interests
            ))
          }
        })
        .catch(() => {
          setSharedThreads([])
        })
        .finally(() => {
          setLoading(false)
        })
      return
    }

    const viewedPodRoot = viewedWebId.split('/profile/')[0] + '/'
    const preferenceRead = preferencesManagerRef.current?.readPreferences(viewedPodRoot) ??
      Promise.resolve(null)

    void Promise.all([
      managerRef.current.readProfile(viewedWebId),
      preferenceRead,
    ])
      .then(([publicProfile, privatePreferences]) => {
        if (publicProfile) {
          const mergedProfile = mergeProfileData(publicProfile, privatePreferences)
          setProfile(mergedProfile)
          setInterestsInput(interestsToInput(mergedProfile.interests))
        }
      })
      .finally(() => {
        setLoading(false)
      })
  }, [authFetch, isPeerView, managersReady, ownerWebId, viewedWebId])

  const saveProfile = useCallback(async () => {
    if (!managerRef.current || !preferencesManagerRef.current) {
      Alert.alert('Profile unavailable', 'Your Pod profile is still loading. Please try again.')
      return
    }
    if (draftValidationMessage) {
      Alert.alert('Profile Validation', draftValidationMessage)
      return
    }

    // Session invariant: being authenticated guarantees a live Pod write
    // path through the proxy — there is no "restoring" write state anymore.
    setSaving(true)
    try {
      const result = await saveProfileForScreen({
        isPeerView,
        ownerWebId,
        currentProfile: profile,
        interestsInput,
        deps: {
          writePublicProfile: async (podRoot, updatedProfile) => {
            await managerRef.current?.writeProfile(podRoot, updatedProfile, {
              bootstrapPodLayout: false,
            })
          },
          writePrivatePreferences: async (podRoot, preferencesPayload) => {
            await preferencesManagerRef.current?.writePreferences(podRoot, preferencesPayload)
          },
          readPublicProfile: async (webIdToRead) => managerRef.current?.readProfile(webIdToRead) ?? null,
          readPrivatePreferences: async (podRoot) =>
            preferencesManagerRef.current?.readPreferences(podRoot) ?? null,
        },
      })

      if (result.status === 'read-only') {
        Alert.alert('Read-only', result.message)
        return
      }

      if (result.status === 'no-op') {
        return
      }

      if (result.status === 'saved') {
        if (result.mergedSavedProfile) {
          setProfile(result.mergedSavedProfile)
          setInterestsInput(result.mergedSavedInterestsInput ?? interestsToInput(result.mergedSavedProfile.interests))
          const savedInterestKeys = new Set(
            result.mergedSavedProfile.interests.map((interest) => interest.trim().toLowerCase())
          )
          setSelectedPublicInterests((current) =>
            current.filter((interest) => savedInterestKeys.has(interest.trim().toLowerCase()))
          )
        }
        Alert.alert('Saved', result.message)
        return
      }
      Alert.alert('Error', result.message)
      console.error('[ProfileScreen] saveProfile error:', result.error)
    } finally {
      setSaving(false)
    }
  }, [draftValidationMessage, interestsInput, isPeerView, ownerWebId, profile])

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
          <Text style={[styles.webIdText, { marginBottom: 0, flex: 1 }]} numberOfLines={2}>{viewedWebId}</Text>
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
          editable={!isPeerView}
        />
        {!isPeerView ? (
          <Text style={styles.helperText}>
            {profile.displayName.length}/{PROFILE_LIMITS.displayNameMaxLength}
          </Text>
        ) : null}

        <Text style={styles.label}>Bio</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={profile.bio}
          onChangeText={(v) => setProfile((p) => ({ ...p, bio: v }))}
          placeholder="Tell the world about yourself"
          placeholderTextColor="#555"
          multiline
          numberOfLines={4}
          editable={!isPeerView}
        />
        {!isPeerView ? (
          <Text style={styles.helperText}>
            {profile.bio.length}/{PROFILE_LIMITS.bioMaxLength}
          </Text>
        ) : null}

        <Text style={styles.label}>Avatar URL</Text>
        <TextInput
          style={styles.input}
          value={profile.avatarUrl ?? ''}
          onChangeText={(v) => setProfile((p) => ({ ...p, avatarUrl: v || undefined }))}
          placeholder="https://…"
          placeholderTextColor="#555"
          autoCapitalize="none"
          keyboardType="url"
          editable={!isPeerView}
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
          editable={!isPeerView}
        />

        <Text style={styles.label}>Interests (comma-separated)</Text>
        <TextInput
          style={styles.input}
          value={interestsInput}
          onChangeText={setInterestsInput}
          placeholder="web3, privacy, music, art"
          placeholderTextColor="#555"
          editable={!isPeerView}
        />
        {!isPeerView ? (
          <Text style={styles.helperText}>
            {draftProfile.interests.length}/{PROFILE_LIMITS.maxInterests} interests
          </Text>
        ) : null}
        {!isPeerView && draftValidationMessage ? (
          <Text style={styles.validationText}>{draftValidationMessage}</Text>
        ) : null}

        {isPeerView && viewedWebId && connectionAuthorityReady ? (
          <View style={styles.peerActionRow}>
            {peerActionPolicy.canRequest ? (
              <TouchableOpacity
                style={styles.connectionActionButton}
                onPress={() => void addConnection(viewedWebId)}
                disabled={connectionBusyWebId === viewedWebId}
                accessibilityRole="button"
                accessibilityLabel={`Request relationship with ${viewedWebId}`}
              >
                <Text style={styles.connectionActionButtonText}>Request</Text>
              </TouchableOpacity>
            ) : null}
            {peerActionPolicy.canCancelRequest ? (
              <TouchableOpacity
                style={styles.secondaryActionButton}
                onPress={() => void cancelConnectionRequest(viewedWebId)}
                disabled={connectionBusyWebId === viewedWebId}
                accessibilityRole="button"
                accessibilityLabel={`Cancel relationship request to ${viewedWebId}`}
              >
                <Text style={styles.connectionActionButtonText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            {peerActionPolicy.canDisconnect ? (
              <TouchableOpacity
                style={styles.connectionRemoveButtonWide}
                onPress={() => void removeConnection(viewedWebId)}
                disabled={connectionBusyWebId === viewedWebId}
                accessibilityRole="button"
                accessibilityLabel={`Disconnect from ${viewedWebId}`}
              >
                <Text style={styles.connectionActionButtonText}>Disconnect</Text>
              </TouchableOpacity>
            ) : null}
            {peerActionPolicy.canMessage ? (
              <TouchableOpacity
                style={styles.messageActionButton}
                onPress={() => router.push({ pathname: '/local', params: { peerWebId: viewedWebId } })}
                accessibilityRole="button"
                accessibilityLabel={`Message ${viewedWebId}`}
              >
                <Ionicons name="chatbubble" size={16} color="#FFF" />
                <Text style={styles.connectionActionButtonText}>Message</Text>
              </TouchableOpacity>
            ) : null}
            {peerActionPolicy.canAddTrustCircle || peerActionPolicy.canRemoveTrustCircle ? (
              <TouchableOpacity
                style={styles.trustCircleActionButton}
                onPress={() => void togglePeerTrustCircle()}
                disabled={trustCircleBusy}
                accessibilityRole="button"
                accessibilityLabel={`${peerInTrustCircle ? 'Remove' : 'Add'} ${viewedWebId} ${peerInTrustCircle ? 'from' : 'to'} Trust Circle`}
              >
                {trustCircleBusy ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.connectionActionButtonText}>
                    {peerInTrustCircle ? 'Remove Circle' : 'Add Circle'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}
            {peerActionPolicy.reason === 'blocked' ? (
              <TouchableOpacity
                style={styles.unblockActionButton}
                onPress={() => void setBlocked(viewedWebId, false)}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${viewedWebId}`}
              >
                <Text style={styles.connectionActionButtonText}>Unblock</Text>
              </TouchableOpacity>
            ) : peerActionPolicy.canBlock ? (
              <TouchableOpacity
                style={styles.connectionRemoveButtonWide}
                onPress={() => void setBlocked(viewedWebId, true)}
                accessibilityRole="button"
                accessibilityLabel={`Block ${viewedWebId}`}
              >
                <Text style={styles.connectionActionButtonText}>Block</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {!isPeerView ? (
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={() => void saveProfile()}
            disabled={!managersReady || saving || Boolean(draftValidationMessage)}
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
        ) : null}

        {!isPeerView ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionCardTitle}>Discovery</Text>
            <View style={styles.requestConsentRow}>
              <Text style={styles.requestConsentTitle}>Public directory listing</Text>
              <Switch
                value={publicListing}
                onValueChange={setPublicListing}
                trackColor={{ false: '#343842', true: aesthetic.color.accent }}
                thumbColor="#FFF"
                accessibilityLabel="Enable public directory listing"
              />
            </View>
            <View style={styles.requestConsentRow}>
              <Text style={styles.requestConsentTitle}>Public profile indexing</Text>
              <Switch
                value={publicIndexing}
                onValueChange={setPublicIndexing}
                trackColor={{ false: '#343842', true: aesthetic.color.accent }}
                thumbColor="#FFF"
                accessibilityLabel="Enable public profile indexing"
              />
            </View>
            <View style={styles.requestConsentRow}>
              <Text style={styles.requestConsentTitle}>Nearby presence</Text>
              <Switch
                value={nearbyPresence}
                onValueChange={setNearbyPresence}
                trackColor={{ false: '#343842', true: aesthetic.color.accent }}
                thumbColor="#FFF"
                accessibilityLabel="Enable nearby presence"
              />
            </View>
            <View style={styles.requestConsentRow}>
              <Text style={styles.requestConsentTitle}>Local broadcasts</Text>
              <Switch
                value={localBroadcasts}
                onValueChange={setLocalBroadcasts}
                trackColor={{ false: '#343842', true: aesthetic.color.accent }}
                thumbColor="#FFF"
                accessibilityLabel="Enable local broadcasts"
              />
            </View>

            {draftProfile.interests.length > 0 ? (
              <View style={styles.publicInterestList}>
                {draftProfile.interests.map((interest) => {
                  const selected = selectedPublicInterests.some(
                    (value) => value.toLowerCase() === interest.toLowerCase()
                  )
                  return (
                    <TouchableOpacity
                      key={interest}
                      style={styles.publicInterestRow}
                      onPress={() => togglePublicInterest(interest)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`Publish interest ${interest}`}
                    >
                      <Ionicons
                        name={selected ? 'checkbox' : 'square-outline'}
                        size={20}
                        color={selected ? aesthetic.color.accentSoft : aesthetic.color.textLow}
                      />
                      <Text style={styles.publicInterestText}>{interest}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            ) : null}

            {discoveryStatus ? (
              <Text style={styles.discoveryStatusText}>{discoveryStatus}</Text>
            ) : null}
            <TouchableOpacity
              style={[styles.saveButton, discoverySaving && styles.saveButtonDisabled]}
              onPress={() => void saveDiscoveryPreferences()}
              disabled={discoverySaving}
              accessibilityRole="button"
              accessibilityLabel="Save discovery settings"
            >
              {discoverySaving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveButtonText}>Save discovery settings</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionCard}>
          <View style={styles.sectionCardHeader}>
            <Text style={styles.sectionCardTitle}>Connections</Text>
            {connectionsLoading ? <ActivityIndicator color={aesthetic.color.accentSoft} size="small" /> : null}
          </View>

          {!isPeerView ? (
            <>
              <View style={styles.requestConsentRow}>
                <View style={styles.requestConsentCopy}>
                  <Text style={styles.requestConsentTitle}>Relationship requests</Text>
                  <Text style={styles.emptySubtleText}>
                    Allow signed requests to be verified and shown here.
                  </Text>
                </View>
                <Switch
                  value={inboundRequestsEnabled}
                  onValueChange={(enabled) => void setInboundRequestsEnabled(enabled)}
                  trackColor={{ false: '#343842', true: aesthetic.color.accent }}
                  thumbColor="#FFF"
                  accessibilityLabel="Allow relationship requests"
                />
              </View>

              {inboundRequestsEnabled ? (
                <>
                  <TouchableOpacity
                    style={styles.requestRefreshButton}
                    onPress={() => void syncIncomingRequests()}
                    disabled={inboxSyncing}
                    activeOpacity={aesthetic.motion.pressOpacity}
                    accessibilityRole="button"
                    accessibilityLabel="Refresh relationship requests"
                  >
                    {inboxSyncing ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Ionicons name="refresh" size={16} color="#FFF" />
                    )}
                    <Text style={styles.requestRefreshText}>Refresh requests</Text>
                  </TouchableOpacity>

                  {incomingRequests.map((request) => (
                    <View key={request.peerWebId} style={styles.incomingRequestRow}>
                      <Text style={styles.connectionWebId} numberOfLines={2}>
                        {request.peerWebId}
                      </Text>
                      <View style={styles.incomingRequestActions}>
                        <TouchableOpacity
                          style={styles.requestRejectButton}
                          onPress={() => void respondToIncomingRequest(request.peerWebId, 'reject')}
                          disabled={connectionBusyWebId === request.peerWebId}
                          accessibilityRole="button"
                          accessibilityLabel={`Reject request from ${request.peerWebId}`}
                        >
                          <Ionicons name="close" size={17} color="#FFF" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.requestAcceptButton}
                          onPress={() => void respondToIncomingRequest(request.peerWebId, 'accept')}
                          disabled={connectionBusyWebId === request.peerWebId}
                          accessibilityRole="button"
                          accessibilityLabel={`Accept request from ${request.peerWebId}`}
                        >
                          <Ionicons name="checkmark" size={17} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </>
              ) : null}
            </>
          ) : null}

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
  helperText: { color: aesthetic.color.textLow, fontSize: 11, marginTop: 4 },
  validationText: { color: '#FCA5A5', fontSize: 12, marginTop: 8 },
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
  peerActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  connectionRemoveButtonWide: {
    minHeight: 38,
    backgroundColor: '#8B1E3F',
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  messageActionButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#23775A',
    borderRadius: 6,
    paddingHorizontal: 14,
  },
  secondaryActionButton: {
    minHeight: 38,
    backgroundColor: '#4A4F59',
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  trustCircleActionButton: {
    minHeight: 38,
    backgroundColor: '#315D44',
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  unblockActionButton: {
    minHeight: 38,
    backgroundColor: '#455A64',
    borderRadius: 6,
    justifyContent: 'center',
    paddingHorizontal: 14,
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
  requestConsentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  requestConsentCopy: { flex: 1 },
  requestConsentTitle: { color: aesthetic.color.textHigh, fontSize: 14, fontWeight: '700' },
  requestRefreshButton: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#343842',
    borderRadius: 6,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  requestRefreshText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  incomingRequestRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#343842',
    paddingVertical: 8,
  },
  incomingRequestActions: { flexDirection: 'row', gap: 8 },
  requestRejectButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#7A3036',
  },
  requestAcceptButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#23775A',
  },
  publicInterestList: { gap: 6, marginBottom: 12 },
  publicInterestRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  publicInterestText: { color: aesthetic.color.textHigh, fontSize: 13 },
  discoveryStatusText: { color: aesthetic.color.textMid, fontSize: 12, marginBottom: 10 },
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
