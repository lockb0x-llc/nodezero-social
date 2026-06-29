import crypto from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STELLAR_ACCOUNT_VERSION_BYTE = 6 << 3
const SNARK_FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

function crc16Xmodem(payload) {
  let crc = 0x0000
  for (const byte of payload) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i += 1) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff
      } else {
        crc = (crc << 1) & 0xffff
      }
    }
  }
  return crc
}

function encodeBase32(bytes) {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }

  return output
}

function toStellarPublicKey(raw32) {
  const payload = Buffer.concat([Buffer.from([STELLAR_ACCOUNT_VERSION_BYTE]), raw32])
  const checksum = crc16Xmodem(payload)
  const check = Buffer.from([checksum & 0xff, (checksum >> 8) & 0xff])
  return encodeBase32(Buffer.concat([payload, check]))
}

function challengeMessage(challenge) {
  return [
    'NZ_ATTEST_V1',
    challenge.domain,
    challenge.envProfile,
    challenge.nonce,
    challenge.expiresAt,
    challenge.handle,
    challenge.webId,
    challenge.podUrl,
  ].join('|')
}

function canonicalPodUrl(value) {
  const trimmed = value.trim()
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function podOwnershipClaim({ challenge, stellarPublicKey, identityContractId, lockboxFactoryContractId }) {
  return [
    'NZ_POD_OWNER_V1',
    challenge.envProfile.trim(),
    (process.env.JSS_STELLAR_NETWORK_PASSPHRASE ??
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ??
      'Test SDF Network ; September 2015').trim(),
    challenge.webId.trim(),
    canonicalPodUrl(challenge.podUrl),
    stellarPublicKey.trim(),
    identityContractId.trim(),
    lockboxFactoryContractId.trim(),
    challenge.challengeId.trim(),
    challenge.nonce.trim(),
    challenge.expiresAt.trim(),
  ].join('|')
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function fieldHash(value) {
  return (BigInt(`0x${sha256Hex(value)}`) % SNARK_FIELD_SIZE).toString()
}

function publicSignalBytes(signal) {
  return Buffer.from(BigInt(signal).toString(16).padStart(64, '0'), 'hex')
}

function proofPayload(canonicalClaim) {
  const claimHash = fieldHash(canonicalClaim)
  const publicSignals = [claimHash, '1', '2']
  const proofBytes = Buffer.alloc(256, 7)
  const proofHashHex = sha256Hex(Buffer.concat([proofBytes, ...publicSignals.map(publicSignalBytes)]))
  const proofRootHex = sha256Hex(`${canonicalClaim}|${proofHashHex}`)
  return {
    proofVersion: 1,
    claimHash,
    proofHex: proofBytes.toString('hex'),
    proofHashHex,
    proofRootHex,
    publicSignals,
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`POST ${url} failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json
}

async function getJson(url) {
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) {
    throw new Error(`GET ${url} failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json
}

async function main() {
  const base = process.env.JSS_PROVISIONER_URL ?? 'https://nodezero-social-staging-testnet-provisioner.azurewebsites.net'
  const identityContractId = process.env.NZ_IDENTITY_CONTRACT_ID ?? process.env.JSS_IDENTITY_CONTRACT_ID ?? 'smoke-identity-contract'
  const lockboxFactoryContractId =
    process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? process.env.JSS_LOCKBOX_FACTORY_CONTRACT_ID ?? 'smoke-lockbox-factory'
  const now = Date.now()
  const handle = `stage-smoke-${now}`
  const webId = `https://${handle}.example/profile/card#me`
  const podUrl = `https://${handle}.example/`

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const rawPublicKey = spki.subarray(-32)
  const stellarPublicKey = toStellarPublicKey(rawPublicKey)

  const challenge = await postJson(`${base}/v1/bootstrap-challenge`, {
    handle,
    webId,
    podUrl,
  })

  const signature = crypto.sign(null, Buffer.from(challengeMessage(challenge), 'utf8'), privateKey)
  const canonicalClaim = podOwnershipClaim({
    challenge,
    stellarPublicKey,
    identityContractId,
    lockboxFactoryContractId,
  })
  const proof = proofPayload(canonicalClaim)

  const provision = await postJson(`${base}/v1/provision`, {
    handle,
    podSlug: handle,
    webId,
    podUrl,
    stellarPublicKey,
    identityContractId,
    lockboxFactoryContractId,
    challengeId: challenge.challengeId,
    signatureBase64: signature.toString('base64'),
    ...proof,
  })

  const status = await getJson(`${base}/v1/provision/${provision.jobId}`)
  const receipt = status.custodyReceipt ?? {}
  if (receipt.proofRootHex !== proof.proofRootHex) {
    throw new Error(`Provision receipt proof root mismatch: expected ${proof.proofRootHex}, got ${receipt.proofRootHex}`)
  }
  if (status.lockbox?.proofRootHex && status.lockbox.proofRootHex !== proof.proofRootHex) {
    throw new Error(`Lockbox proof root mismatch: expected ${proof.proofRootHex}, got ${status.lockbox.proofRootHex}`)
  }

  console.log(
    JSON.stringify(
      {
        challengeId: challenge.challengeId,
        jobId: provision.jobId,
        provisionLockbox: provision.lockbox ?? null,
        statusLockbox: status.lockbox ?? null,
        proofRootHex: proof.proofRootHex,
        receiptProofRootHex: receipt.proofRootHex ?? null,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
