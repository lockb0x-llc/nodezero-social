/**
 * @module NodeZeroSessionContext
 *
 * The single client-side authority for authentication state.
 *
 * Session contract (fail-closed): a user is `authenticated` if and only if
 * they hold a NodeZero session token minted by the provisioner — which itself
 * only mints after exchanging the user's stored CSS client credentials for a
 * live DPoP-bound Solid token and probing the Pod. There is no degraded or
 * half-authenticated state: any `session_invalid` response destroys the
 * session and returns the user to the sign-in page.
 *
 * The browser NEVER talks to CSS. `authFetch` transparently rewrites Pod URLs
 * onto the provisioner's Pod Access Proxy (`/v1/pod-proxy/*`) and attaches the
 * NodeZero bearer token.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'

export type SessionStatus = 'restoring' | 'unauthenticated' | 'authenticated'

export interface SessionLockboxInfo {
  userLockboxContractId: string | null
  factoryContractId: string | null
  proofRootHex: string | null
}

export interface SessionTokens {
  accessToken: string
  refreshToken: string
  /** ISO expiry of the access token. */
  expiresAt: string
}

/** Payload accepted by `adoptSession` — the shape returned by the provisioner. */
export interface AdoptSessionInput {
  session: SessionTokens
  webId: string
  podUrl: string
  lockbox?: SessionLockboxInfo | null
  /** ISO timestamp of account creation (signup) or now (login). */
  createdAt?: string
}

interface PersistedSession {
  version: 2
  accessToken: string
  refreshToken: string
  expiresAt: string
  webId: string
  podUrl: string
  lockbox: SessionLockboxInfo | null
  createdAt: string
}

export interface NodeZeroSessionValue {
  /** Binary auth state (plus the initial restore). The ONLY auth signal. */
  status: SessionStatus
  /** WebID of the authenticated user, or null. */
  webId: string | null
  /** Pod base URL of the authenticated user, or null. */
  podUrl: string | null
  /** On-chain lockb0x anchor metadata for the fail-closed pairing check. */
  lockbox: SessionLockboxInfo | null
  /** ISO timestamp when the current session's account/session was created. */
  sessionCreatedAt: string | null
  /**
   * Authenticated fetch bound to the Pod Access Proxy. Guaranteed live while
   * `status === 'authenticated'`; a `session_invalid` response signs out.
   */
  authFetch: typeof globalThis.fetch
  /** Installs a provisioner-issued session (from signup or login). */
  adoptSession: (input: AdoptSessionInput) => Promise<void>
  /** Destroys the session and returns to `unauthenticated`. */
  signOut: () => Promise<void>
}

const SESSION_STORAGE_KEY = 'nz.session.v2'
/** Refresh when less than this remains on the access token. */
const REFRESH_SLACK_MS = 5 * 60_000

const NodeZeroSessionContext = createContext<NodeZeroSessionValue | null>(null)

function getAppExtra(): Record<string, string> | undefined {
  return Constants.expoConfig?.extra as Record<string, string> | undefined
}

export function getProvisionerUrl(): string {
  const extra = getAppExtra()
  const configured = (extra?.jssProvisionerUrl ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  // Staging host fallback mirrors seamlessSignup's behaviour.
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const host = window.location.hostname.toLowerCase()
    if (host === 'staging.nodezero.social' || host === 'mango-glacier-0abee9e0f.7.azurestaticapps.net') {
      return 'https://nodezero-social-staging-testnet-provisioner.azurewebsites.net'
    }
  }
  return ''
}

function browserSessionBootstrapEnabled(): boolean {
  const configured = (getAppExtra()?.browserSessionEnabled ?? '').trim().toLowerCase()
  return configured === 'true' && typeof window !== 'undefined'
}

/** Origins whose URLs must be rewritten onto the Pod Access Proxy. */
function getPodOrigins(podUrl: string | null): Set<string> {
  const origins = new Set<string>()
  const issuer = (getAppExtra()?.nodeZeroIssuerUrl ?? '').trim()
  if (issuer) {
    try {
      origins.add(new URL(issuer).origin)
    } catch {
      // ignore malformed issuer configuration here; config guards report it
    }
  }
  if (podUrl) {
    try {
      origins.add(new URL(podUrl).origin)
    } catch {
      // ignore
    }
  }
  return origins
}

function toProxyUrl(rawUrl: string, podOrigins: Set<string>, provisionerUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    if (podOrigins.has(parsed.origin)) {
      return `${provisionerUrl}/v1/pod-proxy${parsed.pathname}${parsed.search}`
    }
  } catch {
    // Relative or opaque URLs pass through untouched.
  }
  return rawUrl
}

async function loadPersistedSession(): Promise<PersistedSession | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedSession>
    if (
      parsed.version !== 2 ||
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.expiresAt !== 'string' ||
      typeof parsed.webId !== 'string' ||
      typeof parsed.podUrl !== 'string'
    ) {
      return null
    }
    return {
      version: 2,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      webId: parsed.webId,
      podUrl: parsed.podUrl,
      lockbox: parsed.lockbox ?? null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

interface RefreshResponse {
  session?: SessionTokens
  webId?: string
  podUrl?: string
  lockbox?: SessionLockboxInfo | null
}

export function NodeZeroSessionProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<SessionStatus>('restoring')
  const [webId, setWebId] = useState<string | null>(null)
  const [podUrl, setPodUrl] = useState<string | null>(null)
  const [lockbox, setLockbox] = useState<SessionLockboxInfo | null>(null)
  const [sessionCreatedAt, setSessionCreatedAt] = useState<string | null>(null)
  const sessionRef = useRef<PersistedSession | null>(null)
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null)

  const applySession = useCallback(async (record: PersistedSession): Promise<void> => {
    sessionRef.current = record
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record))
    setWebId(record.webId)
    setPodUrl(record.podUrl)
    setLockbox(record.lockbox)
    setSessionCreatedAt(record.createdAt)
    setStatus('authenticated')
  }, [])

  const clearSession = useCallback(async (): Promise<void> => {
    sessionRef.current = null
    await AsyncStorage.removeItem(SESSION_STORAGE_KEY).catch(() => undefined)
    setWebId(null)
    setPodUrl(null)
    setLockbox(null)
    setSessionCreatedAt(null)
    setStatus('unauthenticated')
  }, [])

  const signOut = useCallback(async (): Promise<void> => {
    const current = sessionRef.current
    const provisionerUrl = getProvisionerUrl()
    if (current && provisionerUrl) {
      // Best-effort server-side invalidation; local destruction is what
      // guarantees the client returns to the sign-in page.
      void fetch(`${provisionerUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: current.refreshToken, webId: current.webId }),
      }).catch(() => undefined)
    }
    await clearSession()
  }, [clearSession])

  /**
   * Attempts a refresh with the stored refresh token. Fail-closed: any error
   * destroys the session. Returns true when a fresh session was adopted.
   */
  const tryRefresh = useCallback(async (): Promise<boolean> => {
    if (refreshInFlightRef.current) return refreshInFlightRef.current

    const run = (async (): Promise<boolean> => {
      const current = sessionRef.current
      const provisionerUrl = getProvisionerUrl()
      if (!current || !provisionerUrl) {
        await clearSession()
        return false
      }
      try {
        const res = await fetch(`${provisionerUrl}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        })
        if (!res.ok) {
          await clearSession()
          return false
        }
        const payload = (await res.json()) as RefreshResponse
        if (!payload.session?.accessToken || !payload.webId || !payload.podUrl) {
          await clearSession()
          return false
        }
        await applySession({
          version: 2,
          accessToken: payload.session.accessToken,
          refreshToken: payload.session.refreshToken,
          expiresAt: payload.session.expiresAt,
          webId: payload.webId,
          podUrl: payload.podUrl,
          lockbox: payload.lockbox ?? current.lockbox,
          createdAt: current.createdAt,
        })
        return true
      } catch {
        // Network failure during refresh: fail closed. The user re-signs in
        // with their Stellar key; no zombie session is ever kept.
        await clearSession()
        return false
      }
    })()

    refreshInFlightRef.current = run
    try {
      return await run
    } finally {
      refreshInFlightRef.current = null
    }
  }, [applySession, clearSession])

  const tryBrowserSessionBootstrap = useCallback(async (): Promise<boolean> => {
    const provisionerUrl = getProvisionerUrl()
    if (!browserSessionBootstrapEnabled() || !provisionerUrl) return false
    try {
      const res = await fetch(`${provisionerUrl}/v1/auth/browser-session`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
      })
      if (!res.ok) return false
      const payload = (await res.json()) as RefreshResponse
      if (!payload.session?.accessToken || !payload.webId || !payload.podUrl) return false
      await applySession({
        version: 2,
        accessToken: payload.session.accessToken,
        refreshToken: payload.session.refreshToken,
        expiresAt: payload.session.expiresAt,
        webId: payload.webId,
        podUrl: payload.podUrl,
        lockbox: payload.lockbox ?? null,
        createdAt: new Date().toISOString(),
      })
      return true
    } catch {
      return false
    }
  }, [applySession])

  // Initial restore: adopt a stored, unexpired session; refresh an expired
  // one exactly once; otherwise land on the sign-in page.
  useEffect(() => {
    void (async (): Promise<void> => {
      const stored = await loadPersistedSession()
      if (!stored) {
        if (!(await tryBrowserSessionBootstrap())) setStatus('unauthenticated')
        return
      }
      sessionRef.current = stored
      const remaining = new Date(stored.expiresAt).getTime() - Date.now()
      if (remaining > REFRESH_SLACK_MS) {
        await applySession(stored)
        return
      }
      if (!(await tryRefresh())) await tryBrowserSessionBootstrap()
    })()
  }, [applySession, tryBrowserSessionBootstrap, tryRefresh])

  const adoptSession = useCallback(
    async (input: AdoptSessionInput): Promise<void> => {
      await applySession({
        version: 2,
        accessToken: input.session.accessToken,
        refreshToken: input.session.refreshToken,
        expiresAt: input.session.expiresAt,
        webId: input.webId,
        podUrl: input.podUrl,
        lockbox: input.lockbox ?? null,
        createdAt: input.createdAt ?? new Date().toISOString(),
      })
    },
    [applySession],
  )

  const authFetch = useMemo<typeof globalThis.fetch>(() => {
    const podOrigins = getPodOrigins(podUrl)
    const provisionerUrl = getProvisionerUrl()

    const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const current = sessionRef.current
      if (!current) {
        throw new Error('No active NodeZero session. Sign in to access Pod data.')
      }

      // Refresh proactively when the access token is about to lapse.
      if (new Date(current.expiresAt).getTime() - Date.now() < REFRESH_SLACK_MS) {
        const refreshed = await tryRefresh()
        if (!refreshed) {
          throw new Error('Your session has expired. Sign in again to continue.')
        }
      }
      const active = sessionRef.current
      if (!active) {
        throw new Error('Your session has expired. Sign in again to continue.')
      }

      const rawUrl =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const targetUrl = toProxyUrl(rawUrl, podOrigins, provisionerUrl)

      const headers = new Headers(
        init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
      )
      headers.set('authorization', `Bearer ${active.accessToken}`)

      const response = await fetch(targetUrl, {
        ...(typeof input === 'object' && !(input instanceof URL) ? { method: input.method, body: init?.body } : {}),
        ...init,
        headers,
      })

      if (response.status === 401) {
        const clone = response.clone()
        const payload = (await clone.json().catch(() => ({}))) as { code?: string }
        if (payload.code === 'session_invalid') {
          // The server said the invariant no longer holds — destroy the
          // session; the route guard returns the user to sign-in.
          await signOut()
        }
      }
      return response
    }

    return wrapped as typeof globalThis.fetch
  }, [podUrl, signOut, tryRefresh])

  const value = useMemo<NodeZeroSessionValue>(
    () => ({
      status,
      webId,
      podUrl,
      lockbox,
      sessionCreatedAt,
      authFetch,
      adoptSession,
      signOut,
    }),
    [status, webId, podUrl, lockbox, sessionCreatedAt, authFetch, adoptSession, signOut],
  )

  return <NodeZeroSessionContext.Provider value={value}>{children}</NodeZeroSessionContext.Provider>
}

/** Hook to consume the NodeZero session. Must be used inside the provider. */
export function useNodeZeroSession(): NodeZeroSessionValue {
  const ctx = useContext(NodeZeroSessionContext)
  if (!ctx) throw new Error('useNodeZeroSession must be used inside <NodeZeroSessionProvider>')
  return ctx
}
