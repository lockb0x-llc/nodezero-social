/**
 * Root Expo Router layout.
 *
 * Sets up all global context providers (Solid auth, Geo-Discovery, Wallet)
 * and registers the tab / stack navigation structure.
 *
 * On web, a bottom navigation bar is rendered so authenticated users can
 * move between the Feed, Local Node, Profile, and Settings screens without
 * relying on browser history or direct URL entry.
 */

import { SolidProvider, useSolid } from '../src/contexts/SolidContext'
import { DiscoveryProvider } from '../src/contexts/DiscoveryContext'
import { WalletProvider } from '../src/contexts/WalletContext'
import { Stack, Link, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, Text, StyleSheet, Platform } from 'react-native'
import React from 'react'

/** Navigation bar rendered at the bottom of the screen on web only. */
function WebNavBar(): JSX.Element | null {
  const { isLoggedIn } = useSolid()
  const pathname = usePathname()

  // Only render on web and only when the user is authenticated.
  if (Platform.OS !== 'web' || !isLoggedIn) return null

  const links = [
    { href: '/feed', label: '📰 Feed' },
    { href: '/local', label: '📍 Local' },
    { href: '/profile', label: '👤 Profile' },
    { href: '/settings', label: '⚙️ Settings' },
  ] as const

  return (
    <View style={styles.navBar}>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} style={[styles.navLink, pathname === href && styles.navLinkActive]}>
          <Text style={[styles.navLinkText, pathname === href && styles.navLinkTextActive]}>
            {label}
          </Text>
        </Link>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  navLink: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  navLinkActive: {
    backgroundColor: '#6C63FF22',
  },
  navLinkText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '500',
  },
  navLinkTextActive: {
    color: '#6C63FF',
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
              headerStyle: { backgroundColor: '#0D0D0D' },
              headerTintColor: '#FFFFFF',
              headerTitleStyle: { fontWeight: 'bold' },
              contentStyle: { backgroundColor: '#0D0D0D' },
            }}
          >
            <Stack.Screen name="index" options={{ title: 'NodeZero' }} />
            <Stack.Screen name="feed" options={{ title: 'Global Feed' }} />
            <Stack.Screen name="local" options={{ title: 'Local Node' }} />
            <Stack.Screen name="profile" options={{ title: 'Profile' }} />
            <Stack.Screen name="settings" options={{ title: 'Settings' }} />
          </Stack>
          <WebNavBar />
        </WalletProvider>
      </DiscoveryProvider>
    </SolidProvider>
  )
}

