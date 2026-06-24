import { getSurroundingNodes, DEFAULT_RESOLUTION } from '../h3-grid.js'

// London coordinates for deterministic tests
const LONDON_LAT = 51.5074
const LONDON_LNG = -0.1278

describe('getSurroundingNodes()', () => {
  it('returns 7 surrounding nodes (origin + 6 neighbours) at default resolution', () => {
    const { surroundingNodes } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    expect(surroundingNodes).toHaveLength(7)
  })

  it('marks exactly one node as the origin', () => {
    const { surroundingNodes, originNode } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    const originCount = surroundingNodes.filter((n) => n.isOrigin).length
    expect(originCount).toBe(1)
    expect(originNode.isOrigin).toBe(true)
  })

  it('origin node is included in surroundingNodes', () => {
    const { originNode, surroundingNodes } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    expect(surroundingNodes.some((n) => n.h3Index === originNode.h3Index)).toBe(true)
  })

  it('uses DEFAULT_RESOLUTION when no resolution argument is supplied', () => {
    const { originNode } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    expect(originNode.resolution).toBe(DEFAULT_RESOLUTION)
  })

  it('respects a custom resolution', () => {
    const { originNode } = getSurroundingNodes(LONDON_LAT, LONDON_LNG, 7)
    expect(originNode.resolution).toBe(7)
  })

  it('each node has a valid h3Index string', () => {
    const { surroundingNodes } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    for (const node of surroundingNodes) {
      expect(typeof node.h3Index).toBe('string')
      expect(node.h3Index.length).toBeGreaterThan(0)
    }
  })

  it('each node has a [lat, lng] centre array', () => {
    const { surroundingNodes } = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    for (const node of surroundingNodes) {
      const [lat, lng] = node.centre
      expect(typeof lat).toBe('number')
      expect(typeof lng).toBe('number')
      expect(lat).toBeGreaterThanOrEqual(-90)
      expect(lat).toBeLessThanOrEqual(90)
      expect(lng).toBeGreaterThanOrEqual(-180)
      expect(lng).toBeLessThanOrEqual(180)
    }
  })

  it('throws RangeError for out-of-range resolution', () => {
    expect(() => getSurroundingNodes(LONDON_LAT, LONDON_LNG, 16)).toThrow(RangeError)
    expect(() => getSurroundingNodes(LONDON_LAT, LONDON_LNG, -1)).toThrow(RangeError)
  })

  it('throws RangeError for out-of-range latitude', () => {
    expect(() => getSurroundingNodes(91, 0)).toThrow(RangeError)
    expect(() => getSurroundingNodes(-91, 0)).toThrow(RangeError)
  })

  it('throws RangeError for out-of-range longitude', () => {
    expect(() => getSurroundingNodes(0, 181)).toThrow(RangeError)
    expect(() => getSurroundingNodes(0, -181)).toThrow(RangeError)
  })

  it('produces the same H3 index for the same coordinate pair', () => {
    const a = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    const b = getSurroundingNodes(LONDON_LAT, LONDON_LNG)
    expect(a.originNode.h3Index).toBe(b.originNode.h3Index)
  })
})
