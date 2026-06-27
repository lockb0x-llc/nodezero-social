/**
 * @module solid-pod-sync
 *
 * NodeZero Solid Protocol integration layer.
 * Provides authentication, profile management, and social graph operations
 * against user-owned Solid Pods (https://solidproject.org/).
 *
 * Design principles:
 * - NodeZero is a CLIENT, never a data silo. All user data lives in Solid Pods.
 * - NSFW detection is automatic, transparent, and never punitive – it only adds
 *   metadata so UIs can make informed rendering choices.
 * - No engagement-farming algorithms. All data access is explicit and consent-based.
 */

export { ProfileManager } from './ProfileManager.js'
export { SocialGraph } from './SocialGraph.js'
export { NsfwScanner, NSFW_DOMAINS } from './NsfwScanner.js'
export { DocustreamManager } from './DocustreamManager.js'
export type { UserProfile, ProfileWriteOptions } from './ProfileManager.js'
export type { Connection } from './SocialGraph.js'
export type { NsfwScanResult } from './NsfwScanner.js'
export type { StreamItem } from './DocustreamManager.js'
