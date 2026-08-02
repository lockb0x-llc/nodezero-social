import type { DiscoveryConsent } from '@nodezero/solid-pod-sync'

type DiscoveryConsentListener = (consent: DiscoveryConsent) => void

const listeners = new Set<DiscoveryConsentListener>()

export function publishDiscoveryConsentChanged(consent: DiscoveryConsent): void {
  for (const listener of listeners) listener(consent)
}

export function subscribeDiscoveryConsentChanged(listener: DiscoveryConsentListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
