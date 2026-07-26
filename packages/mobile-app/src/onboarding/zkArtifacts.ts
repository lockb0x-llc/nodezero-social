/**
 * @module onboarding/zkArtifacts
 *
 * Shared manifest-driven resolution of the published ZK proving artifacts
 * (pod_ownership wasm + zkey). Both the custody-provisioning flow
 * (WalletContext) and the seamless onboarding attestation flow use this so
 * artifact paths always come from the published manifest instead of
 * hardcoded filenames — path drift in the artifact bundle cannot silently
 * break proof generation.
 */

export interface ZkArtifactManifest {
  artifacts?: Array<{ file: string }>
}

export interface PodOwnershipArtifactPaths {
  wasmPath: string
  zkeyPath: string
}

export type BridgeCircuitVersion = 2 | 3

export type ZkArtifactResolutionErrorCode =
  | 'manifest-fetch-failed'
  | 'manifest-invalid'
  | 'artifact-missing'

export class ZkArtifactResolutionError extends Error {
  readonly code: ZkArtifactResolutionErrorCode

  constructor(code: ZkArtifactResolutionErrorCode, message: string) {
    super(message)
    this.name = 'ZkArtifactResolutionError'
    this.code = code
  }
}

function joinUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${filePath.replace(/^packages\/zk-crypto\/build\//, '')}`
}

/**
 * Fetches the ZK artifact manifest and resolves the absolute URLs of the
 * pod_ownership proving artifacts. Throws {@link ZkArtifactResolutionError}
 * with a typed code when the manifest is unreachable, malformed, or missing
 * the required entries.
 */
export async function resolvePodOwnershipArtifacts(params: {
  zkArtifactsUrl: string
  zkManifestUrl: string
  circuitVersion?: BridgeCircuitVersion
}): Promise<PodOwnershipArtifactPaths> {
  const manifestResponse = await fetch(params.zkManifestUrl)
  if (!manifestResponse.ok) {
    throw new ZkArtifactResolutionError(
      'manifest-fetch-failed',
      `Unable to load ZK artifact manifest (${manifestResponse.status}).`,
    )
  }

  let manifest: ZkArtifactManifest
  try {
    manifest = (await manifestResponse.json()) as ZkArtifactManifest
  } catch {
    throw new ZkArtifactResolutionError(
      'manifest-invalid',
      'ZK artifact manifest is not valid JSON.',
    )
  }

  const artifacts = manifest.artifacts ?? []
  const v3 = params.circuitVersion === 3
  const wasmSuffix = v3
    ? 'pod_stellar_bridge_v3_js/pod_stellar_bridge_v3.wasm'
    : 'pod_ownership_js/pod_ownership.wasm'
  const zkeySuffix = v3
    ? 'pod_stellar_bridge_v3_final.zkey'
    : 'pod_ownership_final.zkey'
  const wasm = artifacts.find((artifact) => artifact.file.endsWith(wasmSuffix))
  const zkey = artifacts.find((artifact) => artifact.file.endsWith(zkeySuffix))
  if (!wasm || !zkey) {
    throw new ZkArtifactResolutionError(
      'artifact-missing',
      `${v3 ? 'Lockb0x Bridge V3' : 'Pod ownership'} proving artifacts are missing from the ZK manifest.`,
    )
  }

  return {
    wasmPath: joinUrl(params.zkArtifactsUrl, wasm.file),
    zkeyPath: joinUrl(params.zkArtifactsUrl, zkey.file),
  }
}
