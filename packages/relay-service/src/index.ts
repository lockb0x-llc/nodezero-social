import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { readRelayIdentityAssertion, verifyRelayIdentity } from './relayIdentity.js'
import {
  createRelayIdentityChallenge,
  verifyRelayIdentitySignature,
} from './relayChallenge.js'

type SignalType = 'offer' | 'answer' | 'ice-candidate'

interface SignalMessage {
  type: SignalType
  from: string
  to: string
  payload: unknown
}

const PORT = Number(process.env.RELAY_PORT ?? 8080)
const MAX_MESSAGE_BYTES = Number(process.env.RELAY_MAX_MESSAGE_BYTES ?? 32_768)
const PING_INTERVAL_MS = Number(process.env.RELAY_PING_INTERVAL_MS ?? 30_000)
const IDENTITY_REVERIFY_INTERVAL_MS = Number(
  process.env.RELAY_IDENTITY_REVERIFY_INTERVAL_MS ?? 60_000
)
const AUTH_CHALLENGE_TIMEOUT_MS = Number(process.env.RELAY_AUTH_CHALLENGE_TIMEOUT_MS ?? 10_000)
const MAX_PENDING_ADMISSIONS = Number(process.env.RELAY_MAX_PENDING_ADMISSIONS ?? 100)
let pendingAdmissions = 0
const PROVISIONER_URL = (process.env.RELAY_PROVISIONER_URL ?? '').trim().replace(/\/+$/, '')

const server = createServer()
const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
  handleProtocols: (protocols): string | false =>
    protocols.has('nz-relay-v1') ? 'nz-relay-v1' : false,
})

const peers = new Map<string, WebSocket>()

function isSignalMessage(value: unknown): value is SignalMessage {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Partial<SignalMessage>
  return (
    (maybe.type === 'offer' || maybe.type === 'answer' || maybe.type === 'ice-candidate') &&
    typeof maybe.from === 'string' &&
    typeof maybe.to === 'string' &&
    'payload' in maybe
  )
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function sendHttpJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && requestUrl.pathname === '/health') {
    sendHttpJson(res, 200, {
      ok: true,
      service: 'relay-service',
      activePeers: peers.size,
      identityVerifierConfigured: Boolean(PROVISIONER_URL),
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  if (req.method === 'GET' && requestUrl.pathname === '/') {
    sendHttpJson(res, 200, {
      ok: true,
      service: 'relay-service',
      endpoints: ['/health', '/healthz', 'WebSocket subprotocol nz-relay-v1'],
    })
    return
  }

  if (req.method === 'GET' && requestUrl.pathname === '/healthz') {
    sendHttpJson(res, 200, {
      ok: true,
      service: 'relay-service',
      activePeers: peers.size,
      identityVerifierConfigured: Boolean(PROVISIONER_URL),
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  sendHttpJson(res, 404, { error: 'Not found' })
}

wss.on('connection', (ws, req) => {
  if (pendingAdmissions >= MAX_PENDING_ADMISSIONS) {
    ws.close(1013, 'Relay admission capacity reached')
    return
  }
  pendingAdmissions += 1
  void admitConnection(ws, req).finally(() => {
    pendingAdmissions -= 1
  })
})

async function admitConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
  const assertion = readRelayIdentityAssertion(req.headers['sec-websocket-protocol'])
  if (!assertion || !PROVISIONER_URL) {
    ws.close(1008, 'Relay identity verification is unavailable')
    return
  }
  const identity = await verifyRelayIdentity({ assertion, provisionerUrl: PROVISIONER_URL })
  if (!identity || ws.readyState !== ws.OPEN) {
    ws.close(1008, 'Invalid relay identity')
    return
  }
  const webId = identity.webId
  const challenge = createRelayIdentityChallenge(webId, identity.stellarPublicKey)
  sendJson(ws, { type: 'auth-challenge', challenge })
  const authenticated = await waitForIdentityProof(
    ws,
    challenge,
    identity.stellarPublicKey,
    AUTH_CHALLENGE_TIMEOUT_MS
  )
  if (!authenticated || ws.readyState !== ws.OPEN) {
    ws.close(1008, 'Invalid relay identity proof')
    return
  }
  const identityTimer = setInterval(() => {
    void verifyRelayIdentity({ assertion, provisionerUrl: PROVISIONER_URL }).then((verified) => {
      if (!verified || verified.webId !== webId) ws.close(1008, 'Relay identity expired')
    })
  }, IDENTITY_REVERIFY_INTERVAL_MS)

  const existing = peers.get(webId)
  if (existing && existing !== ws) {
    existing.close(1000, 'Replaced by newer session')
  }

  peers.set(webId, ws)

  ws.on('message', (data) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(String(data))
    } catch {
      sendJson(ws, { error: 'Invalid JSON payload' })
      return
    }

    if (!isSignalMessage(parsed)) {
      sendJson(ws, { error: 'Invalid signal message shape' })
      return
    }

    if (parsed.from !== webId) {
      sendJson(ws, { error: 'Message sender does not match authenticated webId' })
      return
    }

    const target = peers.get(parsed.to)
    if (!target || target.readyState !== target.OPEN) {
      sendJson(ws, { error: `Target peer not connected: ${parsed.to}` })
      return
    }

    sendJson(target, parsed)
  })

  ws.on('close', () => {
    clearInterval(identityTimer)
    const current = peers.get(webId)
    if (current === ws) {
      peers.delete(webId)
    }
  })

  ws.on('error', () => {
    // Socket-level errors are handled by close event cleanup.
  })

  sendJson(ws, { ok: true, webId })
}

function waitForIdentityProof(
  ws: WebSocket,
  challenge: string,
  stellarPublicKey: string,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.off('message', onMessage)
      ws.off('close', onClose)
      resolve(result)
    }
    const onMessage = (data: Parameters<Parameters<WebSocket['on']>[1]>[0]): void => {
      try {
        const payload = JSON.parse(String(data)) as Record<string, unknown>
        if (payload.type !== 'auth-response' || typeof payload.signatureBase64 !== 'string') {
          finish(false)
          return
        }
        const verified = verifyRelayIdentitySignature(
          challenge,
          stellarPublicKey,
          payload.signatureBase64
        )
        finish(verified)
      } catch {
        finish(false)
      }
    }
    const onClose = (): void => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    ws.on('message', onMessage)
    ws.on('close', onClose)
  })
}

const pingTimer = setInterval(() => {
  for (const [webId, ws] of peers.entries()) {
    if (ws.readyState !== ws.OPEN) {
      peers.delete(webId)
      continue
    }
    ws.ping()
  }
}, PING_INTERVAL_MS)

server.on('request', handleHttpRequest)

server.listen(PORT, () => {
  console.log(`[relay-service] listening on :${PORT}`)
})

process.on('SIGINT', () => {
  clearInterval(pingTimer)
  wss.close(() => {
    server.close(() => process.exit(0))
  })
})
