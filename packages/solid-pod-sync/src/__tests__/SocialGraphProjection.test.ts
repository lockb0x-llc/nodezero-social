import { SocialGraph } from '../SocialGraph.js'

const jestGlobal = import.meta.jest
const owner = 'https://alice.example/profile/card#me'
const peer = 'https://bob.example/profile/card#me'
const datasetUrl = 'https://alice.example/social/connections'
const customPredicate = 'https://example.test/ns#custom'

function dataset(knows = ''): string {
  return `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${owner}> a foaf:Person ;
      <${customPredicate}> "preserve-me" ${knows ? `; foaf:knows <${knows}>` : ''} .
  `
}

function response(body: string): Response {
  const result = new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/turtle' },
  })
  Object.defineProperty(result, 'url', { value: datasetUrl })
  return result
}

describe('SocialGraph FOAF compatibility projection', () => {
  it('preserves unrelated owner predicates while adding foaf:knows', async () => {
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(response(dataset()))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const graph = new SocialGraph({ fetch })

    await graph.addConnection('https://alice.example/', peer)

    const patch = String(fetch.mock.calls[1]?.[1]?.body)
    expect(patch).toContain(`<${peer}>`)
    expect(patch).not.toContain(`<${customPredicate}>`)
  })

  it('preserves unrelated owner predicates while removing the final foaf:knows', async () => {
    const fetch = jestGlobal.fn()
      .mockResolvedValueOnce(response(dataset(peer)))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
    const graph = new SocialGraph({ fetch })

    await graph.removeConnection('https://alice.example/', peer)

    const patch = String(fetch.mock.calls[1]?.[1]?.body)
    expect(patch).toContain(`<http://xmlns.com/foaf/0.1/knows> <${peer}>`)
    expect(patch).not.toContain(`<${customPredicate}>`)
  })
})
