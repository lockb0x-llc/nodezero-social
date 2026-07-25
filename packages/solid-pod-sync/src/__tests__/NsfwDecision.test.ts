import {
  collectNsfwScanUrls,
  deriveProfileNsfwFlag,
  hasNsfwSignals,
} from '../NsfwDecision.js'

describe('NsfwDecision', () => {
  it('collectNsfwScanUrls returns urls in deterministic order', () => {
    expect(
      collectNsfwScanUrls({
        externalUrl: 'https://example.com/profile',
        avatarUrl: 'https://example.com/avatar.png',
      })
    ).toEqual(['https://example.com/profile', 'https://example.com/avatar.png'])
  })

  it('hasNsfwSignals detects known NSFW domains', () => {
    expect(hasNsfwSignals({ externalUrl: 'https://onlyfans.com/user' })).toBe(true)
    expect(hasNsfwSignals({ externalUrl: 'https://example.com' })).toBe(false)
  })

  it('deriveProfileNsfwFlag preserves explicit NSFW intent', () => {
    expect(deriveProfileNsfwFlag({ externalUrl: 'https://example.com' }, true)).toBe(true)
  })

  it('supports injected scanner for deterministic contract testing', () => {
    const scanner = {
      scan: (_urls: string[]) => ({ isNsfw: true, matchedUrls: [] }),
    }

    expect(hasNsfwSignals({ externalUrl: 'https://example.com' }, { scanner })).toBe(true)
  })
})
