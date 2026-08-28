import { PodArchiveRestorer } from '../PodArchiveRestorer.js'
import type { PodArchiveEntry, PodArchiveManifest } from '../PodArchiveTypes.js'

const sourceRoot = 'https://alice.example/pod/'
const targetRoot = 'https://bob.example/pod/'
const jestGlobal = import.meta.jest

function manifest(): PodArchiveManifest {
  return {
    format: 'nodezero-solid-pod',
    formatVersion: 1,
    podUrl: sourceRoot,
    exportedAt: '2026-08-28T00:00:00.000Z',
    limits: { maxDepth: 16, maxResources: 10, maxResourceBytes: 100, maxTotalBytes: 1000, concurrency: 1 },
    resources: [{
      sourceUrl: `${sourceRoot}profile/card`,
      archivePath: 'pod/profile/card',
      mediaType: 'text/turtle',
      etag: '"profile-1"',
      size: 3,
      kind: 'resource',
      status: 'exported',
    }],
    warnings: [],
  }
}

function entry(): PodArchiveEntry {
  return {
    ...manifest().resources[0],
    bytes: new Uint8Array([1, 2, 3]),
  }
}

describe('Pod archive restorer', () => {
  it('dry-runs without issuing a write and remaps to the target Pod', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response(null, { status: 404 }))
    const report = await new PodArchiveRestorer({ fetch }).dryRun(targetRoot, manifest(), [entry()])
    expect(report).toMatchObject({ targetPodUrl: targetRoot, dryRun: true })
    expect(report.items[0]).toMatchObject({ targetUrl: `${targetRoot}profile/card`, action: 'create', status: 'planned' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(`${targetRoot}profile/card`, expect.objectContaining({ method: 'HEAD' }))
  })

  it('writes only after explicit dryRun false and preserves content type', async () => {
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    const report = await new PodArchiveRestorer({ fetch }, { dryRun: false }).restore(targetRoot, manifest(), [entry()])
    expect(report.items[0]).toMatchObject({ action: 'create', status: 'applied' })
    expect(fetch).toHaveBeenNthCalledWith(2, `${targetRoot}profile/card`, expect.objectContaining({
      method: 'PUT',
      headers: { 'content-type': 'text/turtle' },
      body: entry().bytes.slice().buffer,
    }))
  })

  it('skips ACL resources by default', async () => {
    const controlManifest = manifest()
    controlManifest.resources[0] = { ...controlManifest.resources[0], archivePath: 'pod/profile/card.acl', kind: 'acl', size: 3 }
    const controlEntry = { ...entry(), archivePath: 'pod/profile/card.acl', kind: 'acl' as const }
    const fetch = jestGlobal.fn()
    const report = await new PodArchiveRestorer({ fetch }).dryRun(targetRoot, controlManifest, [controlEntry])
    expect(report.items[0]).toMatchObject({ action: 'skip', status: 'planned', kind: 'acl' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('creates containers with the LDP BasicContainer link', async () => {
    const containerManifest = manifest()
    containerManifest.resources[0] = {
      ...containerManifest.resources[0],
      sourceUrl: `${sourceRoot}public/empty/`,
      archivePath: 'pod/public/empty/.container',
      mediaType: 'text/turtle',
      kind: 'container',
      size: 0,
    }
    const containerEntry = { ...entry(), ...containerManifest.resources[0], bytes: new Uint8Array() }
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }))
    const report = await new PodArchiveRestorer({ fetch }, { dryRun: false }).restore(targetRoot, containerManifest, [containerEntry])
    expect(report.items[0]).toMatchObject({ kind: 'container', status: 'applied' })
    expect(fetch).toHaveBeenNthCalledWith(2, `${targetRoot}public/empty/`, expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' }),
      body: '',
    }))
  })

  it('fails closed when overwrite-if-unchanged lacks matching ETags', async () => {
    const fetch = jestGlobal.fn().mockResolvedValue(new Response(null, { status: 200 }))
    const report = await new PodArchiveRestorer(
      { fetch },
      { conflictPolicy: 'overwrite-if-unchanged' },
    ).dryRun(targetRoot, manifest(), [entry()])
    expect(report.items[0]).toMatchObject({ action: 'conflict', status: 'failed' })
  })
})