import { appPrefixForProfile, cellTopic, dmTopic, presenceCommitment, presenceTopic } from '../topics.js'

const H3 = '892830828cbffff'

describe('appPrefixForProfile', () => {
  it('maps every allowed environment profile to a distinct prefix', () => {
    expect(appPrefixForProfile('local')).toBe('nodezero-local')
    expect(appPrefixForProfile('staging-testnet')).toBe('nodezero-staging')
    expect(appPrefixForProfile('production-mainnet')).toBe('nodezero')
  })

  it('rejects unknown profiles (environment isolation)', () => {
    expect(() => appPrefixForProfile('testnet')).toThrow(/Unknown environment profile/)
    expect(() => appPrefixForProfile('')).toThrow(/Unknown environment profile/)
  })
})

describe('presenceTopic / cellTopic', () => {
  it('builds Waku-convention content topics scoped by H3 index', () => {
    expect(presenceTopic('nodezero-staging', H3)).toBe(`/nodezero-staging/1/presence-${H3}/proto`)
    expect(cellTopic('nodezero-staging', H3)).toBe(`/nodezero-staging/1/cell-${H3}/proto`)
  })

  it('rejects malformed H3 indexes', () => {
    expect(() => cellTopic('nodezero-staging', 'not-an-h3')).toThrow(/Invalid H3 index/)
    expect(() => presenceTopic('nodezero-staging', '892830828cbfff')).toThrow(/Invalid H3 index/)
  })

  it('rejects malformed app prefixes', () => {
    expect(() => cellTopic('Node Zero!', H3)).toThrow(/Invalid content-topic app prefix/)
  })
})

describe('dmTopic', () => {
  const alice = 'https://solid.nodezero.social/alice/profile/card#me'
  const bob = 'https://solid.nodezero.social/bob/profile/card#me'

  it('is order-independent so both peers derive the same topic', async () => {
    const ab = await dmTopic('nodezero-staging', alice, bob)
    const ba = await dmTopic('nodezero-staging', bob, alice)
    expect(ab).toBe(ba)
    expect(ab).toMatch(/^\/nodezero-staging\/1\/dm-[A-Za-z0-9_-]{32}\/proto$/)
  })

  it('does not leak raw WebIDs into the topic name', async () => {
    const topic = await dmTopic('nodezero-staging', alice, bob)
    expect(topic).not.toContain('alice')
    expect(topic).not.toContain('bob')
  })

  it('derives different topics for different pairs and environments', async () => {
    const carol = 'https://solid.nodezero.social/carol/profile/card#me'
    expect(await dmTopic('nodezero-staging', alice, bob)).not.toBe(
      await dmTopic('nodezero-staging', alice, carol),
    )
    expect(await dmTopic('nodezero-staging', alice, bob)).not.toBe(
      await dmTopic('nodezero', alice, bob),
    )
  })

  it('requires both WebIDs', async () => {
    await expect(dmTopic('nodezero-staging', alice, '')).rejects.toThrow(/Both WebIDs/)
  })
})

describe('presenceCommitment', () => {
  const webId = 'https://solid.nodezero.social/alice/profile/card#me'

  it('is deterministic per (webId, epoch) and rotates with the epoch', async () => {
    const first = await presenceCommitment(webId, '2026-07-19T10')
    const again = await presenceCommitment(webId, '2026-07-19T10')
    const nextEpoch = await presenceCommitment(webId, '2026-07-19T11')
    expect(first).toBe(again)
    expect(first).not.toBe(nextEpoch)
    expect(first).not.toContain('alice')
  })
})
