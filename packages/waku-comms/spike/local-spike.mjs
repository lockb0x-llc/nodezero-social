#!/usr/bin/env node
/**
 * NodeZero Waku spike harness (Phase 0) — Node.js edition.
 *
 * Proves against a LOCAL nwaku node (scripts/waku-spike/docker-compose.yml):
 *   1. Two @waku/sdk light nodes connect to the self-hosted nwaku peer.
 *   2. LightPush publish on an H3 cell topic reaches a Filter subscriber,
 *      with signed-envelope verification and latency measurement.
 *   3. A non-ephemeral message published while a client is "offline" is
 *      recovered via a Store query; an ephemeral one is correctly absent.
 *
 * Usage:
 *   docker compose -f scripts/waku-spike/docker-compose.yml up -d
 *   node packages/waku-comms/spike/local-spike.mjs [--rest http://127.0.0.1:8645] [--ws /ip4/127.0.0.1/tcp/8000/ws]
 *
 * Exit code 0 = all checks PASS. This mirrors the scripts/qa/*-e2e pattern
 * and will graduate into scripts/qa/waku-messaging-e2e.mjs in Phase 6.
 */

import { Keypair } from '@stellar/stellar-sdk'
import { createLightNode, Protocols } from '@waku/sdk'

const args = process.argv.slice(2)
const restBase = argValue('--rest') ?? 'http://127.0.0.1:8645'
const wsBase = argValue('--ws') ?? '/ip4/127.0.0.1/tcp/8000/ws'

const APP_PREFIX = 'nodezero-spike'
const H3 = '892830828cbffff'
const CELL_TOPIC = `/${APP_PREFIX}/1/cell-${H3}/proto`
const DM_TOPIC = `/${APP_PREFIX}/1/dm-spike/proto`

const results = []

function argValue(flag) {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function record(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function nwakuMultiaddr() {
  const response = await fetch(`${restBase}/debug/v1/info`)
  if (!response.ok) {
    throw new Error(`nwaku REST /debug/v1/info returned ${response.status} — is the container up?`)
  }
  const info = await response.json()
  // listenAddresses advertise the container-internal IP (e.g. 172.18.0.2),
  // which is unreachable from the host. Extract the peer id and rewrite onto
  // the host-mapped WebSocket base (127.0.0.1:8000 by default).
  const withPeerId = (info.listenAddresses ?? []).find((address) => address.includes('/p2p/'))
  const p2pIndex = withPeerId?.indexOf('/p2p/')
  if (withPeerId && p2pIndex >= 0) return `${wsBase}${withPeerId.slice(p2pIndex)}`
  throw new Error(`Could not derive a WebSocket multiaddr from ${JSON.stringify(info)}`)
}

async function startClient(name, bootstrap) {
  const startedAt = Date.now()
  const node = await createLightNode({
    bootstrapPeers: [bootstrap],
    defaultBootstrap: false,
    // Must match the nwaku spike node (--cluster-id=0 --shard=0); js-waku
    // defaults to The Waku Network (clusterId 1) otherwise.
    networkConfig: { clusterId: 0 },
    discovery: { peerExchange: false, dns: false, peerCache: false },
    // Allow plain ws:// to 127.0.0.1 (default filter admits only wss/dns).
    libp2p: { filterMultiaddrs: false },
  })
  await node.start()
  await withTimeout(
    node.waitForPeers([Protocols.LightPush, Protocols.Filter]),
    15_000,
    `${name} waitForPeers`,
  )
  const connectMs = Date.now() - startedAt
  record(`${name}: connect + protocol peers`, true, `${connectMs} ms`)
  return node
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms)),
  ])
}

function signedPayload(keypair, body) {
  const envelope = {
    id: crypto.randomUUID(),
    senderWebId: 'https://solid.nodezero.social/spike/profile/card#me',
    senderStellarPublicKey: keypair.publicKey(),
    timestamp: new Date().toISOString(),
    kind: 'broadcast',
    body,
  }
  const canonical = JSON.stringify([
    envelope.id,
    envelope.senderWebId,
    envelope.senderStellarPublicKey,
    envelope.timestamp,
    envelope.kind,
    envelope.body,
  ])
  envelope.signatureBase64 = keypair.sign(Buffer.from(canonical, 'utf8')).toString('base64')
  return new TextEncoder().encode(JSON.stringify(envelope))
}

function verifyPayload(payload) {
  const envelope = JSON.parse(new TextDecoder().decode(payload))
  const canonical = JSON.stringify([
    envelope.id,
    envelope.senderWebId,
    envelope.senderStellarPublicKey,
    envelope.timestamp,
    envelope.kind,
    envelope.body,
  ])
  const verified = Keypair.fromPublicKey(envelope.senderStellarPublicKey).verify(
    Buffer.from(canonical, 'utf8'),
    Buffer.from(envelope.signatureBase64, 'base64'),
  )
  return { envelope, verified }
}

async function main() {
  console.log(`nwaku REST: ${restBase}`)
  const bootstrap = await nwakuMultiaddr()
  console.log(`bootstrap multiaddr: ${bootstrap}\n`)

  const alice = await startClient('alice', bootstrap)
  const bob = await startClient('bob', bootstrap)
  const keypair = Keypair.random()

  // ---- Check 1: publish → filter delivery latency -------------------------
  const inbox = []
  const cellDecoder = bob.createDecoder({ contentTopic: CELL_TOPIC, shardId: 0 })
  const subscribed = await bob.filter.subscribe([cellDecoder], (message) =>
    inbox.push({ at: Date.now(), payload: message.payload }),
  )
  if (!subscribed) throw new Error('bob filter subscribe failed')

  const publishedAt = Date.now()
  const sendResult = await alice.lightPush.send(
    alice.createEncoder({ contentTopic: CELL_TOPIC, ephemeral: false, shardId: 0 }),
    { payload: signedPayload(keypair, 'hello local cell') },
  )
  record('alice: lightPush acknowledged', sendResult.successes.length > 0)

  await waitFor(() => inbox.length > 0, 10_000)
  const latency = inbox.length > 0 ? inbox[0].at - publishedAt : NaN
  record('bob: filter delivery', inbox.length === 1, `${latency} ms`)
  if (inbox.length > 0) {
    const { envelope, verified } = verifyPayload(inbox[0].payload)
    record('bob: envelope signature verified', verified, envelope.id)
  }

  // ---- Check 2: store recovery (offline catch-up) -------------------------
  await alice.lightPush.send(alice.createEncoder({ contentTopic: DM_TOPIC, ephemeral: false, shardId: 0 }), {
    payload: signedPayload(keypair, 'missed while offline'),
  })
  await alice.lightPush.send(alice.createEncoder({ contentTopic: DM_TOPIC, ephemeral: true, shardId: 0 }), {
    payload: signedPayload(keypair, 'ephemeral — must NOT be stored'),
  })
  await sleep(1_500) // allow store indexing

  const recovered = []
  for await (const page of bob.store.queryGenerator([bob.createDecoder({ contentTopic: DM_TOPIC, shardId: 0 })])) {
    for (const message of await Promise.all(page)) {
      if (message) recovered.push(verifyPayload(message.payload))
    }
  }
  const bodies = recovered.map((entry) => entry.envelope.body)
  record('bob: store recovered durable message', bodies.includes('missed while offline'))
  record(
    'bob: store excluded ephemeral message',
    !bodies.includes('ephemeral — must NOT be stored'),
    `recovered=${JSON.stringify(bodies)}`,
  )

  await bob.filter.unsubscribe([cellDecoder]).catch(() => undefined)
  await alice.stop()
  await bob.stop()

  const failed = results.filter((entry) => !entry.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(100)
  }
}

main().catch((error) => {
  console.error(`\nSPIKE ERROR: ${error.message}`)
  process.exit(2)
})
