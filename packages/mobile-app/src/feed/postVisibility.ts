import { hasNsfwSignals } from '../content/nsfwDecision'

export interface VisibilityAuthorMetadata {
  authorWebId: string
  externalUrl?: string
  avatarUrl?: string
}

export function collectNsfwAuthors(metadata: VisibilityAuthorMetadata[]): Set<string> {
  const nsfwAuthors = new Set<string>()
  for (const entry of metadata) {
    if (hasNsfwSignals(entry)) {
      nsfwAuthors.add(entry.authorWebId)
    }
  }

  return nsfwAuthors
}

export function filterVisiblePosts<T extends { authorWebId: string }>(
  posts: T[],
  showNsfw: boolean,
  nsfwAuthors: Set<string>
): T[] {
  if (showNsfw) return posts
  return posts.filter((post) => !nsfwAuthors.has(post.authorWebId))
}
