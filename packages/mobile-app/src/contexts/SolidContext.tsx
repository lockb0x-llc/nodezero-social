/**
 * @module SolidContext
 *
 * Provides authentication state and a Solid session to all child components.
 * Uses the `@inrupt/solid-client-authn-browser` library for the OAuth 2.0
 * PKCE flow compatible with all major Solid identity providers.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Platform } from 'react-native'
import {
  Session,
  handleIncomingRedirect,
  login,
  logout,
  getDefaultSession,
} from '@inrupt/solid-client-authn-browser'

/** Shape of the Solid authentication context. */
interface SolidContextValue {
  /** The active Inrupt session (authenticated or anonymous). */
  session: Session
  /** Whether the user is currently logged in. */
  isLoggedIn: boolean
  /** The authenticated user's WebID URL, or `null`. */
  webId: string | null
  /** Initiates the login redirect to the user's Solid identity provider. */
  signIn: (idpUrl: string) => Promise<void>
  /** Logs the user out and clears local session state. */
  signOut: () => Promise<void>
  /** `true` while the initial session restore is in progress. */
  isRestoring: boolean
}

const SolidContext = createContext<SolidContextValue | null>(null)

function resolveRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
    return window.location.href
  }
  // Keep native flows explicit and deterministic under the app's scheme.
  return 'nodezero://auth/callback'
}

/**
 * Wrap your application root with `SolidProvider` to make Solid auth state
 * available throughout the component tree.
 */
export function SolidProvider({ children }: { children: ReactNode }): JSX.Element {
  const session = getDefaultSession()
  const [isLoggedIn, setIsLoggedIn] = useState(session.info.isLoggedIn)
  const [webId, setWebId] = useState<string | null>(session.info.webId ?? null)
  const [isRestoring, setIsRestoring] = useState(true)

  useEffect(() => {
    void handleIncomingRedirect({ restorePreviousSession: true })
      .then((info) => {
        if (info?.isLoggedIn) {
          setIsLoggedIn(true)
          setWebId(info.webId ?? null)
        }
      })
      .catch((err) => {
        console.warn('[SolidContext] Session restore failed:', err)
      })
      .finally(() => {
        setIsRestoring(false)
      })
  }, [])

  const signIn = useCallback(async (idpUrl: string) => {
    const redirectUrl = resolveRedirectUrl()
    await login({
      oidcIssuer: idpUrl,
      redirectUrl,
      clientName: 'NodeZero.social',
    })
  }, [])

  const signOut = useCallback(async () => {
    await logout()
    setIsLoggedIn(false)
    setWebId(null)
  }, [])

  return (
    <SolidContext.Provider value={{ session, isLoggedIn, webId, signIn, signOut, isRestoring }}>
      {children}
    </SolidContext.Provider>
  )
}

/**
 * Hook to consume the Solid authentication context.
 * Must be used inside a `SolidProvider`.
 */
export function useSolid(): SolidContextValue {
  const ctx = useContext(SolidContext)
  if (!ctx) throw new Error('useSolid must be used inside <SolidProvider>')
  return ctx
}
