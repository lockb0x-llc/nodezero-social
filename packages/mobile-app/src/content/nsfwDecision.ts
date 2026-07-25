import { NsfwScanner } from '@nodezero/solid-pod-sync'

export interface NsfwUrlSource {
  externalUrl?: string
  avatarUrl?: string
}

const scanner = new NsfwScanner()

export function collectNsfwScanUrls(source: NsfwUrlSource): string[] {
  const urls: string[] = []
  if (source.externalUrl) urls.push(source.externalUrl)
  if (source.avatarUrl) urls.push(source.avatarUrl)
  return urls
}

export function hasNsfwSignals(source: NsfwUrlSource): boolean {
  const urls = collectNsfwScanUrls(source)
  if (urls.length === 0) return false
  return scanner.scan(urls).isNsfw
}

export function deriveProfileNsfwFlag(source: NsfwUrlSource, explicitIsNsfw: boolean): boolean {
  return explicitIsNsfw || hasNsfwSignals(source)
}
