export function deriveNameFromWebId(candidate: string): string {
  try {
    const parsed = new URL(candidate)
    const segment = parsed.pathname.split('/').filter(Boolean)[0]
    return segment || parsed.hostname
  } catch {
    return candidate
  }
}
