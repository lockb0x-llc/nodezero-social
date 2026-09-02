import assert from 'node:assert/strict'
import test from 'node:test'
import { SignalRelay } from './SignalRelay.js'

const localWebId = 'https://alice.example/profile/card#me'
const remoteWebId = 'https://bob.example/profile/card#me'

interface SentFrame {
  type?: string
  signatureBase64?: string
  from?: string
  to?: string
}

let onSocketConstructed: ((socket: FakeSocket) => void) | null = null

class FakeSocket {
  static readonly OPEN = 1
  static readonly CLOSED = 3

  readyState = FakeSocket.OPEN
  sent: string[] = []
  closedWith: { code: number; reason: string } | null = null

  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(_url?: string, _protocols?: string[]) {
    onSocketConstructed?.(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(code: number, reason: string): void {
    this.readyState = FakeSocket.CLOSED
    this.closedWith = { code, reason }
  }

  frames(): SentFrame[] {
    return this.sent.map((raw) => JSON.parse(raw) as SentFrame)
  }
}

/** Installs a fake WebSocket global and returns the constructed socket. */
function withFakeSocket<T>(run: (getSocket: () => FakeSocket) => T): T {
  const globalRef = globalThis as unknown as { WebSocket?: unknown }
  const original = globalRef.WebSocket
  let created: FakeSocket | undefined

  onSocketConstructed = (socket) => {
    created = socket
  }
  globalRef.WebSocket = FakeSocket

  try {
    return run(() => {
      if (!created) throw new Error('socket was not constructed')
      return created
    })
  } finally {
    onSocketConstructed = null
    globalRef.WebSocket = original
  }
}

function createRelay(overrides: Partial<{ signIdentityChallenge: (c: string) => Promise<string> }> = {}) {
  return new SignalRelay({
    relayUrl: 'wss://relay.example/ws',
    localWebId,
    identityAssertion: 'assertion-token',
    signIdentityChallenge: overrides.signIdentityChallenge ?? ((c) => Promise.resolve(`signed:${c}`)),
  })
}

void test('answers a relay auth challenge with a signature over the challenge', async () => {
  await withFakeSocket(async (getSocket) => {
    const relay = createRelay()
    relay.connect()
    const socket = getSocket()

    socket.onmessage?.({ data: JSON.stringify({ type: 'auth-challenge', challenge: 'nonce-1' }) })
    await new Promise((resolve) => setImmediate(resolve))

    const frames = socket.frames()
    assert.equal(frames.length, 1)
    assert.equal(frames[0]?.type, 'auth-response')
    assert.equal(frames[0]?.signatureBase64, 'signed:nonce-1')
  })
})

void test('closes the socket when identity signing fails rather than proceeding unauthenticated', async () => {
  await withFakeSocket(async (getSocket) => {
    const relay = createRelay({ signIdentityChallenge: () => Promise.reject(new Error('no key')) })
    relay.connect()
    const socket = getSocket()

    socket.onmessage?.({ data: JSON.stringify({ type: 'auth-challenge', challenge: 'nonce-1' }) })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(socket.sent.length, 0)
    assert.equal(socket.closedWith?.code, 1008)
  })
})

void test('refuses to send a message whose sender is not the authenticated WebID', () => {
  withFakeSocket((getSocket) => {
    const relay = createRelay()
    relay.connect()
    const socket = getSocket()

    assert.throws(
      () =>
        relay.send({
          type: 'offer',
          from: remoteWebId,
          to: localWebId,
          payload: 'sdp',
        } as never),
      /sender does not match/i
    )
    assert.equal(socket.sent.length, 0)
  })
})

void test('refuses to send before the relay is connected', () => {
  const relay = createRelay()
  assert.throws(
    () => relay.send({ type: 'offer', from: localWebId, to: remoteWebId, payload: 'sdp' } as never),
    /not connected/i
  )
})

void test('emits a signal for a routed peer message', () => {
  withFakeSocket((getSocket) => {
    const relay = createRelay()
    const received: unknown[] = []
    relay.on('signal', (msg) => received.push(msg))
    relay.connect()

    getSocket().onmessage?.({
      data: JSON.stringify({ type: 'offer', from: remoteWebId, to: localWebId, payload: 'sdp' }),
    })

    assert.equal(received.length, 1)
    assert.deepEqual(received[0], {
      type: 'offer',
      from: remoteWebId,
      to: localWebId,
      payload: 'sdp',
    })
  })
})

void test('emits an error instead of throwing on a malformed relay frame', () => {
  withFakeSocket((getSocket) => {
    const relay = createRelay()
    const errors: Error[] = []
    relay.on('error', (err) => errors.push(err))
    relay.connect()

    getSocket().onmessage?.({ data: 'not-json' })

    assert.equal(errors.length, 1)
    assert.match(errors[0]?.message ?? '', /failed to parse/i)
  })
})

void test('emits connected only after the relay acknowledges authentication', () => {
  withFakeSocket((getSocket) => {
    const relay = createRelay()
    let connected = 0
    relay.on('connected', () => (connected += 1))
    relay.connect()

    assert.equal(connected, 0)
    getSocket().onmessage?.({ data: JSON.stringify({ ok: true }) })
    assert.equal(connected, 1)
  })
})
