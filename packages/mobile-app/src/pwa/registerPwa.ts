import Constants from 'expo-constants'
import { Platform } from 'react-native'

function ensureLink(rel: string, href: string, attributes: Record<string, string> = {}): void {
  if (document.head.querySelector(`link[rel="${rel}"][href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = rel
  link.href = href
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value)
  document.head.appendChild(link)
}

export function registerPwa(): (() => void) | undefined {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined
  }

  const extra = Constants.expoConfig?.extra as Record<string, string> | undefined
  const appOrigin = (extra?.appOrigin ?? '').trim()
  if (!appOrigin || window.location.origin !== appOrigin) return undefined

  ensureLink('manifest', '/manifest.json')
  ensureLink('apple-touch-icon', '/pwa/icon-180.png', { sizes: '180x180' })

  if ((window as typeof window & { __NZ_PWA_BOOTSTRAPPED__?: boolean }).__NZ_PWA_BOOTSTRAPPED__) {
    return undefined
  }
  if (!('serviceWorker' in navigator)) return undefined
  const onLoad = (): void => {
    void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch((error) => {
      console.warn('[PWA] Service worker registration failed:', error)
    })
  }
  if (document.readyState === 'complete') onLoad()
  else window.addEventListener('load', onLoad, { once: true })
  return () => window.removeEventListener('load', onLoad)
}