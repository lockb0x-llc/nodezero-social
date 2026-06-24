/**
 * App configuration for NodeZero.social.
 *
 * All branding, bundle identifiers, and colour tokens are pulled from
 * environment variables so that staging / production / whitelabel builds
 * can be produced without editing source code.
 *
 * Required environment variables (set in CI or .env):
 *   NZ_APP_NAME          – Display name shown on the device (default: "NodeZero")
 *   NZ_BUNDLE_ID         – iOS bundle ID / Android package (default: "com.nodezero.social")
 *   NZ_PRIMARY_COLOR     – Brand primary hex colour (default: "#6C63FF")
 *   NZ_BACKGROUND_COLOR  – Splash/background hex colour (default: "#0D0D0D")
 *   NZ_RELAY_URL         – WebSocket URL for the P2P signalling relay
 *   NZ_STELLAR_RPC_URL   – Stellar Soroban RPC URL
 *   NZ_STELLAR_NETWORK_PASSPHRASE – Stellar network passphrase
 *   NZ_IDENTITY_CONTRACT_ID – NodeZeroIdentity contract ID on Testnet
 *   NZ_LOCKBOX_CONTRACT_ID  – Lockb0x contract ID on Testnet
 *   NZ_ZK_ARTIFACTS_URL     – Published ZK artifacts base URL
 *   NZ_ZK_MANIFEST_URL      – ZK artifact manifest URL
 */

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  name: process.env.NZ_APP_NAME ?? 'NodeZero',
  slug: 'nodezero-social',
  version: '0.0.1',
  orientation: 'portrait',
  scheme: 'nodezero',

  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',

  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: process.env.NZ_BACKGROUND_COLOR ?? '#0D0D0D',
  },

  ios: {
    bundleIdentifier: process.env.NZ_BUNDLE_ID ?? 'com.nodezero.social',
    supportsTablet: false,
  },

  android: {
    package: process.env.NZ_BUNDLE_ID ?? 'com.nodezero.social',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: process.env.NZ_BACKGROUND_COLOR ?? '#0D0D0D',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
  },

  web: {
    favicon: './assets/favicon.png',
  },

  plugins: ['expo-router', 'expo-secure-store', 'expo-location'],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    primaryColor: process.env.NZ_PRIMARY_COLOR ?? '#6C63FF',
    backgroundColor: process.env.NZ_BACKGROUND_COLOR ?? '#0D0D0D',
    relayUrl: process.env.NZ_RELAY_URL ?? 'wss://relay.nodezero.social',
    stellarRpcUrl: process.env.NZ_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    stellarNetworkPassphrase:
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    identityContractId: process.env.NZ_IDENTITY_CONTRACT_ID ?? '',
    lockboxContractId: process.env.NZ_LOCKBOX_CONTRACT_ID ?? '',
    zkArtifactsUrl: process.env.NZ_ZK_ARTIFACTS_URL ?? '',
    zkManifestUrl: process.env.NZ_ZK_MANIFEST_URL ?? '',
  },
}
