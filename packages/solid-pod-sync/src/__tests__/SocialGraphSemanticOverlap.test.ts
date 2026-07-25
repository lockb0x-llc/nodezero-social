import { computeSemanticOverlap } from '../SocialGraph.js'

describe('computeSemanticOverlap', () => {
  it('matches case-insensitive literal interests', () => {
    const overlap = computeSemanticOverlap(
      ['Web3', 'Privacy', 'Music'],
      ['web3', 'design']
    )

    expect(overlap).toEqual(['Web3'])
  })

  it('matches local literal interests against URL-based peer interests', () => {
    const overlap = computeSemanticOverlap(
      ['privacy', 'art'],
      ['https://schema.org/Privacy', 'https://example.com/interests/ai-research']
    )

    expect(overlap).toEqual(['privacy'])
  })

  it('deduplicates local overlap outputs by normalized term', () => {
    const overlap = computeSemanticOverlap(
      ['AI Research', 'ai research', 'music'],
      ['https://example.com/interests/ai-research']
    )

    expect(overlap).toEqual(['AI Research'])
  })
})
