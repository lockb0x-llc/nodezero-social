import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ProvisionStore } from './store.js'
import { verifyAttestation } from './attestation.js'
import { createSolidAccount, writePodAccountDocument } from './solidAccount.js'
import type {
  BootstrapChallengeRequest,
  ProvisionRequest,
  ProvisionResult,
} from './types.js'

const PORT = Number(process.env.PORT ?? process.env.JSS_PROVISIONER_PORT ?? 8181)
const ISSUER = process.env.JSS_ISSUER_URL ?? 'https://staging.nodezero.social'
const SOLID_CSS_BASE_URL = (process.env.JSS_SOLID_CSS_BASE_URL ?? '').trim().replace(/\/+$/, '')
const LOCKBOX_FACTORY_CONTRACT_ID =
  process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''
const LOCKBOX_FACTORY_MODE = (process.env.JSS_LOCKBOX_FACTORY_MODE ?? 'mock').toLowerCase()
const ALLOWED_ORIGINS = (process.env.JSS_ALLOWED_ORIGINS ?? 'https://staging.nodezero.social,https://nodezero.social,https://www.nodezero.social,http://localhost:19006,http://localhost:8081')
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
      solidAccount: {
        configured: Boolean(SOLID_CSS_BASE_URL),
        cssBaseUrl: SOLID_CSS_BASE_URL || null,
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

  if (req.method === 'POST' && url.pathname === '/v1/solid-account') {
    if (!SOLID_CSS_BASE_URL) {
      sendJson(req, res, 503, { error: 'Solid account provisioning is not configured (JSS_SOLID_CSS_BASE_URL).' })
      return
    }

    const body = await readJsonBody<{ name?: string; email?: string; password?: string; stellarPublicKey?: string }>(req)
    if (!isNonEmpty(body.name)) {
      sendJson(req, res, 400, { error: 'name is required.' })
      return
    }
    if (!isNonEmpty(body.email)) {
      sendJson(req, res, 400, { error: 'email is required.' })
      return
    }
    if (!isNonEmpty(body.password)) {
      sendJson(req, res, 400, { error: 'password is required.' })
      return
    }

    // Fail-closed: seamless onboarding must anchor the WebID<->Stellar pairing
    // in a per-user lockb0x on-chain, which requires the member's Stellar public
    // key. Reject requests that omit it so an un-anchored account can never be
    // created (previously a missing key silently skipped lockbox provisioning).
    if (!isNonEmpty(body.stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey is required.' })
      return
    }

    const stellarPublicKey = body.stellarPublicKey.trim()
    if (!/^G[A-Z2-7]{55}$/.test(stellarPublicKey)) {
      sendJson(req, res, 400, { error: 'stellarPublicKey must be a valid Stellar public key (G...).' })
      return
    }

    const normalizedName = body.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!normalizedName) {
      sendJson(req, res, 400, { error: 'name must contain alphanumeric characters.' })
      return
    }

    try {
      const account = await createSolidAccount(SOLID_CSS_BASE_URL, {
        name: normalizedName,
        email: body.email.trim(),
        password: body.password,
      })

      // Optionally anchor the WebID<->Stellar pairing in a per-user lockb0x.
      // Requested by supplying stellarPublicKey; fail-closed when requested.
      let lockbox: Awaited<ReturnType<typeof store.provisionLockbox>> | undefined
      if (stellarPublicKey) {
        const podBindingHash = createHash('sha256')
          .update(`${account.webId}|${stellarPublicKey}`)
          .digest('hex')
        const proofRootHex = createHash('sha256')
          .update(`NZ_POD_PAIR_V1|${account.webId}|${stellarPublicKey}|${account.podUrl}`)
          .digest('hex')
        lockbox = await store.provisionLockbox({
          webId: account.webId,
          stellarPublicKey,
          podBindingHash,
          proofRootHex,
        })
        if (lockbox.status !== 'ready' || !lockbox.userLockboxContractId) {
          sendJson(req, res, 502, {
            error: lockbox.error ?? 'Per-user lockb0x anchoring failed.',
            webId: account.webId,
            podUrl: account.podUrl,
          })
          return
        }
      }

      // Persist the account profile (WebID <-> Stellar pairing + on-chain
      // lockb0x references) into the user's own Pod, so the data lives with the
      // user from creation. Best-effort: the on-chain lockb0x remains the source
      // of truth, so a transient Pod write failure does not fail onboarding.
      const accountRecord = {
        version: 1,
        type: 'nodezero-account',
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey: stellarPublicKey || null,
        issuer: ISSUER,
        envProfile: process.env.NZ_ENV_PROFILE ?? 'local',
        lockbox: lockbox
          ? {
              userLockboxContractId: lockbox.userLockboxContractId,
              factoryContractId: lockbox.factoryContractId,
              proofRootHex: lockbox.proofRootHex,
            }
          : null,
        createdAt: new Date().toISOString(),
      }
      let accountDocumentUrl: string | null = null
      try {
        accountDocumentUrl = await writePodAccountDocument(
          SOLID_CSS_BASE_URL,
          { id: account.clientCredentialsId, secret: account.clientCredentialsSecret },
          account.podUrl,
          accountRecord,
        )
      } catch (writeErr) {
        // Surface in logs but do not fail onboarding; the lockb0x is authoritative.
        console.warn('[solid-account] Pod account document write failed:', writeErr)
      }

      sendJson(req, res, 200, {
        status: 'ready',
        webId: account.webId,
        podUrl: account.podUrl,
        stellarPublicKey: stellarPublicKey || null,
        accountDocumentUrl,
        clientCredentials: {
          id: account.clientCredentialsId,
          secret: account.clientCredentialsSecret,
          resource: account.clientCredentialsResource,
        },
        lockbox: lockbox ?? null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Solid account provisioning failed.'
      sendJson(req, res, 502, { error: message })
    }
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

      if (
        lockbox.status !== 'ready' ||
        lockbox.mode !== 'soroban' ||
        !lockbox.userLockboxContractId
      ) {
        throw new Error(lockbox.error ?? 'Per-user lockbox provisioning failed.')
      }

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
