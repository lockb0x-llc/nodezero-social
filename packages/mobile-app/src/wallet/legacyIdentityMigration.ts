import { Keypair } from '@stellar/stellar-sdk'
import type { WalletIdentitySummary } from '../contexts/WalletContext'

const PREFIX = 'nodezero.embedded-wallet.'
const LEGACY_SINGLE_SECRET_KEYS = [
  `${PREFIX}nodezero.stellar.secret`,
  'nodezero.stellar.secret',
]
const KEYRING_INDEX_KEY = `${PREFIX}nodezero.stellar.keyring.index.v1`
const ACTIVE_KEY_ID_KEY = `${PREFIX}nodezero.stellar.active-key-id.v1`
const META_PREFIX = `${PREFIX}nodezero.stellar.identity.meta.`
const SECRET_PREFIX = `${PREFIX}nodezero.stellar.secret.`

export interface LegacyIdentityCandidate {
  sourceKeyId: string | null
  label: string
  secret: string
  stellarPublicKey: string
  storageKeys: string[]
}

interface BrowserStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function readLegacyIdentityCandidates(storage: BrowserStorage): LegacyIdentityCandidate[] {
  const candidates: LegacyIdentityCandidate[] = []
  const seenPublicKeys = new Set<string>()
  const addCandidate = (
    sourceKeyId: string | null,
    label: string,
    secret: string | null,
    storageKeys: string[],
  ): void => {
    if (!secret) return
    try {
      const stellarPublicKey = Keypair.fromSecret(secret).publicKey()
      if (seenPublicKeys.has(stellarPublicKey)) return
      seenPublicKeys.add(stellarPublicKey)
      candidates.push({ sourceKeyId, label, secret, stellarPublicKey, storageKeys })
    } catch {
      // Ignore malformed legacy values; they cannot authenticate an account.
    }
  }

  const rawIndex = storage.getItem(KEYRING_INDEX_KEY)
  if (rawIndex) {
    try {
      const parsed = JSON.parse(rawIndex) as { keyIds?: unknown }
      if (Array.isArray(parsed.keyIds)) {
        for (const rawKeyId of parsed.keyIds) {
          if (typeof rawKeyId !== 'string' || !rawKeyId) continue
          const metaKey = `${META_PREFIX}${rawKeyId}`
          const secretKey = `${SECRET_PREFIX}${rawKeyId}`
          let label = 'Recovered device identity'
          try {
            const meta = JSON.parse(storage.getItem(metaKey) ?? '{}') as { label?: unknown }
            if (typeof meta.label === 'string' && meta.label.trim()) label = meta.label.trim()
          } catch {
            // Use recovery label when metadata is malformed.
          }
          addCandidate(rawKeyId, label, storage.getItem(secretKey), [secretKey, metaKey])
        }
      }
    } catch {
      // Ignore malformed legacy index and still inspect the single-slot key.
    }
  }

  for (const key of LEGACY_SINGLE_SECRET_KEYS) {
    addCandidate(null, 'Recovered legacy identity', storage.getItem(key), [key])
  }
  return candidates
}

export function legacyIdentitiesMissingFromBroker(
  candidates: LegacyIdentityCandidate[],
  brokerIdentities: WalletIdentitySummary[],
): LegacyIdentityCandidate[] {
  const brokerKeys = new Set(
    brokerIdentities
      .map((identity) => identity.stellarPublicKey)
      .filter((key): key is string => Boolean(key)),
  )
  return candidates.filter((candidate) => !brokerKeys.has(candidate.stellarPublicKey))
}

export function removeMigratedLegacyIdentity(
  storage: BrowserStorage,
  candidate: LegacyIdentityCandidate,
): void {
  for (const key of candidate.storageKeys) storage.removeItem(key)
  if (!candidate.sourceKeyId) return

  const rawIndex = storage.getItem(KEYRING_INDEX_KEY)
  if (rawIndex) {
    try {
      const parsed = JSON.parse(rawIndex) as { keyIds?: unknown }
      if (Array.isArray(parsed.keyIds)) {
        const keyIds = parsed.keyIds.filter((keyId) => keyId !== candidate.sourceKeyId)
        if (keyIds.length === 0) {
          storage.removeItem(KEYRING_INDEX_KEY)
          storage.removeItem(ACTIVE_KEY_ID_KEY)
        } else {
          storage.setItem(KEYRING_INDEX_KEY, JSON.stringify({ version: 1, keyIds }))
          if (storage.getItem(ACTIVE_KEY_ID_KEY) === candidate.sourceKeyId) {
            storage.setItem(ACTIVE_KEY_ID_KEY, String(keyIds[0]))
          }
        }
      }
    } catch {
      // Leave malformed index untouched; migrated secret/meta were still removed.
    }
  }
}
