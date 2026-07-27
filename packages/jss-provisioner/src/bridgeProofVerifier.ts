import * as snarkjs from 'snarkjs'
import { createHash } from 'node:crypto'

interface BridgeProof {
  pi_a: [string, string, string]
  pi_b: [[string, string], [string, string], [string, string]]
  pi_c: [string, string, string]
  protocol: 'groth16'
  curve: 'bn128'
}

const verificationKeyCache = new Map<string, Promise<unknown>>()

function fieldAt(bytes: Buffer, offset: number): string {
  return BigInt(`0x${bytes.subarray(offset, offset + 32).toString('hex')}`).toString()
}

function deserializeProof(proofHex: string): BridgeProof {
  const bytes = Buffer.from(proofHex, 'hex')
  if (bytes.length !== 256) {
    throw new Error('Bridge proof must contain 256 serialized bytes.')
  }

  return {
    pi_a: [fieldAt(bytes, 0), fieldAt(bytes, 32), '1'],
    pi_b: [
      [fieldAt(bytes, 64), fieldAt(bytes, 96)],
      [fieldAt(bytes, 128), fieldAt(bytes, 160)],
      ['1', '0'],
    ],
    pi_c: [fieldAt(bytes, 192), fieldAt(bytes, 224), '1'],
    protocol: 'groth16',
    curve: 'bn128',
  }
}

async function getVerificationKey(url: string, expectedSha256: string): Promise<unknown> {
  const cacheKey = `${url}|${expectedSha256}`
  if (!verificationKeyCache.has(cacheKey)) {
    verificationKeyCache.set(cacheKey, (async (): Promise<unknown> => {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Bridge verification key fetch failed (${response.status}).`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      const actualSha256 = createHash('sha256').update(bytes).digest('hex')
      if (actualSha256 !== expectedSha256) {
        throw new Error('Bridge verification key digest does not match the active onboarding configuration.')
      }
      return JSON.parse(bytes.toString('utf8')) as unknown
    })())
  }

  try {
    return await verificationKeyCache.get(cacheKey)!
  } catch (error) {
    verificationKeyCache.delete(cacheKey)
    throw error
  }
}

export async function verifyBridgeProof(input: {
  proofHex: string
  publicSignals: [string, string, string]
  verificationKeyUrl: string
  verificationKeySha256: string
}): Promise<void> {
  if (!input.verificationKeyUrl) {
    throw new Error('JSS_LOCKBOX_BRIDGE_V3_VK_URL is required for Factory V3 proof verification.')
  }
  if (!/^[0-9a-f]{64}$/.test(input.verificationKeySha256)) {
    throw new Error('JSS_LOCKBOX_BRIDGE_V3_VK_SHA256 is required for Factory V3 proof verification.')
  }

  const proof = deserializeProof(input.proofHex)
  const verificationKey = await getVerificationKey(
    input.verificationKeyUrl,
    input.verificationKeySha256,
  )
  const valid = await snarkjs.groth16.verify(verificationKey, input.publicSignals, proof)
  if (!valid) {
    throw new Error('Lockb0x Bridge V3 Groth16 proof verification failed.')
  }
}