export type PodArchiveDeliveryOutcome = 'shared' | 'saved' | 'cancelled'

export async function deliverPodArchive(
  fileName: string,
  bytes: Uint8Array,
): Promise<PodArchiveDeliveryOutcome> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Solid Pod archive export is currently available on the web.')
  }

  const blobBytes = bytes.slice().buffer as ArrayBuffer
  const file = typeof File !== 'undefined'
    ? new File([blobBytes], fileName, { type: 'application/zip' })
    : null
  if (file && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ title: fileName, files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
      // Fall through to a normal download for unsupported share targets.
    }
  }

  const blob = new Blob([blobBytes], { type: 'application/zip' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fileName
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    document.body.removeChild(anchor)
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
  return 'saved'
}