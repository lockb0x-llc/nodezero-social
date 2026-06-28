import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ProvisionStore } from './store.js'
import { verifyAttestation } from './attestation.js'
import type {
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionResult,
} from './types.js'

const PORT = Number(process.env.JSS_PROVISIONER_PORT ?? 8181)
const ISSUER = process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
const store = new ProvisionStore()

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    throw new Error('Request body is required.')
  }
  return JSON.parse(raw) as T
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateChallengeRequest(body: BootstrapChallengeRequest): void {
  if (!isNonEmpty(body.handle)) throw new Error('handle is required.')
  if (!isNonEmpty(body.webId)) throw new Error('webId is required.')
  if (!isNonEmpty(body.podUrl)) throw new Error('podUrl is required.')
}

function validateProvisionRequest(body: ProvisionRequest): void {
  if (!isNonEmpty(body.handle)) throw new Error('handle is required.')
  if (!isNonEmpty(body.podSlug)) throw new Error('podSlug is required.')
  if (!isNonEmpty(body.webId)) throw new Error('webId is required.')
  if (!isNonEmpty(body.podUrl)) throw new Error('podUrl is required.')
  if (!isNonEmpty(body.stellarPublicKey)) throw new Error('stellarPublicKey is required.')
  if (!isNonEmpty(body.challengeId)) throw new Error('challengeId is required.')
  if (!isNonEmpty(body.signatureBase64)) throw new Error('signatureBase64 is required.')
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'jss-provisioner',
      envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
      issuer: ISSUER,
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/bootstrap-challenge') {
    const body = await readJsonBody<BootstrapChallengeRequest>(req)
    validateChallengeRequest(body)
    const challenge = store.issueChallenge(body)
    sendJson(res, 200, challenge)
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/provision') {
    const body = await readJsonBody<ProvisionRequest>(req)
    validateProvisionRequest(body)

    const challenge = store.consumeChallenge(body.challengeId)
    if (!challenge) {
      sendJson(res, 400, { error: 'Challenge is invalid or expired.' })
      return
    }

    const jobId = store.createPendingJob(body)

    try {
      const receipt = verifyAttestation(body, challenge)
      store.resolveJob(jobId, {
        handle: body.handle.trim(),
        webId: body.webId.trim(),
        podUrl: body.podUrl.trim(),
        issuer: ISSUER,
        stellarPublicKey: body.stellarPublicKey.trim(),
        challengeId: challenge.challengeId,
      })

      const result: ProvisionResult = {
        status: 'ready',
        jobId,
      }

      sendJson(res, 200, {
        ...result,
        challengeMessage: receipt.challengeMessage,
        podBindingHash: receipt.podBindingHash,
      })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provisioning verification failed.'
      store.failJob(jobId, message)
      sendJson(res, 400, { error: message, jobId })
      return
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/provision/')) {
    const jobId = url.pathname.replace('/v1/provision/', '').trim()
    if (!jobId) {
      sendJson(res, 400, { error: 'Missing jobId.' })
      return
    }

    const status = store.getJob(jobId)
    if (!status) {
      sendJson(res, 404, { error: 'Provision job not found.' })
      return
    }

    sendJson(res, 200, status)
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const server = createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unhandled server error.'
    sendJson(res, 500, { error: message })
  })
})

server.listen(PORT, () => {
  console.log(`[jss-provisioner] listening on :${PORT}`)
})
