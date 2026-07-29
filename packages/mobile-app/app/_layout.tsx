/**
 * Root Expo Router layout.
 *
 * Sets up all global context providers (Solid auth, Geo-Discovery, Wallet)
 * and registers the tab / stack navigation structure.
 *
 * On web, a bottom navigation bar is rendered so authenticated users can
 * move between the Feed, Local Node, and Profile screens without relying on
 * browser history or direct URL entry. Settings is accessible via the gear
 * icon on the Profile screen.
 */

import { NodeZeroSessionProvider, useNodeZeroSession } from '../src/contexts/NodeZeroSessionContext'
import { DiscoveryProvider } from '../src/contexts/DiscoveryContext'
import { WalletProvider, useWallet } from '../src/contexts/WalletContext'
import { WakuProvider } from '../src/contexts/WakuContext'
import { PresenceProvider } from '../src/contexts/PresenceContext'
import { Stack, Link, usePathname, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, Text, StyleSheet, Platform, ScrollView, type ViewStyle } from 'react-native'
import Constants from 'expo-constants'
import React from 'react'
import { Buffer } from 'buffer'
import { aesthetic } from '../src/theme/aesthetic'
import * as mashlibPaneProvider from '../src/solid/mashlibPaneProvider'

const globalWithBuffer = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
if (typeof globalWithBuffer.Buffer === 'undefined') {
  globalWithBuffer.Buffer = Buffer
}

const PUBLIC_ROUTES = new Set(['/', '/wallet-broker', '/wallet-migration'])
const TRANSITION_ROUTES = new Set(['/onboarding'])

function normalizeRoute(pathname: string): string {
  if (!pathname) return '/'
  return pathname.split('?')[0] ?? pathname
}

/**
 * Global auth gate — the SINGLE authorization decision point.
 *
 * Session invariant: `status === 'authenticated'` means the backend proved
 * live Solid access when the session was issued. Unauthenticated visitors are
 * always returned to the home sign-in page; authenticated users must also
 * pass the client-side on-chain lockb0x attestation check before entering
 * protected surfaces. There is no other state.
 */
function RouteGuard(): null {
  const { status, signOut } = useNodeZeroSession()
  const { attestationStatus } = useWallet()
  const pathname = usePathname()
  const router = useRouter()
  const isSignOutInFlightRef = React.useRef(false)
  const pendingProtectedRouteRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (status === 'restoring') return

    const route = normalizeRoute(pathname)

    if (status === 'unauthenticated') {
      isSignOutInFlightRef.current = false
      pendingProtectedRouteRef.current = null
      if (!PUBLIC_ROUTES.has(route)) {
        router.replace('/')
      }
      return
    }

    if (attestationStatus === 'verified') {
      isSignOutInFlightRef.current = false
      const pendingTarget = pendingProtectedRouteRef.current

      if (PUBLIC_ROUTES.has(route) || TRANSITION_ROUTES.has(route)) {
        router.replace(pendingTarget ?? '/feed')
        pendingProtectedRouteRef.current = null
      }

      if (!PUBLIC_ROUTES.has(route) && !TRANSITION_ROUTES.has(route)) {
        pendingProtectedRouteRef.current = null
      }

      return
    }

    if (attestationStatus === 'unlinked') {
      // 'unlinked' means the lockbox is confirmed absent after retries — sign
      // out and clear local state so the user can re-onboard cleanly. Preserve
      // a landing-page reason so legacy nodes do not look like a redirect loop.
      pendingProtectedRouteRef.current = null
      if (!isSignOutInFlightRef.current) {
        isSignOutInFlightRef.current = true
        void signOut().finally(() => {
          router.replace('/?reason=legacy-attestation')
          isSignOutInFlightRef.current = false
        })
      }
      return
    }

    if (attestationStatus === 'error') {
      // 'error' is a transient failure (network, RPC timeout) — do NOT sign out
      // or clear the session.  Keep the user on the onboarding screen where they
      // can see the error message and choose to return to sign-in.
      pendingProtectedRouteRef.current = null
      if (!TRANSITION_ROUTES.has(route) && !PUBLIC_ROUTES.has(route)) {
        router.replace('/onboarding')
      }
      return
    }

    // Authenticated but attestation still verifying: only onboarding is allowed.
    if (!TRANSITION_ROUTES.has(route)) {
      pendingProtectedRouteRef.current = route
      router.replace('/onboarding')
    }
  }, [attestationStatus, pathname, router, signOut, status])

  return null
}

/** Navigation bar rendered at the bottom of the screen on web only. */
function WebNavBar(): JSX.Element | null {
  const { status } = useNodeZeroSession()
  const { attestationStatus } = useWallet()
  const pathname = usePathname()

  // Only render on web and only when the user is authenticated.
  if (Platform.OS !== 'web' || status !== 'authenticated' || attestationStatus !== 'verified') return null

  // Settings is intentionally excluded: it is accessed via the gear icon
  // on the Profile screen, keeping the nav bar to 6 items and ensuring
  // all tabs remain visible on narrow mobile viewports.
  const links = [
    { href: '/local', label: 'Local' },
    { href: '/compose', label: 'Broadcast' },
    { href: '/docustream', label: 'Stream' },
    { href: '/feed', label: 'Feed' },
    { href: '/directory', label: 'Directory' },
    { href: '/backpack', label: 'Backpack' },
    { href: '/profile', label: 'Profile' },
  ] as const

  return (
    // Outer wrapper anchors the right-edge fade overlay.
    <View style={styles.navBarWrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.navBar}
      >
        {links.map(({ href, label }) => (
          <Link key={href} href={href} style={[styles.navLink, pathname === href && styles.navLinkActive]}>
            <Text style={[styles.navLinkText, pathname === href && styles.navLinkTextActive]}>
              {label}
            </Text>
          </Link>
        ))}
      </ScrollView>
      {/* Right-edge fade: visual cue that content continues when the bar overflows.
          Uses a react-native-web CSS passthrough for backgroundImage — this
          component is web-only (Platform.OS !== 'web' guard above). The cast
          to any is necessary because backgroundImage is not in RN ViewStyle. */}
      <View pointerEvents="none" style={[styles.navBarFadeRight, { backgroundImage: `linear-gradient(to right, transparent, ${aesthetic.color.surface})` } as ViewStyle]} />
    </View>
  )
}

const styles = StyleSheet.create({
  navBarWrapper: {
    position: 'relative',
    backgroundColor: aesthetic.color.surface,
    borderTopWidth: 1,
    borderTopColor: aesthetic.color.border,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 4,
  },
  navBarFadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 32,
    // backgroundImage applied inline (react-native-web CSS passthrough)
  },
  navLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navLinkActive: {
    backgroundColor: '#2F84D933',
  },
  navLinkText: {
    color: aesthetic.color.textMid,
    fontSize: 13,
    fontWeight: '500',
  },
  navLinkTextActive: {
    color: aesthetic.color.accentSoft,
    fontWeight: '700',
  },
})

export default function RootLayout(): JSX.Element {
  React.useEffect(() => {
    if (Platform.OS !== 'web') return

    const appExtra = Constants.expoConfig?.extra as Record<string, string> | undefined
    const enabledRaw = (appExtra?.mashlibExplorerEnabled ?? 'false').toLowerCase().trim()
    const isEnabled = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes'
    const moduleId = (appExtra?.mashlibModuleId ?? '').trim()
    if (!isEnabled) return

    // When an explicit module-id is configured, the adapter bridge resolves the
    // runtime provider directly and we should not inject fallback globals.
    if (moduleId) return

    const root = globalThis as unknown as Record<string, unknown>
    if (!root.__NZ_MASHLIB__) {
      root.__NZ_MASHLIB__ = {
        listPanes: mashlibPaneProvider.listPanes,
      }
    }
  }, [])

  return (
    <NodeZeroSessionProvider>
      <DiscoveryProvider>
        <WalletProvider>
          <WakuProvider>
            <PresenceProvider>
              <RouteGuard />
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: aesthetic.color.bgNight },
                  headerTintColor: aesthetic.color.textHigh,
                  headerTitleStyle: { fontWeight: 'bold' },
                  contentStyle: { backgroundColor: aesthetic.color.bgNight },
                }}
              >
                <Stack.Screen name="index" options={{ title: 'NodeZero' }} />
                <Stack.Screen name="onboarding" options={{ title: 'Onboarding' }} />
                <Stack.Screen name="feed" options={{ title: 'Global Feed' }} />
                <Stack.Screen name="local" options={{ title: 'Local Node' }} />
                <Stack.Screen name="profile" options={{ title: 'Profile' }} />
                <Stack.Screen name="settings" options={{ title: 'Settings' }} />
                <Stack.Screen name="backpack" />
                <Stack.Screen name="compose" />
                <Stack.Screen name="docustream" />
                <Stack.Screen name="wallet-broker" options={{ headerShown: false }} />
                <Stack.Screen name="wallet-migration" options={{ headerShown: false }} />
              </Stack>
              <WebNavBar />
            </PresenceProvider>
          </WakuProvider>
        </WalletProvider>
      </DiscoveryProvider>
    </NodeZeroSessionProvider>
  )
}

