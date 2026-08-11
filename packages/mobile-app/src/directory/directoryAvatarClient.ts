import { Buffer } from 'buffer'

const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_AVATAR_BYTES = 512 * 1024
const AVATAR_READ_ATTEMPTS = 3
const AVATAR_RETRY_DELAY_MS = 500

export async function readDirectoryAvatarDataUri(input: {
  provisionerUrl: string
  webId: string
  authFetch: typeof globalThis.fetch
}): Promise<string | null> {
  const baseUrl = input.provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) return null
  for (let attempt = 1; attempt <= AVATAR_READ_ATTEMPTS; attempt += 1) {
    try {
      const response = await input.authFetch(`${baseUrl}/v1/community-directory/avatar`, {
        method: 'POST',
        headers: {
          accept: 'image/png,image/jpeg,image/webp,image/gif',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ webId: input.webId }),
      })
      if (response.ok) {
        const contentType = (response.headers.get('content-type') ?? '')
          .split(';')[0]
          ?.trim()
          .toLowerCase()
        if (!contentType || !IMAGE_CONTENT_TYPES.has(contentType)) return null
        const bytes = Buffer.from(await response.arrayBuffer())
        if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null
        return `data:${contentType};base64,${bytes.toString('base64')}`
      }
      if (response.status !== 404 && response.status !== 429 && response.status < 500) return null
    } catch {
      // Retry bounded transient transport failures below.
    }
    if (attempt < AVATAR_READ_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, AVATAR_RETRY_DELAY_MS))
    }
  }
  return null
}
