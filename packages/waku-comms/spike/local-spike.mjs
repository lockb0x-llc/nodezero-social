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
import { createDecoder, createEncoder, createLightNode, Protocols } from '@waku/sdk'

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
  // listenAddresses contains the ws multiaddr including the peer id.
  const ws = (info.listenAddresses ?? []).find((address) => address.includes('/ws'))
  if (ws) return ws
  // Fall back to composing from the first address's peer id.
  const first = (info.listenAddresses ?? [])[0]
  const p2pIndex = first?.indexOf('/p2p/')
  if (first && p2pIndex >= 0) return `${wsBase}${first.slice(p2pIndex)}`
  throw new Error(`Could not derive a WebSocket multiaddr from ${JSON.stringify(info)}`)
}

async function startClient(name, bootstrap) {
  const startedAt = Date.now()
  const node = await createLightNode({ bootstrapPeers: [bootstrap], defaultBootstrap: false })
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
  const { error, subscription } = await bob.filter.subscribe(
    [createDecoder(CELL_TOPIC)],
    (message) => inbox.push({ at: Date.now(), payload: message.payload }),
  )
  if (error) throw new Error(`bob filter subscribe failed: ${error}`)

  const publishedAt = Date.now()
  const sendResult = await alice.lightPush.send(
    createEncoder({ contentTopic: CELL_TOPIC, ephemeral: false }),
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
  await alice.lightPush.send(createEncoder({ contentTopic: DM_TOPIC, ephemeral: false }), {
    payload: signedPayload(keypair, 'missed while offline'),
  })
  await alice.lightPush.send(createEncoder({ contentTopic: DM_TOPIC, ephemeral: true }), {
    payload: signedPayload(keypair, 'ephemeral — must NOT be stored'),
  })
  await sleep(1_500) // allow store indexing

  const recovered = []
  for await (const page of bob.store.queryGenerator([createDecoder(DM_TOPIC)])) {
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

  await subscription?.unsubscribe([CELL_TOPIC]).catch(() => undefined)
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
