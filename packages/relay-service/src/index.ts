import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

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

const server = createServer()
const wss = new WebSocketServer({
  server,
  maxPayload: MAX_MESSAGE_BYTES,
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

function parseWebId(reqUrl: string | undefined): string | null {
  if (!reqUrl) return null
  try {
    const url = new URL(reqUrl, 'http://localhost')
    const webId = url.searchParams.get('webId')
    return webId && webId.trim().length > 0 ? webId.trim() : null
  } catch {
    return null
  }
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

wss.on('connection', (ws, req) => {
  const webId = parseWebId(req.url)
  if (!webId) {
    ws.close(1008, 'Missing webId query parameter')
    return
  }

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
    const current = peers.get(webId)
    if (current === ws) {
      peers.delete(webId)
    }
  })

  ws.on('error', () => {
    // Socket-level errors are handled by close event cleanup.
  })

  sendJson(ws, { ok: true, webId })
})

const pingTimer = setInterval(() => {
  for (const [webId, ws] of peers.entries()) {
    if (ws.readyState !== ws.OPEN) {
      peers.delete(webId)
      continue
    }
    ws.ping()
  }
}, PING_INTERVAL_MS)

server.listen(PORT, () => {
  console.log(`[relay-service] listening on :${PORT}`)
})

process.on('SIGINT', () => {
  clearInterval(pingTimer)
  wss.close(() => {
    server.close(() => process.exit(0))
  })
})
