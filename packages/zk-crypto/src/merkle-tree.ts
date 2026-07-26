/**
 * @module merkle-tree
 * Incremental Poseidon Merkle tree — the same structure used inside poh.circom.
 *
 * Each leaf is H_poseidon(identitySecret) (the commitment).
 * Internal nodes are H_poseidon(left, right).
 * Empty nodes are filled with the zero-value subtree hash.
 */

import { poseidonHash } from './poseidon.js'

export interface MerkleProof {
  pathElements: bigint[]  // sibling hashes, bottom → root
  pathIndices: number[]   // 0 = current node is left, 1 = right
  root: bigint
  leaf: bigint
  leafIndex: number
}

/** Pre-computed zero-hashes for each level (zero leaf = Poseidon(0)). */
async function buildZeroHashes(depth: number): Promise<bigint[]> {
  const zeros: bigint[] = new Array(depth + 1)
  zeros[0] = await poseidonHash([0n])
  for (let i = 1; i <= depth; i++) {
    zeros[i] = await poseidonHash([zeros[i - 1], zeros[i - 1]])
  }
  return zeros
}

export class PoseidonMerkleTree {
  private depth: number
  private leaves: bigint[] = []
  private nodes: Map<string, bigint> = new Map()
  private zeros: bigint[] = []
  private initialised = false

  constructor(depth: number = 20) {
    this.depth = depth
  }

  async init(): Promise<void> {
    this.zeros = await buildZeroHashes(this.depth)
    this.initialised = true
  }

  private assertInit() {
    if (!this.initialised) throw new Error('PoseidonMerkleTree.init() must be called first')
  }

  private key(level: number, index: number): string {
    return `${level}:${index}`
  }

  private async nodeAt(level: number, index: number): Promise<bigint> {
    const k = this.key(level, index)
    if (this.nodes.has(k)) return this.nodes.get(k)!
    return this.zeros[level]
  }

  /** Insert a commitment leaf and return its leaf index. */
  async insert(commitment: bigint): Promise<number> {
    this.assertInit()
    const index = this.leaves.length
    this.leaves.push(commitment)
    this.nodes.set(this.key(0, index), commitment)

    // Recompute path from leaf to root
    let current = commitment
    let idx = index
    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      const sibling = await this.nodeAt(level, siblingIdx)
      const [left, right] = idx % 2 === 0
        ? [current, sibling]
        : [sibling, current]
      current = await poseidonHash([left, right])
      idx = Math.floor(idx / 2)
      this.nodes.set(this.key(level + 1, idx), current)
    }
    return index
  }

  /** Get the current Merkle root. */
  async getRoot(): Promise<bigint> {
    this.assertInit()
    return this.nodeAt(this.depth, 0)
  }

  /** Generate a Merkle inclusion proof for leaf at `leafIndex`. */
  async getProof(leafIndex: number): Promise<MerkleProof> {
    this.assertInit()
    if (leafIndex >= this.leaves.length) {
      throw new Error(`Leaf index ${leafIndex} out of range`)
    }

    const pathElements: bigint[] = []
    const pathIndices: number[] = []

    let idx = leafIndex
    for (let level = 0; level < this.depth; level++) {
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1
      const sibling = await this.nodeAt(level, siblingIdx)
      pathElements.push(sibling)
      pathIndices.push(idx % 2) // 0 = current is left, 1 = current is right
      idx = Math.floor(idx / 2)
    }

    const root = await this.getRoot()
    const leaf = this.leaves[leafIndex]
    return { pathElements, pathIndices, root, leaf, leafIndex }
  }

  get size(): number { return this.leaves.length }
}
