/**
 * @module nodeSession
 *
 * Persists the locally-known "node session" produced by the seamless
 * onboarding flow (see {@link module:seamlessSignup}). After a node is created,
 * the provisioner has already written the account profile into the user's Pod
 * and anchored the WebID<->Stellar pairing on-chain, so the client only needs
 * to remember a small, NON-SECRET record to (a) treat the user as signed in and
 * (b) display their account details in Settings.
 *
 * Security note: this record deliberately contains NO client secret or private
 * key. The Stellar secret stays in the embedded wallet's secure store; the CSS
 * client-credential secret never leaves the provisioner.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'

const NODE_SESSION_STORAGE_KEY = 'node.session.v1'

export interface NodeSessionRecord {
  webId: string
  podUrl: string
  stellarPublicKey: string | null
  userLockboxContractId: string | null
  lockboxFactoryContractId: string | null
  proofRootHex: string | null
  accountDocumentUrl: string | null
  createdAt: string
}

function isNodeSessionRecord(value: unknown): value is NodeSessionRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.webId === 'string' && typeof record.podUrl === 'string'
}

/** Persists the node session record. */
export async function saveNodeSession(record: NodeSessionRecord): Promise<void> {
  await AsyncStorage.setItem(NODE_SESSION_STORAGE_KEY, JSON.stringify(record))
}

/** Loads the persisted node session record, or `null` when none exists. */
export async function loadNodeSession(): Promise<NodeSessionRecord | null> {
  const raw = await AsyncStorage.getItem(NODE_SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return isNodeSessionRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Clears the persisted node session record (used on sign out / delete). */
export async function clearNodeSession(): Promise<void> {
  await AsyncStorage.removeItem(NODE_SESSION_STORAGE_KEY)
}
