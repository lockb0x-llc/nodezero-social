import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export async function fetchExact(
  url,
  { outputPath, method = 'GET', body, headers = {}, timeoutMs = 20_000, fetchImpl = fetch } = {}
) {
  const expected = new URL(url)
  if (expected.protocol !== 'https:') throw new Error('Exact fetch requires HTTPS.')
  if (expected.username || expected.password || expected.hash) {
    throw new Error('Exact fetch URL must not contain credentials or a fragment.')
  }
  const response = await fetchImpl(expected.href, {
    method,
    body,
    headers: { 'cache-control': 'no-cache', ...headers },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status !== 200) {
    throw new Error(
      `Exact fetch expected HTTP 200 from ${expected.href}; received ${response.status}.`
    )
  }
  if (response.url !== expected.href) {
    throw new Error(
      `Exact fetch URL mismatch: expected ${expected.href}; received ${response.url}.`
    )
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (outputPath) await writeFile(outputPath, bytes)
  return bytes
}

function parseHeaders(value) {
  if (!value) return {}
  const parsed = JSON.parse(value)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('NZ_FETCH_HEADERS_JSON must be a JSON object.')
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([name, headerValue]) => [name, String(headerValue)])
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bytes = await fetchExact(process.argv[2], {
      outputPath: process.argv[3],
      method: process.env.NZ_FETCH_METHOD ?? 'GET',
      body: process.env.NZ_FETCH_BODY,
      headers: parseHeaders(process.env.NZ_FETCH_HEADERS_JSON),
      timeoutMs: Number.parseInt(process.env.NZ_FETCH_TIMEOUT_MS ?? '20000', 10),
    })
    if (!process.argv[3]) process.stdout.write(bytes)
  } catch (error) {
    console.error(`[fetch-exact] ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
