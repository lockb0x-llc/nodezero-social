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

import { SolidProvider, useSolid } from '../src/contexts/SolidContext'
import { DiscoveryProvider } from '../src/contexts/DiscoveryContext'
import { WalletProvider, useWallet } from '../src/contexts/WalletContext'
import { Stack, Link, usePathname, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, Text, StyleSheet, Platform, ScrollView } from 'react-native'
import Constants from 'expo-constants'
import React from 'react'
import { aesthetic } from '../src/theme/aesthetic'
import * as mashlibPaneProvider from '../src/solid/mashlibPaneProvider'

const PUBLIC_ROUTES = new Set(['/'])
const TRANSITION_ROUTES = new Set(['/onboarding'])

function normalizeRoute(pathname: string): string {
  if (!pathname) return '/'
  return pathname.split('?')[0] ?? pathname
}

/**
 * Global auth gate: authenticated users must also have a verified pairing
 * before entering protected surfaces.
 */
function RouteGuard(): null {
  const { isLoggedIn, isRestoring, nodeSession, signOut } = useSolid()
  const { attestationStatus } = useWallet()
  const pathname = usePathname()
  const router = useRouter()
  const isSignOutInFlightRef = React.useRef(false)

  React.useEffect(() => {
    if (isRestoring) return

    const route = normalizeRoute(pathname)

    if (!isLoggedIn) {
      isSignOutInFlightRef.current = false
      if (!PUBLIC_ROUTES.has(route)) {
        router.replace('/')
      }
      return
    }

    if (attestationStatus === 'verified') {
      isSignOutInFlightRef.current = false
      if (PUBLIC_ROUTES.has(route) || TRANSITION_ROUTES.has(route)) {
        router.replace(nodeSession ? '/local' : '/feed')
      }
      return
    }

    if (attestationStatus === 'unlinked' || attestationStatus === 'error') {
      if (!isSignOutInFlightRef.current) {
        isSignOutInFlightRef.current = true
        void signOut().finally(() => {
          router.replace('/')
          isSignOutInFlightRef.current = false
        })
      }
      return
    }

    // Logged in but not yet verified: only onboarding is allowed.
    if (!TRANSITION_ROUTES.has(route)) {
      router.replace('/onboarding')
    }
  }, [attestationStatus, isLoggedIn, isRestoring, nodeSession, pathname, router, signOut])

  return null
}

/** Navigation bar rendered at the bottom of the screen on web only. */
function WebNavBar(): JSX.Element | null {
  const { isLoggedIn } = useSolid()
  const { attestationStatus } = useWallet()
  const pathname = usePathname()

  // Only render on web and only when the user is authenticated.
  if (Platform.OS !== 'web' || !isLoggedIn || attestationStatus !== 'verified') return null

  // Settings is intentionally excluded: it is accessed via the gear icon
  // on the Profile screen, keeping the nav bar to 6 items and ensuring
  // all tabs remain visible on narrow mobile viewports.
  const links = [
    { href: '/local', label: 'Local' },
    { href: '/compose', label: 'Broadcast' },
    { href: '/docustream', label: 'Stream' },
    { href: '/feed', label: 'Feed' },
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
      <View pointerEvents="none" style={[styles.navBarFadeRight, { backgroundImage: `linear-gradient(to right, transparent, ${aesthetic.color.surface})` } as any]} />
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
    if (!isEnabled) return

    const root = globalThis as unknown as Record<string, unknown>
    if (!root.__NZ_MASHLIB__) {
      root.__NZ_MASHLIB__ = {
        listPanes: mashlibPaneProvider.listPanes,
      }
    }
  }, [])

  return (
    <SolidProvider>
      <DiscoveryProvider>
        <WalletProvider>
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
          </Stack>
          <WebNavBar />
        </WalletProvider>
      </DiscoveryProvider>
    </SolidProvider>
  )
}

