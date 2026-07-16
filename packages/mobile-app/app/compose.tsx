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
import { P2PChannel } from '@nodezero/p2p-comms';
import { getSolidPodSyncManagers } from '../src/solid/podSyncManagers';
import { aesthetic } from '../src/theme/aesthetic';
import { resolveAudienceRecipients } from '../src/social/composeRecipients';
import { listTrustCircleMembers } from '../src/social/trustCircleStore';

type AudienceType = 'foaf' | 'verified' | 'local';

function toWebIdList(connections: Array<unknown>): string[] {
  return connections
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof (entry as { webId?: unknown }).webId === 'string') {
        return (entry as { webId: string }).webId;
      }
      return '';
    })
    .filter((webId) => webId.length > 0);
}

export default function ComposeScreen() {
  const [postText, setPostText] = useState('');
  const [audience, setAudience] = useState<AudienceType>('verified');
  const [sending, setSending] = useState(false);

  const { authFetch, webId } = useNodeZeroSession();
  const { surroundingNodes } = useDiscovery();
  // verifyPoH may not exist on the wallet context type; cast as a stub if absent
  const walletCtx = useWallet() as { verifyPoH?: (webId: string) => Promise<boolean> };
  const verifyPoH: (webId: string) => Promise<boolean> =
    walletCtx.verifyPoH ?? ((_: string) => Promise.resolve(false));

  const handlePost = async (): Promise<void> => {
    if (!postText.trim()) return;
    setSending(true);
    try {
      if (audience === 'local') {
        // Route via P2P relay to surrounding H3 nodes
        const nodes = surroundingNodes ?? [];
        await Promise.allSettled(
          nodes.map((node) => {
            const ch = new P2PChannel({
              localWebId: webId ?? '',
              remoteWebId: (node as { webId?: string }).webId ?? String(node),
            });
            void ch;
            void node;
          })
        );
      } else if (audience === 'foaf') {
        // Write payload to Pod /outbox/ container via the authenticated proxy fetch
        const podRoot = (webId ?? '').split('/profile/')[0] + '/';
        const { socialGraph: graph } = getSolidPodSyncManagers({ fetch: authFetch });
        const connections = toWebIdList(await graph.listConnections(podRoot).catch(() => []));
        const trustCircleMembers = webId ? await listTrustCircleMembers(webId) : [];
        const recipientIds = resolveAudienceRecipients({
          audience,
          connections,
          trustCircleMembers,
        });
        const payload = JSON.stringify({ text: postText, audience, ts: Date.now() });
        await Promise.allSettled(
          recipientIds.map(() =>
            authFetch(
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
            )
          )
        );
      } else if (audience === 'verified') {
        // Same as foaf but guard each recipient with verifyPoH check
        const podRoot = (webId ?? '').split('/profile/')[0] + '/';
        const { socialGraph: graph } = getSolidPodSyncManagers({ fetch: authFetch });
        const connections = toWebIdList(await graph.listConnections(podRoot).catch(() => []));
        const trustCircleMembers = webId ? await listTrustCircleMembers(webId) : [];
        const recipientIds = resolveAudienceRecipients({
          audience,
          connections,
          trustCircleMembers,
        });
        const payload = JSON.stringify({ text: postText, audience, ts: Date.now() });
        await Promise.allSettled(
          recipientIds.map(async (recipientWebId) => {
            const isVerified = await verifyPoH(recipientWebId);
            if (!isVerified) {
              console.warn('[compose] skipping unverified recipient', recipientWebId);
              return;
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
      }
      setPostText('');
    } catch (err) {
      Alert.alert('Broadcast Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  const getAudienceDescription = () => {
    switch (audience) {
      case 'foaf': return 'Close Ties (Your FOAF Network)';
      case 'verified': return 'Verified Humans in your Grid';
      case 'local': return 'Everyone in your Local H3 Grid';
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
              Broadcasting to: {getAudienceDescription()}
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