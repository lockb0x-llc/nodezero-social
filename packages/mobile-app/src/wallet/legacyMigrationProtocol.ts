export const LEGACY_MIGRATION_PROTOCOL = 'nz-legacy-wallet-migration-v1'
export const LEGACY_MIGRATION_COMPLETE = 'complete'

export interface LegacyMigrationCompleteMessage {
  protocol: typeof LEGACY_MIGRATION_PROTOCOL
  type: typeof LEGACY_MIGRATION_COMPLETE
  ok: boolean
  error?: string
}
