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
import { useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { getProvisionerUrl } from '../src/contexts/NodeZeroSessionContext'
import { useWallet } from '../src/contexts/WalletContext'
import {
  assertUsablePassphrase,
  MIN_RECOVERY_PASSPHRASE_LENGTH,
} from '../src/wallet/recoveryBundleCrypto'
import { useHardwareProtection } from '../src/wallet/useHardwareProtection'
import { PodArchiveExporter, PodArchiveRestorer } from '@nodezero/solid-pod-sync'
import { buildPodArchiveZip } from '../src/podArchive/zipWriter'
import { deliverFile, deliverPodArchive } from '../src/podArchive/delivery'
import { readPodArchiveZip } from '../src/podArchive/zipReader'
import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { aesthetic } from '../src/theme/aesthetic'
import { readContentPreferences, writeContentPreferences } from '../src/preferences/contentPreferences'

const recoveryExportWarning =
  'This bundle contains your private wallet key, encrypted with a password you choose. Anyone with both the file and the password controls your node. The password is never stored and cannot be recovered.'
const podExportWarning =
  'This exports data from your Solid Pod without wallet keys. Resources that cannot be read will be listed in the archive manifest.'

interface SelectedArchive {
  uri: string
  cleanup?: () => void
}

function pickWebArchive(): Promise<SelectedArchive | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/zip,.zip'
    input.onchange = (): void => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const uri = URL.createObjectURL(file)
      resolve({ uri, cleanup: (): void => URL.revokeObjectURL(uri) })
    }
    input.click()
  })
}

function fromBase64(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function confirmPodRestore(message: string): Promise<boolean> {
  if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
    return Promise.resolve(globalThis.confirm(message))
  }
  return new Promise((resolve) => {
    Alert.alert('Restore Solid Pod Data', message, [
      { text: 'Cancel', style: 'cancel', onPress: (): void => resolve(false) },
      { text: 'Restore', onPress: (): void => resolve(true) },
    ])
  })
}

export default function SettingsScreen(): JSX.Element {
  const { signOut, webId, podUrl, authFetch, lockbox, sessionCreatedAt } = useNodeZeroSession()
  const router = useRouter()
  const {
    walletInfo,
    identities,
    activeIdentityKeyId,
    isIdentityBusy,
    selectIdentity,
    createIdentity,
    attestationStatus,
    attestationMessage,
    attestationDetails,
    exportRecoveryBundle,
    deleteNodeData,
  } = useWallet()
  const [showNsfw, setShowNsfw] = useState(false)
  const [showAuthModeHint, setShowAuthModeHint] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [dataActionStatus, setDataActionStatus] = useState<string | null>(null)

  const activeIdentity =
    identities.find((identity) => identity.keyId === activeIdentityKeyId) ??
    identities[0] ??
    null

  const hardware = useHardwareProtection()
  const identityKeyIds = identities.map((identity) => identity.keyId)

  // Load persisted NSFW setting on mount.
  React.useEffect(() => {
    void readContentPreferences().then((preferences) => {
      setShowNsfw(preferences.showNsfw)
    })
  }, [])

  const toggleNsfw = useCallback(async (val: boolean) => {
    setShowNsfw(val)
    await writeContentPreferences({ showNsfw: val })
  }, [])

  const performClearCache = useCallback(async (): Promise<void> => {
    try {
      await AsyncStorage.clear()
      setDataActionStatus('Local cache cleared.')
      if (Platform.OS === 'web' && typeof globalThis.alert === 'function') {
        globalThis.alert('Local cache cleared.')
      } else {
        Alert.alert('Done', 'Local cache cleared.')
      }
    } catch (err) {
      setDataActionStatus(
        err instanceof Error ? `Clear cache failed: ${err.message}` : 'Clear cache failed.'
      )
    }
  }, [])

  const clearCache = useCallback((): void => {
    const message =
      'This will delete all locally cached data. Your Solid Pod data will not be affected.'
    if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
      if (globalThis.confirm(`Clear Local Cache\n\n${message}`)) {
        void performClearCache()
      }
      return
    }
    Alert.alert('Clear Local Cache', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: (): void => {
          void performClearCache()
        },
      },
    ])
  }, [performClearCache])

  const handleSignOut = useCallback(async (): Promise<void> => {
    await signOut()
    router.replace('/')
  }, [router, signOut])

  const performRecoveryExport = useCallback((passphrase: string): void => {
    setIsExporting(true)
    setDataActionStatus(null)
    void exportRecoveryBundle(passphrase)
      .then(async ({ fileName, json }) => {
        const outcome = await deliverFile(fileName, new TextEncoder().encode(json), 'application/json')
        setDataActionStatus(`Identity recovery bundle ${outcome}.`)
      })
      .catch((err: unknown) => {
        setDataActionStatus(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.')
      })
      .finally(() => setIsExporting(false))
  }, [exportRecoveryBundle])

  const exportData = useCallback(() => {
    if (Platform.OS !== 'web' || typeof globalThis.prompt !== 'function') {
      setDataActionStatus(
        'Export failed: password-protected recovery export is available in the NodeZero PWA.'
      )
      return
    }
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(recoveryExportWarning)) return

    const passphrase = globalThis.prompt(
      `Choose a password for this recovery bundle (minimum ${MIN_RECOVERY_PASSPHRASE_LENGTH} characters).\n\n` +
        'This password is never stored and cannot be recovered. Without it the bundle is unusable.'
    )
    if (passphrase === null) return

    const confirmation = globalThis.prompt('Re-enter the recovery password to confirm.')
    if (confirmation === null) return
    if (confirmation !== passphrase) {
      setDataActionStatus('Export failed: the passwords did not match.')
      return
    }
    try {
      assertUsablePassphrase(passphrase)
    } catch (err) {
      setDataActionStatus(err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.')
      return
    }
    performRecoveryExport(passphrase)
  }, [performRecoveryExport])

  const exportPodData = useCallback((): void => {
    if (!podUrl) {
      setDataActionStatus('Export failed: no authenticated Pod is available.')
      return
    }
    if (Platform.OS === 'web' && typeof globalThis.confirm === 'function' && !globalThis.confirm(podExportWarning)) return
    setIsExporting(true)
    setDataActionStatus('Reading Solid Pod...')
    void new PodArchiveExporter(
      { fetch: authFetch },
      { onProgress: ({ completed, discovered }): void => setDataActionStatus(`Reading Solid Pod... ${completed}/${discovered}`) },
    )
      .export(podUrl)
      .then(async (result) => {
        const bytes = buildPodArchiveZip(result)
        const outcome = await deliverPodArchive(
          `nodezero-pod-${new Date().toISOString().slice(0, 10)}.zip`,
          bytes,
        )
        const warningSuffix = result.manifest.warnings.length > 0
          ? ` ${result.manifest.warnings.length} resource warning(s) are recorded in the manifest.`
          : ''
        setDataActionStatus(`Solid Pod archive ${outcome}.${warningSuffix}`)
      })
      .catch((err: unknown) => {
        setDataActionStatus(err instanceof Error ? `Pod export failed: ${err.message}` : 'Pod export failed.')
      })
      .finally(() => setIsExporting(false))
  }, [authFetch, podUrl])

  const restorePodData = useCallback((): void => {
    if (!podUrl) {
      setDataActionStatus('Restore preview failed: no authenticated Pod is available.')
      return
    }
    const restoreSelectedArchive = async (): Promise<void> => {
      const selection = Platform.OS === 'web'
        ? await pickWebArchive()
        : await DocumentPicker.getDocumentAsync({ type: 'application/zip', copyToCacheDirectory: true })
      if (!selection || ('canceled' in selection && selection.canceled)) return
      const selectedArchive: SelectedArchive = 'uri' in selection
        ? selection
        : { uri: selection.assets?.[0]?.uri ?? '' }
      if (!selectedArchive.uri) return
      setIsExporting(true)
      setDataActionStatus('Validating Pod archive...')
      const bytes = Platform.OS === 'web'
        ? fetch(selectedArchive.uri).then((response) => response.arrayBuffer()).then((buffer) => new Uint8Array(buffer))
        : FileSystem.readAsStringAsync(selectedArchive.uri, { encoding: FileSystem.EncodingType.Base64 }).then(fromBase64)
      void bytes
        .then(readPodArchiveZip)
        .then(async ({ manifest, entries }) => {
          const restorer = new PodArchiveRestorer({ fetch: authFetch })
          const report = await restorer.dryRun(podUrl, manifest, entries)
          const planned = report.items.filter((item) => item.status === 'planned').length
          const conflicts = report.items.filter((item) => item.action === 'conflict' || item.action === 'failed').length
          const confirmed = await confirmPodRestore(
            `Restore preview: ${planned} item(s) planned, ${conflicts} conflict(s). Existing resources will not be overwritten. ACL and ACP resources will be skipped. Continue?`,
          )
          if (!confirmed || planned === 0) {
            setDataActionStatus(confirmed ? 'Restore cancelled: no resources are eligible.' : 'Restore cancelled. No changes were made.')
            return
          }
          setDataActionStatus('Restoring Solid Pod data...')
          const restored = await new PodArchiveRestorer({ fetch: authFetch }, { dryRun: false }).restore(podUrl, manifest, entries)
          const applied = restored.items.filter((item) => item.status === 'applied').length
          const failed = restored.items.filter((item) => item.status === 'failed').length
          setDataActionStatus(`Solid Pod restore complete: ${applied} applied, ${failed} failed. Control resources remain skipped.`)
        })
        .catch((err: unknown) => {
          setDataActionStatus(err instanceof Error ? `Restore preview failed: ${err.message}` : 'Restore preview failed.')
        })
        .finally(() => setIsExporting(false))
        .finally(() => selectedArchive.cleanup?.())
    }
    void restoreSelectedArchive()
  }, [authFetch, podUrl])

  const performDeleteData = useCallback((): void => {
    setIsDeleting(true)
    setDataActionStatus(null)
    void (async (): Promise<void> => {
      let podDeleteWarning = ''
      try {
        const provisionerUrl = getProvisionerUrl()
        if (provisionerUrl) {
          const response = await authFetch(`${provisionerUrl}/v1/account/delete`, { method: 'POST' })
          if (!response.ok) {
            podDeleteWarning = ' Solid Pod deletion could not be confirmed; contact support if this persists.'
          }
        }
      } catch {
        podDeleteWarning = ' Solid Pod deletion could not be confirmed; contact support if this persists.'
      }
      const { unlinkedIdentity, walletDestroyed, localStateCleared, warnings } =
        await deleteNodeData({ unlinkIdentity: true, clearAllLocalCache: true })
      const status =
        walletDestroyed && localStateCleared
          ? (unlinkedIdentity ? 'Node deleted and identity unlinked.' : 'Node deleted (local unlink only).')
          : 'Node delete completed with partial cleanup.'
      const warningSuffix = warnings.length > 0 ? ` Warning: ${warnings.join(' ')}` : ''
      setDataActionStatus(`${status}${warningSuffix}${podDeleteWarning}`)
      await signOut()
      router.replace('/')
    })()
      .catch((err: unknown) => {
        setDataActionStatus(err instanceof Error ? `Delete failed: ${err.message}` : 'Delete failed.')
      })
      .finally(() => setIsDeleting(false))
  }, [authFetch, deleteNodeData, router, signOut])

  const deleteData = useCallback(() => {
    const message =
      'This unlinks your identity on-chain, deletes your Solid Pod entry and Directory listing, destroys your local wallet key, and clears local node state. A new wallet and lockb0x are provisioned on next sign-in. This cannot be undone.'
    if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
      if (globalThis.confirm(`Delete Node Data\n\n${message}`)) {
        performDeleteData()
      }
      return
    }
    Alert.alert('Delete Node Data', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: performDeleteData,
      },
    ])
  }, [performDeleteData])

  const createIdentityFromSettings = useCallback((): void => {
    setDataActionStatus(null)
    const proceed = (): void => {
      void (async (): Promise<void> => {
        try {
          await createIdentity()
          if (webId) {
            setDataActionStatus(
              'New identity created. Signing out so you can onboard or sign in with your new identity…'
            )
            await signOut()
            router.replace('/')
          } else {
            setDataActionStatus('New identity created and selected.')
          }
        } catch (err) {
          setDataActionStatus(
            err instanceof Error ? `Identity create failed: ${err.message}` : 'Identity create failed.'
          )
        }
      })()
    }

    if (webId) {
      const message =
        'Creating and activating a new device identity will sign you out of your current node so you can create or sign in with the new identity.'
      if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
        if (globalThis.confirm(`Create New Identity\n\n${message}`)) {
          proceed()
        }
        return
      }
      Alert.alert('Create New Identity', message, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Create & Sign Out', onPress: proceed },
      ])
      return
    }

    proceed()
  }, [createIdentity, router, signOut, webId])

  const switchIdentityFromSettings = useCallback(
    (keyId: string): void => {
      setDataActionStatus(null)
      const proceed = (): void => {
        void (async (): Promise<void> => {
          try {
            await selectIdentity(keyId)
            if (webId) {
              setDataActionStatus(
                'Identity switched. Signing out so you can sign in to your selected identity…'
              )
              await signOut()
              router.replace('/')
            } else {
              setDataActionStatus('Identity switched.')
            }
          } catch (err) {
            setDataActionStatus(
              err instanceof Error ? `Identity switch failed: ${err.message}` : 'Identity switch failed.'
            )
          }
        })()
      }

      if (webId) {
        const message =
          'Switching your active device identity will sign you out of your current node so you can sign in with the selected identity.'
        if (Platform.OS === 'web' && typeof globalThis.confirm === 'function') {
          if (globalThis.confirm(`Switch Identity\n\n${message}`)) {
            proceed()
          }
          return
        }
        Alert.alert('Switch Identity', message, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch & Sign Out', onPress: proceed },
        ])
        return
      }

      proceed()
    },
    [router, selectIdentity, signOut, webId]
  )

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* ── Your Node ────────────────────────────────── */}
      {webId ? (
        <>
          <Text style={styles.sectionHeader}>Your Node</Text>
          <View style={styles.card}>
            <Row label="WebID" value={webId} mono />
            <Row label="Pod URL" value={podUrl ?? 'Unknown'} mono />
            <Row
              label="Stellar Key"
              value={walletInfo?.publicKey ?? 'Not linked'}
              mono
            />
            <Row
              label="Lockb0x (on-chain)"
              value={lockbox?.userLockboxContractId ?? 'Not anchored'}
              mono
            />
            <Row
              label="Lockb0x Factory"
              value={lockbox?.factoryContractId ?? 'Not configured'}
              mono
            />
            <Row
              label="Pairing Root"
              value={lockbox?.proofRootHex ?? 'Not generated'}
              mono
            />
            <Row label="Created" value={sessionCreatedAt ?? 'Unknown'} />
          </View>
        </>
      ) : null}
      {/* ── Solid Pod ─────────────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Solid Pod</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Auth Mode</Text>
          <View style={styles.authModeWrap}>
            <View style={styles.authModeBadge}>
              <Text style={styles.authModeBadgeText}>NodeZero Session</Text>
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
            {'Your device Stellar key signs you in. Pod access flows through the NodeZero Pod proxy — no passwords, no redirects.'}
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
        <Row
          label="Lockb0x Factory"
          value={attestationDetails.lockboxFactoryContractId ?? 'Not configured'}
          mono
        />
        <Row
          label="User Lockb0x"
          value={attestationDetails.userLockboxContractId ?? 'Not provisioned'}
          mono
        />
        <Row
          label="Lockb0x Idempotency"
          value={attestationDetails.lockboxIdempotencyKey ?? 'Not generated'}
          mono
        />
      </View>

      {/* ── Device Identities ─────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Device Identities</Text>
      <View style={styles.card}>
        <Row label="Active Identity" value={activeIdentity?.label ?? 'Provisioning…'} />
        <Row label="Identity Key" value={activeIdentity?.keyId ?? 'Unavailable'} mono />
        <Row label="Stored Identities" value={String(identities.length)} />
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => void createIdentityFromSettings()}
          disabled={isIdentityBusy}
          accessibilityRole="button"
          accessibilityLabel="Create new identity"
        >
          <Text style={styles.actionButtonText}>{isIdentityBusy ? 'Working…' : 'Create New Identity'}</Text>
        </TouchableOpacity>
        {identities.map((identity, index) => {
          const active = identity.keyId === activeIdentityKeyId
          return (
            <TouchableOpacity
              key={identity.keyId}
              style={[
                styles.identityOption,
                index === identities.length - 1 && styles.identityOptionLast,
                active && styles.identityOptionActive,
              ]}
              onPress={() => void switchIdentityFromSettings(identity.keyId)}
              disabled={isIdentityBusy || active}
              accessibilityRole="button"
              accessibilityLabel={`Switch to ${identity.label}`}
            >
              <Text style={styles.identityOptionLabel}>{identity.label}</Text>
              <Text style={styles.identityOptionMeta}>{active ? 'Active' : 'Switch'}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* ── Device Security ──────────────────────────────────────── */}
      {hardware.available || hardware.enabled ? (
        <>
          <Text style={styles.sectionHeader}>Device Security</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                void (hardware.enabled ? hardware.unlock() : hardware.enable(identityKeyIds))
              }}
              disabled={hardware.busy}
              accessibilityRole="button"
              accessibilityLabel={
                hardware.enabled ? 'Unlock wallet with passkey' : 'Protect wallet with a passkey'
              }
            >
              <Text style={styles.actionButtonText}>
                {hardware.busy
                  ? 'Working…'
                  : hardware.enabled
                    ? hardware.unlocked
                      ? 'Wallet unlocked with passkey'
                      : 'Unlock Wallet with Passkey'
                    : 'Protect Wallet with a Passkey'}
              </Text>
            </TouchableOpacity>
            {hardware.enabled ? (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => void hardware.disable()}
                disabled={hardware.busy}
                accessibilityRole="button"
                accessibilityLabel="Stop using a passkey on this device"
              >
                <Text style={styles.actionButtonText}>Stop Using a Passkey on This Device</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.hardwareHint}>
              {hardware.status ??
                'Requires a fingerprint, face, or PIN check before your wallet key can be read on this device. Your key never leaves the device either way.'}
            </Text>
          </View>
        </>
      ) : null}

      {/* ── Data Management ──────────────────────────────────────── */}
      <Text style={styles.sectionHeader}>Data Management</Text>
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={exportData}
          disabled={isExporting}
          accessibilityRole="button"
          accessibilityLabel="Export identity recovery bundle"
        >
          <Text style={styles.actionButtonText}>{isExporting ? 'Exporting...' : 'Export Identity Recovery Bundle'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={exportPodData}
          disabled={isExporting}
          accessibilityRole="button"
          accessibilityLabel="Export Solid Pod data"
        >
          <Text style={styles.actionButtonText}>{isExporting ? 'Exporting...' : 'Export Solid Pod Data'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={restorePodData}
          disabled={isExporting}
          accessibilityRole="button"
          accessibilityLabel="Restore Solid Pod data"
        >
          <Text style={styles.actionButtonText}>{isExporting ? 'Working...' : 'Restore Solid Pod Data'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.dangerButton}
          onPress={deleteData}
          disabled={isDeleting}
          accessibilityRole="button"
          accessibilityLabel="Delete node data"
        >
          <Text style={styles.dangerButtonText}>{isDeleting ? 'Deleting…' : '🗑  Delete Node Data'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={clearCache}
          accessibilityRole="button"
          accessibilityLabel="Clear local cache"
        >
          <Text style={styles.actionButtonText}>Clear Local Cache</Text>
        </TouchableOpacity>
        {dataActionStatus ? <Text style={styles.rowSubDetail}>{dataActionStatus}</Text> : null}
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

      <Text style={styles.version}>NodeZero.social v0.2.0-testnet</Text>
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
  dangerButton: { padding: 14, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  dangerButtonText: { color: aesthetic.color.danger, fontSize: 14, fontWeight: '600' },
  actionButton: { padding: 14, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: aesthetic.color.border },
  actionButtonText: { color: aesthetic.color.textHigh, fontSize: 14, fontWeight: '600' },
  hardwareHint: { color: aesthetic.color.textLow, fontSize: 12, lineHeight: 18, padding: 14 },
  identityOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: aesthetic.color.border,
  },
  identityOptionLast: { borderBottomWidth: 0 },
  identityOptionActive: { backgroundColor: aesthetic.color.bgInk },
  identityOptionLabel: { color: aesthetic.color.textHigh, fontSize: 13, fontWeight: '600' },
  identityOptionMeta: { color: aesthetic.color.textMid, fontSize: 12 },
  signOutButton: { padding: 14, alignItems: 'center' },
  signOutButtonText: { color: aesthetic.color.danger, fontSize: 15, fontWeight: '700' },
  version: { color: aesthetic.color.textLow, fontSize: 12, textAlign: 'center', marginTop: 32 },
})
