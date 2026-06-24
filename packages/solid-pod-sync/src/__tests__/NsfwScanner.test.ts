import { NsfwScanner, NSFW_DOMAINS } from '../NsfwScanner.js'

describe('NsfwScanner', () => {
  describe('default domain list', () => {
    it('exports a non-empty NSFW_DOMAINS constant', () => {
      expect(NSFW_DOMAINS.length).toBeGreaterThan(0)
      expect(NSFW_DOMAINS).toContain('onlyfans.com')
      expect(NSFW_DOMAINS).toContain('fansly.com')
      expect(NSFW_DOMAINS).toContain('pornhub.com')
    })
  })

  describe('scan()', () => {
    const scanner = new NsfwScanner()

    it('returns isNsfw=false for an empty array', () => {
      const result = scanner.scan([])
      expect(result.isNsfw).toBe(false)
      expect(result.matchedUrls).toHaveLength(0)
    })

    it('returns isNsfw=false for safe URLs', () => {
      const result = scanner.scan(['https://example.com', 'https://github.com'])
      expect(result.isNsfw).toBe(false)
      expect(result.matchedUrls).toHaveLength(0)
    })

    it('detects onlyfans.com', () => {
      const result = scanner.scan(['https://onlyfans.com/alice'])
      expect(result.isNsfw).toBe(true)
      expect(result.matchedUrls).toContain('https://onlyfans.com/alice')
    })

    it('detects fansly.com', () => {
      const result = scanner.scan(['https://fansly.com/creator'])
      expect(result.isNsfw).toBe(true)
    })

    it('detects pornhub.com', () => {
      const result = scanner.scan(['https://www.pornhub.com/video'])
      expect(result.isNsfw).toBe(true)
    })

    it('strips www. prefix before matching', () => {
      const result = scanner.scan(['https://www.onlyfans.com/alice'])
      expect(result.isNsfw).toBe(true)
    })

    it('handles mixed safe and NSFW URLs', () => {
      const result = scanner.scan([
        'https://example.com',
        'https://onlyfans.com/alice',
        'https://github.com',
      ])
      expect(result.isNsfw).toBe(true)
      expect(result.matchedUrls).toHaveLength(1)
      expect(result.matchedUrls[0]).toBe('https://onlyfans.com/alice')
    })

    it('handles malformed URLs gracefully', () => {
      const result = scanner.scan(['not-a-url', 'also::bad'])
      expect(result.isNsfw).toBe(false)
    })

    it('is case-insensitive for the domain', () => {
      const result = scanner.scan(['https://OnlyFans.COM/alice'])
      expect(result.isNsfw).toBe(true)
    })
  })

  describe('custom extraDomains', () => {
    it('flags URLs matching extra domains', () => {
      const custom = new NsfwScanner(['custom-adult.net'])
      const result = custom.scan(['https://custom-adult.net/profile'])
      expect(result.isNsfw).toBe(true)
    })

    it('still flags default domains when extraDomains is empty', () => {
      const custom = new NsfwScanner([])
      const result = custom.scan(['https://fansly.com/x'])
      expect(result.isNsfw).toBe(true)
    })
  })
})
