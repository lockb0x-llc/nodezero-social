import { PodArchiveExporter } from '../PodArchiveExporter.js'
import { parseContainedResourceUrls } from '../PodContainerParser.js'
import { archivePathForResource, canonicalizePodResource } from '../PodResourcePath.js'

const root = 'https://alice.example/pod/'

function response(body: string | Uint8Array, contentType: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType, ...headers } })
}

describe('Pod archive exporter', () => {
  it('parses container IRIs containing periods and sorts them', () => {
    const body = `@prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${root}> ldp:contains <${root}public/a.bin>, <${root}public/nested/> .`
    expect(parseContainedResourceUrls(new TextEncoder().encode(body), 'text/turtle', root))
      .toEqual([`${root}public/a.bin`, `${root}public/nested/`])
  })

  it('walks nested containers and preserves binary bytes', async () => {
    const nested = `${root}public/nested/`
    const binary = `${nested}photo.bin`
    const resources = new Map<string, Response>([
      [root, response(`@prefix ldp: <http://www.w3.org/ns/ldp#> . <${root}> ldp:contains <${nested}> .`, 'text/turtle', { etag: '"root-1"' })],
      [nested, response(`@prefix ldp: <http://www.w3.org/ns/ldp#> . <${nested}> ldp:contains <${binary}> .`, 'text/turtle')],
      [binary, response(new Uint8Array([0, 255, 1]), 'application/octet-stream')],
    ])
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      return resources.get(url)?.clone() ?? new Response(null, { status: 404 })
    }
    const result = await new PodArchiveExporter({ fetch }).export(root)
    expect(result.entries.map((entry) => entry.archivePath)).toEqual([
      'pod/.container',
      'pod/public/nested/.container',
      'pod/public/nested/photo.bin',
    ])
    expect([...result.entries[2].bytes]).toEqual([0, 255, 1])
    expect(result.manifest.resources[0]).toMatchObject({ etag: '"root-1"', kind: 'container' })
  })

  it('records failed resources and enforces total size', async () => {
    const child = `${root}child.txt`
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === root) return response(`@prefix ldp: <http://www.w3.org/ns/ldp#> . <${root}> ldp:contains <${child}> .`, 'text/turtle')
      return new Response('missing', { status: 403 })
    }
    const result = await new PodArchiveExporter({ fetch }).export(root)
    expect(result.manifest.resources).toContainEqual(expect.objectContaining({ sourceUrl: child, status: 'failed' }))

    const oversizedFetch = async (): Promise<Response> => response(new Uint8Array([1, 2, 3]), 'application/octet-stream')
    await expect(new PodArchiveExporter({ fetch: oversizedFetch }, { maxTotalBytes: 2 }).export(root))
      .rejects.toMatchObject({ code: 'pod_total_size' })
  })

  it('rejects resources outside the authenticated namespace', () => {
    expect(() => canonicalizePodResource(root, 'https://mallory.example/pod/secret'))
      .toThrow('outside the authenticated Pod namespace')
    expect(archivePathForResource(root, `${root}public/file.txt`)).toBe('pod/public/file.txt')
  })

  it('preserves empty containers using LDP response metadata', async () => {
    const empty = `${root}empty/`
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === root) return response(`@prefix ldp: <http://www.w3.org/ns/ldp#> . <${root}> ldp:contains <${empty}> .`, 'text/turtle')
      return response('@prefix ldp: <http://www.w3.org/ns/ldp#> .', 'text/turtle', {
        link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"',
      })
    }
    const result = await new PodArchiveExporter({ fetch }).export(root)
    expect(result.entries).toContainEqual(expect.objectContaining({ sourceUrl: empty, kind: 'container', archivePath: 'pod/empty/.container' }))
  })

  it('records invalid children and enforces size for non-streaming responses', async () => {
    const external = 'https://mallory.example/secret'
    const fetch = async (input: string | URL | Request): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url === root) return response(`@prefix ldp: <http://www.w3.org/ns/ldp#> . <${root}> ldp:contains <${external}> .`, 'text/turtle')
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': '3' } })
    }
    const result = await new PodArchiveExporter({ fetch }, { maxResourceBytes: 1000 }).export(root)
    expect(result.manifest.warnings.join(' ')).toContain('outside the authenticated Pod namespace')
    expect(result.manifest.resources).toContainEqual(expect.objectContaining({ sourceUrl: external, status: 'failed' }))

    const oversized = await new PodArchiveExporter({ fetch: async (): Promise<Response> => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } }) }, { maxResourceBytes: 2 }).export(root)
    expect(oversized.manifest.warnings.join(' ')).toContain('Resource exceeds 2 bytes')
  })
})