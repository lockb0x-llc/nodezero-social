export function canonicalizePodRoot(podUrl: string): string {
  const parsed = new URL(podUrl)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Pod URL must use HTTP or HTTPS.')
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Pod URL must not contain a query string or fragment.')
  }
  parsed.pathname = parsed.pathname.replace(/\/+/g, '/')
  if (!parsed.pathname.endsWith('/')) parsed.pathname += '/'
  return parsed.toString()
}

export function canonicalizePodResource(podRoot: string, resourceUrl: string): string {
  const root = new URL(canonicalizePodRoot(podRoot))
  const resource = new URL(resourceUrl, root)
  if (resource.origin !== root.origin || !isWithinPath(root.pathname, resource.pathname)) {
    throw new Error(`Pod resource is outside the authenticated Pod namespace: ${resourceUrl}`)
  }
  resource.hash = ''
  return resource.toString()
}

export function archivePathForResource(podRoot: string, resourceUrl: string): string {
  const root = new URL(canonicalizePodRoot(podRoot))
  const resource = new URL(canonicalizePodResource(root.toString(), resourceUrl))
  const relative = decodeURIComponent(resource.pathname.slice(root.pathname.length))
  if (!relative || relative.endsWith('/')) return archivePathForContainer(podRoot, resourceUrl)
  const segments = relative.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Pod resource cannot be represented safely: ${resourceUrl}`)
  }
  return `pod/${segments.join('/')}`
}

export function archivePathForContainer(podRoot: string, resourceUrl: string): string {
  const root = new URL(canonicalizePodRoot(podRoot))
  const resource = new URL(canonicalizePodResource(root.toString(), resourceUrl))
  const relative = decodeURIComponent(resource.pathname.slice(root.pathname.length))
  const segments = relative.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))) {
    throw new Error(`Pod container cannot be represented safely: ${resourceUrl}`)
  }
  return segments.length > 0 ? `pod/${segments.join('/')}/.container` : 'pod/.container'
}

function isWithinPath(rootPath: string, candidatePath: string): boolean {
  const normalizedRoot = rootPath.endsWith('/') ? rootPath : `${rootPath}/`
  return candidatePath === normalizedRoot.slice(0, -1) || candidatePath.startsWith(normalizedRoot)
}