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
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import {
  EVENTS,
  Session,
  handleIncomingRedirect,
  login,
  logout,
  getDefaultSession,
} from '@inrupt/solid-client-authn-browser'
import { clearSignupIntent, getSignupResumeState } from '../onboarding/signupBridge'
import {
  clearNodeSession,
  loadNodeSession,
  saveNodeSession,
  type NodeSessionRecord,
} from '../onboarding/nodeSession'

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
  /**
   * Signs the user in using a locally-held seamless-onboarding node session
   * (no OIDC redirect). The provisioner has already persisted the account to
   * the Pod and anchored the pairing on-chain, so this only records the
   * non-secret session locally and flips auth state.
   */
  signInWithNode: (record: NodeSessionRecord) => Promise<void>
  /** The active seamless node session, when present. */
  nodeSession: NodeSessionRecord | null
  /** Logs the user out and clears local session state. */
  signOut: () => Promise<void>
  /** `true` while the initial session restore is in progress. */
  isRestoring: boolean
  /** Whether a recent signup intent is still active. */
  signupResumeActive: boolean
  /** Whether signup flow appears to have returned into the app shell. */
  signupReturnDetected: boolean
}

const SolidContext = createContext<SolidContextValue | null>(null)

const SOLID_WEBID_STORAGE_KEY = 'solid.webId.v1'
const PAIRING_ATTESTATION_STORAGE_KEY = 'attestation.pairing.v1'

/** Environment profiles that the Solid auth flow supports. */
const KNOWN_ENV_PROFILES = ['local', 'staging-testnet', 'production-mainnet'] as const

/**
 * Reads the active environment profile injected via `app.config.js` -> `extra`.
 * Falls back to `local` when running outside a configured Expo runtime.
 */
function getEnvProfile(): string {
  const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
  return appExtra?.envProfile ?? 'local'
}

/**
 * Validates that the runtime auth environment is internally coherent before any
 * redirect is attempted. Throws an actionable error for staging/production
 * builds that are misconfigured, so failures surface at startup rather than
 * mid-login.
 */
function assertAuthEnvironmentCoherence(): void {
  const envProfile = getEnvProfile()

  if (!KNOWN_ENV_PROFILES.includes(envProfile as (typeof KNOWN_ENV_PROFILES)[number])) {
    throw new Error(
      `Unsupported NZ_ENV_PROFILE '${envProfile}' for Solid auth. Allowed values: ${KNOWN_ENV_PROFILES.join(', ')}.`
    )
  }

  // On web the OAuth redirect relies on a resolvable browser location.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && !window.location?.href) {
    throw new Error(
      'Solid auth requires a resolvable window.location on web. Verify the static web host serves the app under a real origin.'
    )
  }
}

/**
 * Validates and normalises a Solid Identity Provider URL, emitting an actionable
 * error when the value cannot be used to start an OAuth flow. Returns the
 * canonical issuer origin on success.
 */
export function validateIdpUrl(raw: string, envProfile: string = getEnvProfile()): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('A Solid Identity Provider URL is required (e.g. https://solidcommunity.net).')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(
      `Invalid Solid Identity Provider URL '${raw}'. Provide a full https URL (e.g. https://solidcommunity.net).`
    )
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  const allowHttp = envProfile === 'local' && isLocalhost
  if (parsed.protocol !== 'https:' && !allowHttp) {
    throw new Error(
      `Solid Identity Provider must use https (got '${parsed.protocol}//'). Only localhost may use http in the local profile.`
    )
  }

  return parsed.origin
}

function resolveRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
    // OIDC redirectUrl must not include reserved callback params such as `code` or `state`.
    // Using origin + pathname prevents stale error/callback query fragments from breaking login.
    return `${window.location.origin}${window.location.pathname}`
  }
  if (Platform.OS === 'web') {
    throw new Error(
      'Cannot resolve a web OAuth redirect URL: window.location is unavailable in this runtime.'
    )
  }
  // Keep native flows explicit and deterministic under the app's scheme.
  return 'nodezero://auth/callback'
}

function hasOidcRedirectParams(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true
  const params = new URLSearchParams(window.location.search)
  return params.has('code') && params.has('state')
}

/**
 * Wrap your application root with `SolidProvider` to make Solid auth state
 * available throughout the component tree.
 */
export function SolidProvider({ children }: { children: ReactNode }): JSX.Element {
  // Fail fast on a misconfigured staging/production auth environment.
  assertAuthEnvironmentCoherence()

  const session = getDefaultSession()
  const [isLoggedIn, setIsLoggedIn] = useState(session.info.isLoggedIn)
  const [webId, setWebId] = useState<string | null>(session.info.webId ?? null)
  const [isRestoring, setIsRestoring] = useState(true)
  const [signupResumeActive, setSignupResumeActive] = useState(false)
  const [signupReturnDetected, setSignupReturnDetected] = useState(false)
  const [nodeSession, setNodeSession] = useState<NodeSessionRecord | null>(null)

  const applyWebId = useCallback((nextWebId: string | null): void => {
    setIsLoggedIn(Boolean(nextWebId))
    setWebId(nextWebId)
    if (nextWebId) {
      void AsyncStorage.setItem(SOLID_WEBID_STORAGE_KEY, nextWebId)
      void clearSignupIntent()
      setSignupResumeActive(false)
      setSignupReturnDetected(false)
    }
  }, [])

  const syncSessionState = useCallback((): void => {
    if (session.info.isLoggedIn && session.info.webId) {
      applyWebId(session.info.webId)
    }
  }, [applyWebId, session])

  useEffect(() => {
    const handleAuthenticated = (): void => syncSessionState()
    const handleUnauthenticated = (): void => {
      setIsLoggedIn(false)
      setWebId(null)
      void AsyncStorage.removeItem(SOLID_WEBID_STORAGE_KEY)
    }

    session.events.on(EVENTS.LOGIN, handleAuthenticated)
    session.events.on(EVENTS.SESSION_RESTORED, handleAuthenticated)
    session.events.on(EVENTS.LOGOUT, handleUnauthenticated)
    session.events.on(EVENTS.SESSION_EXPIRED, handleUnauthenticated)

    void Promise.all([
      AsyncStorage.getItem(SOLID_WEBID_STORAGE_KEY),
      getSignupResumeState(),
      loadNodeSession(),
    ])
      .then(([cachedWebId, signupResume, savedNodeSession]) => {
        setSignupResumeActive(signupResume.hasActiveIntent)
        setSignupReturnDetected(signupResume.returnDetected)
        // A seamless node session is a complete, self-contained auth state.
        if (savedNodeSession) {
          setNodeSession(savedNodeSession)
          applyWebId(savedNodeSession.webId)
          return undefined
        }
        if (cachedWebId) applyWebId(cachedWebId)
        if (!hasOidcRedirectParams()) return undefined
        return handleIncomingRedirect({ restorePreviousSession: false })
      })
      .then((info) => {
        if (info?.isLoggedIn && info.webId) {
          applyWebId(info.webId)
        } else {
          syncSessionState()
        }
      })
      .catch((err) => {
        console.warn('[SolidContext] Session restore failed:', err)
        syncSessionState()
      })
      .finally(() => {
        setIsRestoring(false)
      })

    return (): void => {
      session.events.off(EVENTS.LOGIN, handleAuthenticated)
      session.events.off(EVENTS.SESSION_RESTORED, handleAuthenticated)
      session.events.off(EVENTS.LOGOUT, handleUnauthenticated)
      session.events.off(EVENTS.SESSION_EXPIRED, handleUnauthenticated)
    }
  }, [applyWebId, session, syncSessionState])

  const signIn = useCallback(async (idpUrl: string) => {
    const oidcIssuer = validateIdpUrl(idpUrl)
    const redirectUrl = resolveRedirectUrl()
    await login({
      oidcIssuer,
      redirectUrl,
      clientName: 'NodeZero.social',
    })
  }, [])

  const signInWithNode = useCallback(
    async (record: NodeSessionRecord) => {
      await saveNodeSession(record)
      setNodeSession(record)
      applyWebId(record.webId)
    },
    [applyWebId],
  )

  const signOut = useCallback(async () => {
    // Inrupt logout is a no-op for node sessions but is safe to call.
    try {
      await logout()
    } catch {
      // Ignore: node sessions have no Inrupt session to tear down.
    }
    await AsyncStorage.removeItem(SOLID_WEBID_STORAGE_KEY)
    await AsyncStorage.removeItem(PAIRING_ATTESTATION_STORAGE_KEY)
    await clearSignupIntent()
    await clearNodeSession()
    setNodeSession(null)
    setIsLoggedIn(false)
    setWebId(null)
  }, [])

  return (
    <SolidContext.Provider
      value={{
        session,
        isLoggedIn,
        webId,
        signIn,
        signInWithNode,
        nodeSession,
        signOut,
        isRestoring,
        signupResumeActive,
        signupReturnDetected,
      }}
    >
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
