/**
 * @module H3Grid
 *
 * Object-oriented wrapper around the {@link getSurroundingNodes} utility.
 * Maintains a cached current cell so callers do not need to pass coordinates
 * on every call.
 */

import { latLngToCell, gridDisk, cellToLatLng } from 'h3-js'
import { getSurroundingNodes, DEFAULT_RESOLUTION } from './h3-grid.js'
import type { LocalNode, SurroundingNodesResult } from './h3-grid.js'

export type { LocalNode, SurroundingNodesResult }

/**
 * Stateful helper that caches the user's current H3 cell and provides
 * convenient methods for Local Node discovery.
 *
 * @example
 * ```ts
 * const grid = new H3Grid()
 * grid.updatePosition(51.5074, -0.1278)
 * const nodes = grid.getSurroundingNodes()
 * ```
 */
export class H3Grid {
  private readonly resolution: number
  private currentIndex: string | null = null

  constructor(resolution: number = DEFAULT_RESOLUTION) {
    if (resolution < 0 || resolution > 15) {
      throw new RangeError(`H3 resolution must be between 0 and 15, got ${resolution}`)
    }
    this.resolution = resolution
  }

  /**
   * Updates the current position to the H3 cell containing the supplied
   * coordinates. Returns the new H3 index.
   *
   * @param lat - Latitude in decimal degrees.
   * @param lng - Longitude in decimal degrees.
   */
  updatePosition(lat: number, lng: number): string {
    this.currentIndex = latLngToCell(lat, lng, this.resolution)
    return this.currentIndex
  }

  /**
   * Returns the current H3 index, or `null` if no position has been set yet.
   */
  getCurrentIndex(): string | null {
    return this.currentIndex
  }

  /**
   * Returns surrounding nodes for the last set position.
   * @throws If {@link updatePosition} has not been called yet.
   */
  getSurroundingNodes(): SurroundingNodesResult {
    if (!this.currentIndex) {
      throw new Error('Position not set. Call updatePosition() first.')
    }
    const [lat, lng] = cellToLatLng(this.currentIndex)
    return getSurroundingNodes(lat, lng, this.resolution)
  }

  /**
   * Checks whether a given H3 index is the same or adjacent to the current cell.
   * Useful for quickly filtering discovery results before deeper inspection.
   *
   * @param targetIndex - H3 index to test.
   * @param ringSize - Number of rings to consider (default 1 = immediate neighbours).
   */
  isNearby(targetIndex: string, ringSize = 1): boolean {
    if (!this.currentIndex) return false
    const neighbours = new Set(gridDisk(this.currentIndex, ringSize))
    return neighbours.has(targetIndex)
  }

  /**
   * Returns the H3 resolution this grid was configured with.
   */
  getResolution(): number {
    return this.resolution
  }
}
