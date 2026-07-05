import Constants from 'expo-constants'
import {
  createSolidPodSyncManagers,
  type SolidPodSyncManagers,
} from '@nodezero/solid-pod-sync'

type SessionLike = {
  fetch: typeof globalThis.fetch
}

function isSolidBootstrapEnabled(): boolean {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const raw = (appExtra?.solidBootstrapEnabled ?? 'false').toLowerCase().trim()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

export function getSolidPodSyncManagers(session: SessionLike): SolidPodSyncManagers {
  return createSolidPodSyncManagers(session, {
    enablePodBootstrap: isSolidBootstrapEnabled(),
  })
}
