/**
 * @module h3-grid
 *
 * Core utility functions for H3-based Local Node discovery.
 *
 * A "Local Node" is a hexagonal H3 cell that acts as a geofenced town square.
 * Users whose GPS coordinates map to the same H3 index (or a direct neighbour)
 * are considered to be in the same Local Node and can discover each other.
 */

import { latLngToCell, gridDisk, cellToLatLng, getResolution } from 'h3-js'

/**
 * Default H3 resolution used for Local Node discovery.
 *
 * | Resolution | Avg Cell Area |
 * |------------|--------------|
 * | 7          | ~5.16 km²    |
 * | 8          | ~0.74 km²    |
 * | **9**      | **~0.11 km²**|
 * | 10         | ~0.015 km²   |
 *
 * Resolution 9 maps roughly to a city block – suitable for hyper-local discovery.
 */
export const DEFAULT_RESOLUTION = 9

/**
 * Represents a single H3 hexagonal cell acting as a Local Node.
 */
export interface LocalNode {
  /** The H3 index string identifying this cell. */
  h3Index: string
  /**
   * The geographic centre of the cell as [latitude, longitude].
   * Useful for rendering pins on a map without revealing the exact user position.
   */
  centre: [lat: number, lng: number]
  /** H3 resolution of this cell (0-15). */
  resolution: number
  /** Whether this is the user's origin cell (`true`) or a neighbouring cell. */
  isOrigin: boolean
}

/** Return type of {@link getSurroundingNodes}. */
export interface SurroundingNodesResult {
  /** The cell that the supplied coordinates fall within. */
  originNode: LocalNode
  /**
   * All cells within a single-ring radius of the origin (6 neighbours), plus
   * the origin itself.  Equivalent to `gridDisk(origin, 1)` from h3-js.
   */
  surroundingNodes: LocalNode[]
}

/**
 * Converts a GPS coordinate pair to an H3 cell and returns that cell plus
 * its immediate 6 neighbours.
 *
 * @param lat - Latitude in decimal degrees (−90 to +90).
 * @param lng - Longitude in decimal degrees (−180 to +180).
 * @param resolution - H3 resolution (0–15).  Defaults to {@link DEFAULT_RESOLUTION}.
 * @returns An object describing the origin cell and all surrounding cells.
 *
 * @example
 * ```ts
 * const { originNode, surroundingNodes } = getSurroundingNodes(51.5074, -0.1278)
 * console.log(originNode.h3Index)   // e.g. "89195ab1b3bffff"
 * console.log(surroundingNodes.length) // 7 (origin + 6 neighbours)
 * ```
 */
export function getSurroundingNodes(
  lat: number,
  lng: number,
  resolution: number = DEFAULT_RESOLUTION
): SurroundingNodesResult {
  if (resolution < 0 || resolution > 15) {
    throw new RangeError(`H3 resolution must be between 0 and 15, got ${resolution}`)
  }
  if (lat < -90 || lat > 90) {
    throw new RangeError(`Latitude must be between -90 and 90, got ${lat}`)
  }
  if (lng < -180 || lng > 180) {
    throw new RangeError(`Longitude must be between -180 and 180, got ${lng}`)
  }

  const originIndex = latLngToCell(lat, lng, resolution)
  const diskIndexes = gridDisk(originIndex, 1)

  const surroundingNodes: LocalNode[] = diskIndexes.map((h3Index) => {
    const [cellLat, cellLng] = cellToLatLng(h3Index)
    return {
      h3Index,
      centre: [cellLat, cellLng],
      resolution: getResolution(h3Index),
      isOrigin: h3Index === originIndex,
    }
  })

  const originNode = surroundingNodes.find((n) => n.isOrigin)!

  return { originNode, surroundingNodes }
}
