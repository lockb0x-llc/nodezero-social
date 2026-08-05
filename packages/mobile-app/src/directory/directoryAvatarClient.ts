import { Buffer } from 'buffer'

const IMAGE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_AVATAR_BYTES = 512 * 1024

export async function readDirectoryAvatarDataUri(input: {
  provisionerUrl: string
  webId: string
  authFetch: typeof globalThis.fetch
}): Promise<string | null> {
  const baseUrl = input.provisionerUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) return null
  try {
    const response = await input.authFetch(`${baseUrl}/v1/community-directory/avatar`, {
      method: 'POST',
      headers: {
        accept: 'image/png,image/jpeg,image/webp,image/gif',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ webId: input.webId }),
    })
    if (!response.ok) return null
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase()
    if (!contentType || !IMAGE_CONTENT_TYPES.has(contentType)) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null
    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}
