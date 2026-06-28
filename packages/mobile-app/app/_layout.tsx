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
import { WalletProvider } from '../src/contexts/WalletContext'
import { Stack, Link, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, Text, StyleSheet, Platform, ScrollView } from 'react-native'
import React from 'react'
import { aesthetic } from '../src/theme/aesthetic'

/** Navigation bar rendered at the bottom of the screen on web only. */
function WebNavBar(): JSX.Element | null {
  const { isLoggedIn } = useSolid()
  const pathname = usePathname()

  // Only render on web and only when the user is authenticated.
  if (Platform.OS !== 'web' || !isLoggedIn) return null

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
  return (
    <SolidProvider>
      <DiscoveryProvider>
        <WalletProvider>
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

