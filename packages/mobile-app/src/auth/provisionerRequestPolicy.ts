export function isProvisionerRequest(targetUrl: string, provisionerUrl: string): boolean {
  try {
    return Boolean(provisionerUrl) && new URL(targetUrl).origin === new URL(provisionerUrl).origin
  } catch {
    return false
  }
}
