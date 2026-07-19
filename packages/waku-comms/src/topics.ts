/**
 * @module topics
 * Content-topic scheme for the NodeZero ephemeral plane.
 *
 * Format (Waku convention): /{appPrefix}/{version}/{purpose}-{scope}/proto
 *
 *   /nodezero-staging/1/presence-892830828cbffff/proto
 *   /nodezero-staging/1/cell-892830828cbffff/proto
 *   /nodezero-staging/1/dm-Zm9vYmFyYmF6cXV4/proto
 *
 * - presence-{h3Index}: ephemeral presence beacons for one H3 cell.
 * - cell-{h3Index}:     local broadcast posts for one H3 cell.
 * - dm-{pairHash}:      pairwise inbox; pairHash is order-independent so both
 *                       peers derive the same topic.
 *
 * The appPrefix is environment-scoped (nodezero-local / nodezero-staging /
 * nodezero) so staging and production traffic can never mix — the same
 * invariant scripts/policy/validate-env-isolation.sh enforces for RPC and
 * contract identifiers.
 */

const TOPIC_VERSION = 1
const APP_PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const H3_INDEX_PATTERN = /^[0-9a-f]{15}$/

/** Map an NZ_ENV_PROFILE value to its content-topic app prefix. */
export function appPrefixForProfile(profile: string): string {
  switch (profile) {
    case 'local':
      return 'nodezero-local'
    case 'staging-testnet':
      return 'nodezero-staging'
    case 'production-mainnet':
      return 'nodezero'
    default:
      throw new Error(`Unknown environment profile: ${profile}`)
  }
}

function assertAppPrefix(appPrefix: string): void {
  if (!APP_PREFIX_PATTERN.test(appPrefix)) {
    throw new Error(`Invalid content-topic app prefix: ${appPrefix}`)
  }
}

function assertH3Index(h3Index: string): void {
  if (!H3_INDEX_PATTERN.test(h3Index)) {
    throw new Error(`Invalid H3 index: ${h3Index}`)
  }
}

function contentTopic(appPrefix: string, name: string): string {
  assertAppPrefix(appPrefix)
  return `/${appPrefix}/${TOPIC_VERSION}/${name}/proto`
}

/** Presence-beacon topic for one H3 cell. */
export function presenceTopic(appPrefix: string, h3Index: string): string {
  assertH3Index(h3Index)
  return contentTopic(appPrefix, `presence-${h3Index}`)
}

/** Local-broadcast topic for one H3 cell. */
export function cellTopic(appPrefix: string, h3Index: string): string {
  assertH3Index(h3Index)
  return contentTopic(appPrefix, `cell-${h3Index}`)
}

/**
 * Pairwise DM topic. Order-independent: dmTopic(p, a, b) === dmTopic(p, b, a).
 * The pair hash avoids leaking raw WebIDs into topic names observable by
 * serving nodes.
 */
export async function dmTopic(appPrefix: string, webIdA: string, webIdB: string): Promise<string> {
  if (!webIdA || !webIdB) {
    throw new Error('Both WebIDs are required to derive a DM topic')
  }
  const [first, second] = [webIdA, webIdB].sort()
  const pairHash = await sha256Base64Url(`${first}\n${second}`)
  return contentTopic(appPrefix, `dm-${pairHash.slice(0, 32)}`)
}

/**
 * Rotating presence commitment: base64url(SHA-256(webId + ':' + epoch)).
 * The epoch (e.g. hour bucket) bounds how long a commitment is linkable.
 */
export async function presenceCommitment(webId: string, epoch: string): Promise<string> {
  if (!webId || !epoch) {
    throw new Error('webId and epoch are required for a presence commitment')
  }
  return sha256Base64Url(`${webId}:${epoch}`)
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64UrlEncode(new Uint8Array(digest))
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
