import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'

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

export async function deliverFile(
  fileName: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<PodArchiveDeliveryOutcome> {
  if (typeof document === 'undefined') {
    const cacheDirectory = FileSystem.cacheDirectory
    if (!cacheDirectory) throw new Error('Native archive cache storage is unavailable.')
    const uri = `${cacheDirectory}${fileName}`
    await FileSystem.writeAsStringAsync(uri, toBase64(bytes), {
      encoding: FileSystem.EncodingType.Base64,
    })
    if (!(await Sharing.isAvailableAsync())) {
      await FileSystem.deleteAsync(uri, { idempotent: true })
      throw new Error('Native sharing is unavailable.')
    }
    try {
      await Sharing.shareAsync(uri, { mimeType, dialogTitle: fileName })
      return 'shared'
    } finally {
      setTimeout(() => {
        void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined)
      }, 5 * 60 * 1000)
    }
  }

  const browser = globalThis as unknown as {
    navigator?: WebNavigator
    document?: WebDocument
  }
  if (!browser.document) {
    throw new Error('Solid Pod archive export is currently available on the web.')
  }

  const blobBytes = bytes.slice().buffer as ArrayBuffer
  const file = typeof File !== 'undefined'
    ? new File([blobBytes], fileName, { type: mimeType })
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

  const blob = new Blob([blobBytes], { type: mimeType })
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

function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    result += alphabet[first >> 2]
    result += alphabet[((first & 3) << 4) | (second === undefined ? 0 : second >> 4)]
    result += second === undefined ? '==' : alphabet[((second & 15) << 2) | (third === undefined ? 0 : third >> 6)]
    result += third === undefined ? '=' : alphabet[third & 63]
  }
  return result
}

export async function deliverPodArchive(
  fileName: string,
  bytes: Uint8Array,
): Promise<PodArchiveDeliveryOutcome> {
  return deliverFile(fileName, bytes, 'application/zip')
}