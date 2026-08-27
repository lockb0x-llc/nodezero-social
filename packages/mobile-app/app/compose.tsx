import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext';
import { useDiscovery } from '../src/contexts/DiscoveryContext';
import { useWallet } from '../src/contexts/WalletContext';
import { useWaku } from '../src/contexts/WakuContext';
import { cellTopic, createBroadcastBody, createEnvelope } from '@nodezero/waku-comms';
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers';
import { aesthetic } from '../src/theme/aesthetic';
import { resolveAudienceRecipients } from '../src/social/composeRecipients';
import { getAudienceDescription, type AudienceType } from '../src/social/composeAudience';
import { listTrustCircleMembers } from '../src/social/trustCircleStore';

export default function ComposeScreen(): JSX.Element {
  const [postText, setPostText] = useState('');
  const [audience, setAudience] = useState<AudienceType>('verified');
  const [sending, setSending] = useState(false);

  const { authFetch, webId } = useNodeZeroSession();
  const { currentNode, surroundingNodes } = useDiscovery();
  const { transport: wakuTransport, status: wakuStatus, appPrefix, signer } = useWaku();
  // verifyPoH may not exist on the wallet context type; cast as a stub if absent
  const walletCtx = useWallet() as { verifyPoH?: (webId: string) => Promise<boolean> };
  const verifyPoH: (webId: string) => Promise<boolean> =
    walletCtx.verifyPoH ?? ((_: string): Promise<boolean> => Promise.resolve(false));

  const handlePost = async (): Promise<void> => {
    if (!postText.trim()) return;
    setSending(true);
    try {
      if (audience === 'local') {
        // Publish a signed broadcast envelope to the current cell and its
        // surrounding H3 cells over the Waku local mesh.
        if (wakuStatus !== 'connected' || !wakuTransport || !signer || !webId) {
          throw new Error('Local broadcast requires the local mesh connection.');
        }
        const podRoot = `${webId.split('/profile/')[0]}/`;
        const consent = await getSolidPodSyncManagers({ fetch: authFetch })
          .discoveryConsentManager.readConsent(podRoot);
        if (!consent.localBroadcasts) {
          throw new Error('Enable Local broadcasts in Discovery settings before publishing.');
        }
        const h3Indexes = [
          ...new Set(
            [currentNode?.h3Index, ...surroundingNodes.map((node) => node.h3Index)].filter(
              (h3): h3 is string => typeof h3 === 'string' && h3.length > 0
            )
          ),
        ];
        if (h3Indexes.length === 0) {
          throw new Error('No local cell available — enable location to broadcast.');
        }
        const envelope = await createEnvelope(signer, {
          senderWebId: webId,
          kind: 'broadcast',
          body: createBroadcastBody({ text: postText }),
        });
        const results = await Promise.allSettled(
          h3Indexes.map((h3Index) => wakuTransport.publish(cellTopic(appPrefix, h3Index), envelope))
        );
        if (!results.some((result) => result.status === 'fulfilled')) {
          const firstError: unknown = results.find(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          )?.reason;
          throw firstError instanceof Error
            ? firstError
            : new Error('Broadcast was not accepted by the local mesh.');
        }
        if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
          globalThis.alert('Broadcast published to your local mesh.');
        } else {
          Alert.alert('Broadcast Sent', 'Published to your local mesh.');
        }
      } else if (audience === 'foaf' || audience === 'verified' || audience === 'trust-circle') {
        // Write payload to Pod /outbox/ container and public DocuStream stream via authenticated proxy fetch.
        // Verified mode applies an extra per-recipient PoH gate.
        const podRoot = (webId ?? '').split('/profile/')[0] + '/';
        const { relationshipManager, moderationManager, docustreamManager, profileManager } =
          getSolidPodSyncManagers({ fetch: authFetch });

        // Read author profile to attach display name:
        const profile = await profileManager.readProfile(webId ?? '').catch(() => null);
        const authorDisplayName = profile?.displayName?.trim() || webId || 'Node';

        // 1. Publish to user's public DocuStream activity feed on their Solid Pod:
        const streamItemId = 'broadcast-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        await docustreamManager
          .appendActivity(podRoot, {
            id: streamItemId,
            source: 'nodezero',
            author: authorDisplayName,
            title: 'Broadcast',
            content: postText.trim(),
            timestamp: new Date().toISOString(),
          })
          .catch((err) => {
            console.warn('[compose] failed saving to docustream:', err);
          });

        const [relationships, moderation] = await Promise.all([
          relationshipManager.listRelationships(podRoot),
          moderationManager.listModeration(podRoot),
        ]);
        const acceptedRelationships = relationships
          .filter((relationship) => relationship.state === 'accepted')
          .map((relationship) => relationship.peerWebId);
        const blockedWebIds = moderation
          .filter((record) => record.action === 'block')
          .map((record) => record.subjectWebId);
        const trustCircleMembers = webId ? await listTrustCircleMembers(webId, { fetch: authFetch }) : [];
        const recipientIds = resolveAudienceRecipients({
          audience,
          acceptedRelationships,
          trustCircleMembers,
          blockedWebIds,
        });
        const payload = JSON.stringify({ text: postText, audience, ts: Date.now() });

        // 2. Always save to the user's own Pod outbox container:
        await authFetch(
          podRoot +
            'outbox/' +
            Date.now() +
            '-' +
            Math.random().toString(36).slice(2) +
            '.json',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          }
        ).catch((err) => {
          console.warn('[compose] failed saving to own outbox:', err);
        });

        if (recipientIds.length > 0) {
          await Promise.allSettled(
            recipientIds.map(async (recipientWebId) => {
              if (audience === 'verified') {
                const isVerified = await verifyPoH(recipientWebId);
                if (!isVerified) {
                  console.warn('[compose] skipping unverified recipient', recipientWebId);
                  return;
                }
              }

              return authFetch(
                podRoot +
                  'outbox/' +
                  Date.now() +
                  '-' +
                  Math.random().toString(36).slice(2) +
                  '.json',
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: payload,
                }
              );
            })
          );
          const sentMsg = `Broadcast posted and delivered to ${recipientIds.length} ${recipientIds.length === 1 ? 'connection' : 'connections'}.`;
          if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
            globalThis.alert(sentMsg);
          } else {
            Alert.alert('Broadcast Sent', sentMsg);
          }
        } else {
          const emptyMsg =
            'Broadcast saved to your Pod outbox.\n\nYou have no accepted connections in this audience yet — connect with other nodes in the Directory tab to share posts.';
          if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
            globalThis.alert(emptyMsg);
          } else {
            Alert.alert('Broadcast Saved', emptyMsg);
          }
        }
      }
      setPostText('');
    } catch (err) {
      if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
        globalThis.alert(err instanceof Error ? err.message : 'Broadcast failed.');
      } else {
        Alert.alert('Broadcast Failed', err instanceof Error ? err.message : 'Unknown error');
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>New Broadcast</Text>
          <TouchableOpacity
            style={[styles.postButton, (!postText.trim() || sending) && styles.postButtonDisabled]}
            disabled={!postText.trim() || sending}
            onPress={() => { void handlePost() }}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.postButtonText}>Post</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Text Input */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="What's happening in your node?"
            placeholderTextColor="#9CA3AF"
            multiline
            autoFocus
            value={postText}
            onChangeText={setPostText}
          />
        </View>

        {/* Orbit UI (Trust Circles) */}
        <View style={styles.orbitSection}>
          <Text style={styles.orbitTitle}>Trust Circle Audience</Text>
          <Text style={styles.orbitSubtitle}>Tap a ring to set your boundary</Text>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setAudience('trust-circle')}
            style={[styles.trustCircleModeButton, audience === 'trust-circle' && styles.trustCircleModeButtonActive]}
          >
            <Ionicons name="people" size={14} color={audience === 'trust-circle' ? '#FFFFFF' : '#6B7280'} />
            <Text
              style={[
                styles.trustCircleModeButtonText,
                audience === 'trust-circle' && styles.trustCircleModeButtonTextActive,
              ]}
            >
              Trust Circle Members
            </Text>
          </TouchableOpacity>

          <View style={styles.orbitContainer}>
            {/* Ring 3: Local Grid (outer) */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setAudience('local')}
              style={[
                styles.ring,
                styles.ringLocal,
                audience === 'local' && styles.ringActiveLocal,
              ]}
            >
              <Text style={[styles.ringText, audience === 'local' && styles.ringTextActiveLocal]}>
                LOCAL GRID
              </Text>
            </TouchableOpacity>

            {/* Ring 2: Verified (middle) */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => setAudience('verified')}
              style={[
                styles.ring,
                styles.ringVerified,
                audience === 'verified' && styles.ringActiveVerified,
              ]}
            >
              <View style={styles.ringLabelBadge}>
                <Ionicons
                  name="shield-checkmark"
                  size={12}
                  color={audience === 'verified' ? '#2563EB' : '#9CA3AF'}
                />
                <Text style={[styles.ringText, audience === 'verified' && styles.ringTextActiveVerified]}>
                  {' '}VERIFIED
                </Text>
              </View>
            </TouchableOpacity>

            {/* Ring 1: FOAF / Close Ties (inner) */}
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setAudience('foaf')}
              style={[
                styles.ring,
                styles.ringFoaf,
                audience === 'foaf' && styles.ringActiveFoaf,
              ]}
            >
              <Text style={[styles.ringText, audience === 'foaf' && styles.ringTextActiveFoaf]}>
                CLOSE TIES
              </Text>
            </TouchableOpacity>

            {/* Center: User node */}
            <View style={styles.centerNode}>
              <Ionicons name="person" size={24} color="#FFF" />
            </View>
          </View>

          {/* Dynamic Audience Label */}
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>
              Broadcasting to: {getAudienceDescription(audience)}
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: aesthetic.color.bgNight },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderColor: aesthetic.color.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: aesthetic.color.textHigh },
  postButton: {
    backgroundColor: aesthetic.color.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  postButtonDisabled: { backgroundColor: '#9CA3AF' },
  postButtonText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
  inputContainer: { padding: 20, flex: 1 },
  textInput: {
    fontSize: 20,
    color: aesthetic.color.textHigh,
    textAlignVertical: 'top',
    flex: 1,
  },
  orbitSection: {
    backgroundColor: aesthetic.color.surface,
    borderTopWidth: 1,
    borderColor: aesthetic.color.border,
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  orbitTitle: { fontSize: 16, fontWeight: '600', color: aesthetic.color.textHigh },
  orbitSubtitle: { fontSize: 13, color: aesthetic.color.textMid, marginBottom: 30 },
  trustCircleModeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: aesthetic.color.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
    backgroundColor: '#F9FAFB',
  },
  trustCircleModeButtonActive: {
    borderColor: '#0F766E',
    backgroundColor: '#0F766E',
  },
  trustCircleModeButtonText: {
    color: '#6B7280',
    fontWeight: '600',
    fontSize: 12,
  },
  trustCircleModeButtonTextActive: {
    color: '#FFFFFF',
  },
  orbitContainer: {
    width: 280,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  ring: {
    position: 'absolute',
    alignItems: 'center',
    paddingTop: 10,
    borderWidth: 2,
  },
  ringText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: aesthetic.color.textMid },
  ringLabelBadge: { flexDirection: 'row', alignItems: 'center' },

  // Local Grid Ring (outer)
  ringLocal: {
    width: 280,
    height: 280,
    borderRadius: 140,
    borderStyle: 'dashed',
    borderColor: aesthetic.color.border,
    zIndex: 1,
  },
  ringActiveLocal: {
    borderStyle: 'solid',
    borderColor: '#34D399',
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
    borderWidth: 3,
  },
  ringTextActiveLocal: { color: '#059669' },

  // Verified Ring (middle)
  ringVerified: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderStyle: 'dashed',
    borderColor: '#4E7DB4',
    zIndex: 2,
  },
  ringActiveVerified: {
    borderStyle: 'solid',
    borderColor: '#3B82F6',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 3,
  },
  ringTextActiveVerified: { color: '#2563EB' },

  // FOAF Ring (inner)
  ringFoaf: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderStyle: 'dashed',
    borderColor: '#3F5E86',
    zIndex: 3,
  },
  ringActiveFoaf: {
    borderStyle: 'solid',
    borderColor: '#8B5CF6',
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 3,
  },
  ringTextActiveFoaf: { color: '#7C3AED' },

  centerNode: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: aesthetic.color.accent,
    borderWidth: 4,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  statusBadge: {
    backgroundColor: '#1D3E67',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  statusBadgeText: { color: aesthetic.color.textHigh, fontWeight: '600', fontSize: 13 },
});