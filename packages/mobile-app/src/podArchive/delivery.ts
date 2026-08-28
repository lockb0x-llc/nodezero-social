export type PodArchiveDeliveryOutcome = 'shared' | 'saved' | 'cancelled'

interface WebNavigator {
  canShare?: (data: { files: File[] }) => boolean
  share: (data: { title: string; files: File[] }) => Promise<void>
}

interface WebDocument {
  body: { appendChild: (element: WebAnchor) => void; removeChild: (element: WebAnchor) => void }
  createElement: (tagName: 'a') => WebAnchor
}

interface WebAnchor {
  href: string
  download: string
  click: () => void
}

export async function deliverPodArchive(
  fileName: string,
  bytes: Uint8Array,
): Promise<PodArchiveDeliveryOutcome> {
  const browser = globalThis as unknown as {
    navigator?: WebNavigator
    document?: WebDocument
  }
  if (!browser.document) {
    throw new Error('Solid Pod archive export is currently available on the web.')
  }

  const blobBytes = bytes.slice().buffer as ArrayBuffer
  const file = typeof File !== 'undefined'
    ? new File([blobBytes], fileName, { type: 'application/zip' })
    : null
  if (file && browser.navigator?.share && browser.navigator.canShare?.({ files: [file] })) {
    try {
      await browser.navigator.share({ title: fileName, files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
      // Fall through to a normal download for unsupported share targets.
    }
  }

  const blob = new Blob([blobBytes], { type: 'application/zip' })
  const href = URL.createObjectURL(blob)
  const anchor = browser.document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  browser.document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    browser.document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
  return 'saved'
}