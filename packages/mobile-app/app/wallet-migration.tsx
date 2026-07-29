import React from 'react'
import { Platform, Text, View } from 'react-native'
import { useWallet } from '../src/contexts/WalletContext'
import {
  LEGACY_MIGRATION_COMPLETE,
  LEGACY_MIGRATION_PROTOCOL,
} from '../src/wallet/legacyMigrationProtocol'

const ALLOWED_PARENT_ORIGINS = new Set([
  'https://nodezero.social',
  'https://www.nodezero.social',
])

export default function WalletMigrationScreen(): JSX.Element {
  const { migrateLegacyIdentities } = useWallet()

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return
    const parentOrigin = document.referrer ? new URL(document.referrer).origin : ''
    if (!ALLOWED_PARENT_ORIGINS.has(parentOrigin) || window.parent === window) return

    void (async (): Promise<void> => {
      try {
        await migrateLegacyIdentities()
        window.parent.postMessage(
          { protocol: LEGACY_MIGRATION_PROTOCOL, type: LEGACY_MIGRATION_COMPLETE, ok: true },
          parentOrigin,
        )
      } catch (error) {
        window.parent.postMessage(
          {
            protocol: LEGACY_MIGRATION_PROTOCOL,
            type: LEGACY_MIGRATION_COMPLETE,
            ok: false,
            error: error instanceof Error ? error.message : 'Legacy wallet migration failed.',
          },
          parentOrigin,
        )
      }
    })()
  }, [migrateLegacyIdentities])

  return (
    <View accessible={false}>
      <Text>Wallet migration ready.</Text>
    </View>
  )
}
