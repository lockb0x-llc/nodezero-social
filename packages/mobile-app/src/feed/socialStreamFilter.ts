/**
 * Feed must show only broadcast/social posts, never DocuStream's curated
 * RSS/Reddit/X ingestion, which shares the same Pod container and manager.
 */
export function filterSocialStreamItems<T extends { source: string }>(items: T[]): T[] {
  return items.filter((item) => item.source === 'nodezero')
}
