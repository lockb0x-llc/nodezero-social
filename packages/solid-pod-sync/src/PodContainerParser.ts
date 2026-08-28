const LDP_CONTAINS = 'http://www.w3.org/ns/ldp#contains'

export function parseContainedResourceUrls(
  representation: Uint8Array,
  mediaType: string,
  containerUrl: string,
): string[] {
  const normalizedType = mediaType.split(';')[0]?.trim().toLowerCase() ?? ''
  const text = new TextDecoder().decode(representation)
  const candidates = normalizedType === 'application/ld+json'
    ? parseJsonLd(text)
    : parseTurtle(text)
  const urls = new Set<string>()
  for (const candidate of candidates) {
    try {
      urls.add(new URL(candidate, containerUrl).toString())
    } catch {
      // Ignore malformed RDF IRIs; the containing resource remains exportable.
    }
  }
  return [...urls].sort((left, right) => left.localeCompare(right))
}

function parseJsonLd(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    const results: string[] = []
    collectJsonLdContains(value, results)
    return results
  } catch {
    return []
  }
}

function collectJsonLdContains(value: unknown, results: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonLdContains(entry, results))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key === LDP_CONTAINS || key === 'ldp:contains' || key.endsWith('#contains')) {
      collectJsonLdValues(child, results)
    } else {
      collectJsonLdContains(child, results)
    }
  }
}

function collectJsonLdValues(value: unknown, results: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonLdValues(entry, results))
  } else if (value && typeof value === 'object' && typeof (value as { '@id'?: unknown })['@id'] === 'string') {
    results.push((value as { '@id': string })['@id'])
  } else if (typeof value === 'string') {
    results.push(value)
  }
}

function parseTurtle(text: string): string[] {
  const results: string[] = []
  for (const statement of splitTurtleStatements(text)) {
    if (!new RegExp(`(?:<${LDP_CONTAINS}>|ldp:contains)`).test(statement)) continue
    const predicateIndex = statement.search(new RegExp(`(?:<${LDP_CONTAINS}>|ldp:contains)`))
    for (const match of statement.slice(predicateIndex).matchAll(/<([^>]+)>/g)) {
      if (match[1]) results.push(match[1])
    }
  }
  return results
}

function splitTurtleStatements(source: string): string[] {
  const statements: string[] = []
  let start = 0
  let inIri = false
  let quote: '"' | "'" | null = null
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (inIri) {
      if (character === '>') inIri = false
      continue
    }
    if (character === '<') inIri = true
    else if (character === '"' || character === "'") quote = character
    else if (character === '.') {
      statements.push(source.slice(start, index))
      start = index + 1
    }
  }
  if (source.slice(start).trim()) statements.push(source.slice(start))
  return statements
}