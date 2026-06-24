/**
 * @module geo-discovery
 *
 * H3 hexagonal grid utilities for NodeZero Local Nodes.
 *
 * Local Nodes are geofenced "town squares" formed by mapping GPS coordinates
 * to Uber's H3 hexagonal grid (https://h3geo.org/).  Users within the same
 * H3 cell, or its immediate ring, are in the same "Local Node" and can
 * broadcast ephemeral messages to each other.
 *
 * Key design decisions:
 * - Coordinates are never stored in NodeZero's infrastructure.
 * - H3 indexes are computed on-device and shared only with consenting peers.
 * - The default resolution (9) produces cells ~0.1 km² – roughly a city block.
 */

export { H3Grid } from './H3Grid.js'
export { getSurroundingNodes } from './h3-grid.js'
export type { LocalNode, SurroundingNodesResult } from './h3-grid.js'
