import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ProvisionStore } from './store.js'
import { verifyAttestation } from './attestation.js'
import type {
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionResult,
} from './types.js'

const PORT = Number(process.env.PORT ?? process.env.JSS_PROVISIONER_PORT ?? 8181)
const ISSUER = process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
const LOCKBOX_FACTORY_CONTRACT_ID =
  process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''
const LOCKBOX_FACTORY_MODE = (process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock').toLowerCase()
const ALLOWED_ORIGINS = (process.env.JSS_ALLOWED_ORIGINS ?? 'https://staging.nodezero.social,http://localhost:19006,http://localhost:8081')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0)
const store = new ProvisionStore()

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? '*'

  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'origin',
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    'content-type': 'application/json; charset=utf-8',
  })
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
  if (!isNonEmpty(body.identityContractId)) throw new Error('identityContractId is required.')
  if (!isNonEmpty(body.lockboxFactoryContractId)) throw new Error('lockboxFactoryContractId is required.')
  if (!isNonEmpty(body.challengeId)) throw new Error('challengeId is required.')
  if (!isNonEmpty(body.signatureBase64)) throw new Error('signatureBase64 is required.')
  if (body.proofVersion !== 1) throw new Error('proofVersion=1 is required.')
  if (!isNonEmpty(body.claimHash)) throw new Error('claimHash is required.')
  if (!isNonEmpty(body.proofHex)) throw new Error('proofHex is required.')
  if (!isNonEmpty(body.proofHashHex)) throw new Error('proofHashHex is required.')
  if (!isNonEmpty(body.proofRootHex)) throw new Error('proofRootHex is required.')
  if (!Array.isArray(body.publicSignals)) throw new Error('publicSignals is required.')
}

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(req, res, 200, {
      ok: true,
      service: 'jss-provisioner',
      envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
      issuer: ISSUER,
      lockboxFactory: {
        mode: LOCKBOX_FACTORY_MODE,
        contractId: LOCKBOX_FACTORY_CONTRACT_ID || null,
      },
      uptimeMs: Math.round(process.uptime() * 1000),
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/bootstrap-challenge') {
    const body = await readJsonBody<BootstrapChallengeRequest>(req)
    validateChallengeRequest(body)
    const challenge = store.issueChallenge(body)
    sendJson(req, res, 200, challenge)
    return
  }

  if (req.method === 'POST' && url.pathname === '/v1/provision') {
    const body = await readJsonBody<ProvisionRequest>(req)
    validateProvisionRequest(body)

    const challenge = store.consumeChallenge(body.challengeId)
    if (!challenge) {
      sendJson(req, res, 400, { error: 'Challenge is invalid or expired.' })
      return
    }

    const jobId = store.createPendingJob()

    try {
      const receipt = verifyAttestation(body, challenge)
      const lockbox = await store.provisionLockbox({
        webId: body.webId,
        stellarPublicKey: body.stellarPublicKey,
        podBindingHash: receipt.podBindingHash,
        proofRootHex: receipt.proofRootHex,
      })

      store.resolveJob(jobId, {
        handle: body.handle.trim(),
        webId: body.webId.trim(),
        podUrl: body.podUrl.trim(),
        issuer: ISSUER,
        stellarPublicKey: body.stellarPublicKey.trim(),
        challengeId: challenge.challengeId,
        claimHash: receipt.claimHash,
        proofHashHex: receipt.proofHashHex,
        proofRootHex: receipt.proofRootHex,
        lockbox,
      })

      const result: ProvisionResult = {
        status: 'ready',
        jobId,
        lockbox,
      }

      sendJson(req, res, 200, {
        ...result,
        challengeMessage: receipt.challengeMessage,
        podBindingHash: receipt.podBindingHash,
        canonicalClaim: receipt.canonicalClaim,
        claimHash: receipt.claimHash,
        proofHashHex: receipt.proofHashHex,
        proofRootHex: receipt.proofRootHex,
      })
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Provisioning verification failed.'
      store.failJob(jobId, message)
      sendJson(req, res, 400, { error: message, jobId })
      return
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/v1/provision/')) {
    const jobId = url.pathname.replace('/v1/provision/', '').trim()
    if (!jobId) {
      sendJson(req, res, 400, { error: 'Missing jobId.' })
      return
    }

    const status = store.getJob(jobId)
    if (!status) {
      sendJson(req, res, 404, { error: 'Provision job not found.' })
      return
    }

    sendJson(req, res, 200, status)
    return
  }

  sendJson(req, res, 404, { error: 'Not found' })
}

const server = createServer((req, res) => {
  handleHttpRequest(req, res).catch((err) => {
    const message = err instanceof Error ? err.message : 'Unhandled server error.'
    sendJson(req, res, 500, { error: message })
  })
})

server.listen(PORT, () => {
  console.log(`[jss-provisioner] listening on :${PORT}`)
})
