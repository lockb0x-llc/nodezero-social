/**
 * Root Expo Router layout.
 *
 * Sets up all global context providers (Solid auth, Geo-Discovery, Wallet)
 * and registers the tab / stack navigation structure.
 */

import { SolidProvider } from '../src/contexts/SolidContext'
import { DiscoveryProvider } from '../src/contexts/DiscoveryContext'
import { WalletProvider } from '../src/contexts/WalletContext'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import React from 'react'

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
        </WalletProvider>
      </DiscoveryProvider>
    </SolidProvider>
  )
}
