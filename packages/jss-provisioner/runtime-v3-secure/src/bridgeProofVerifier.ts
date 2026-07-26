import * as snarkjs from 'snarkjs'

interface BridgeProof {
  pi_a: [string, string, string]
  pi_b: [[string, string], [string, string], [string, string]]
  pi_c: [string, string, string]
  protocol: 'groth16'
  curve: 'bn128'
}

let verificationKeyCache: Promise<unknown> | null = null

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

async function getVerificationKey(url: string): Promise<unknown> {
  if (!verificationKeyCache) {
    verificationKeyCache = (async () => {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      if (!response.ok) {
        throw new Error(`Bridge verification key fetch failed (${response.status}).`)
      }
      return response.json()
    })()
  }

  try {
    return await verificationKeyCache
  } catch (error) {
    verificationKeyCache = null
    throw error
  }
}

export async function verifyBridgeProof(input: {
  proofHex: string
  publicSignals: [string, string, string]
  verificationKeyUrl: string
}): Promise<void> {
  if (!input.verificationKeyUrl) {
    throw new Error('JSS_LOCKBOX_BRIDGE_V3_VK_URL is required for Factory V3 proof verification.')
  }

  const proof = deserializeProof(input.proofHex)
  const verificationKey = await getVerificationKey(input.verificationKeyUrl)
  const valid = await snarkjs.groth16.verify(verificationKey, input.publicSignals, proof)
  if (!valid) {
    throw new Error('Lockb0x Bridge V3 Groth16 proof verification failed.')
  }
}