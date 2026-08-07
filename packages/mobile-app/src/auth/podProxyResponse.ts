export function exposeLogicalResponseUrl(response: Response, logicalUrl: string): Response {
  if (!logicalUrl || response.url === logicalUrl) return response

  Object.defineProperty(response, 'url', {
    configurable: true,
    value: logicalUrl,
  })
  return response
}
