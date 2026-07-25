import { NsfwScanner } from './NsfwScanner.js'

export interface NsfwUrlSource {
  externalUrl?: string | undefined
  avatarUrl?: string | undefined
}

export interface NsfwDecisionOptions {
  scanner?: Pick<NsfwScanner, 'scan'>
}

const defaultScanner = new NsfwScanner()

export function collectNsfwScanUrls(source: NsfwUrlSource): string[] {
  const urls: string[] = []
  if (source.externalUrl) urls.push(source.externalUrl)
  if (source.avatarUrl) urls.push(source.avatarUrl)
  return urls
}

export function hasNsfwSignals(source: NsfwUrlSource, options: NsfwDecisionOptions = {}): boolean {
  const urls = collectNsfwScanUrls(source)
  if (urls.length === 0) return false
  const scanner = options.scanner ?? defaultScanner
  return scanner.scan(urls).isNsfw
}

export function deriveProfileNsfwFlag(
  source: NsfwUrlSource,
  explicitIsNsfw: boolean,
  options: NsfwDecisionOptions = {}
): boolean {
  return explicitIsNsfw || hasNsfwSignals(source, options)
}
