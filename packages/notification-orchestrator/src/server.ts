import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NotificationOrchestrator } from './orchestrator.js'
import {
  ConsoleEmailSender,
  InMemoryMessageStore,
  InMemoryPreferencesStore,
  InMemoryUserDirectory,
} from './runtime.js'
import { ingestProvisionerEvent } from './provisionerWebhook.js'

const PORT = Number(process.env.PORT ?? process.env.NZ_NOTIFICATION_ORCHESTRATOR_PORT ?? 8282)
const WEBHOOK_TOKEN = (process.env.ORCH_WEBHOOK_TOKEN ?? '').trim()

const messageStore = new InMemoryMessageStore()
const userDirectory = InMemoryUserDirectory.fromEnv(process.env.ORCH_USER_DIRECTORY_JSON)

const orchestrator = new NotificationOrchestrator({
  preferencesStore: new InMemoryPreferencesStore(),
  messageStore,
  userDirectory,
  emailSender: new ConsoleEmailSender(),
})

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) throw new Error('Request body is required.')
  return JSON.parse(raw) as T
}

function hasValidBearerToken(req: IncomingMessage): boolean {
  if (!WEBHOOK_TOKEN) return true
  const auth = req.headers.authorization ?? ''
  return auth === `Bearer ${WEBHOOK_TOKEN}`
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'notification-orchestrator',
      ingestionPath: '/v1/events/provisioning',
      webhookAuthEnabled: Boolean(WEBHOOK_TOKEN),
      bufferedMessages: messageStore.size(),
      now: orchestrator.currentIsoTime(),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/events/provisioning') {
    if (!hasValidBearerToken(req)) {
      sendJson(res, 401, { error: 'A valid bearer token is required.' })
      return
    }

    try {
      const body = await readJsonBody<unknown>(req)
      const result = await ingestProvisionerEvent(orchestrator, body)
      sendJson(res, result.accepted ? 202 : 400, result)
      return
    } catch (error) {
      sendJson(res, 400, {
        accepted: false,
        message: error instanceof Error ? error.message : 'Invalid webhook request.',
      })
      return
    }
  }

  sendJson(res, 404, { error: 'Not found.' })
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unhandled server error.',
    })
  })
})

server.listen(PORT, () => {
  console.log(`[notification-orchestrator] listening on :${PORT}`)
})
