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
 *   NZ_NODEZERO_ISSUER_URL  – Node Zero Community Server origin (Pod host).
 *                             Users never authenticate against it directly;
 *                             all Pod traffic flows through the provisioner
 *                             Pod Access Proxy. Local/staging default to the
 *                             hosted staging Community Server
 *                             (https://solid.nodezero.social/);
 *                             production-mainnet must set it explicitly.
 *   NZ_JSS_PROVISIONER_URL  – NodeZero provisioner base URL (session issuance
 *                             + Pod Access Proxy). Required for strict profiles.
 */

/** @type {import('@expo/config').ExpoConfig} */
const envProfile = process.env.NZ_ENV_PROFILE ?? 'local'

const profiles = {
  local: {
    rpcUrl: process.env.NZ_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    passphrase:
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    enforceStrictVariables: false,
  },
  'staging-testnet': {
    rpcUrl: process.env.NZ_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
    passphrase:
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    enforceStrictVariables: true,
  },
  'production-mainnet': {
    rpcUrl: process.env.NZ_STELLAR_RPC_URL ?? 'https://soroban.stellar.org',
    passphrase:
      process.env.NZ_STELLAR_NETWORK_PASSPHRASE ?? 'Public Global Stellar Network ; September 2015',
    enforceStrictVariables: true,
  },
}

if (!profiles[envProfile]) {
  throw new Error(
    `Invalid NZ_ENV_PROFILE '${envProfile}'. Allowed values: local, staging-testnet, production-mainnet.`
  )
}

const profile = profiles[envProfile]
const relayUrl = process.env.NZ_RELAY_URL ?? ''
const identityContractId = process.env.NZ_IDENTITY_CONTRACT_ID ?? ''
const lockboxContractId = process.env.NZ_LOCKBOX_CONTRACT_ID ?? ''
const lockboxFactoryContractId = process.env.NZ_LOCKBOX_FACTORY_CONTRACT_ID ?? ''
const zkArtifactsUrl = process.env.NZ_ZK_ARTIFACTS_URL ?? ''
const zkManifestUrl = process.env.NZ_ZK_MANIFEST_URL ?? ''
// The Node Zero Community Server hosts every user's Pod. Users never
// authenticate against it directly — all Pod traffic flows through the
// provisioner's Pod Access Proxy — but the origin is still needed to
// recognise Pod URLs and derive the expected WebID at signup.
// Production-mainnet must configure its own host explicitly (never inherit
// the staging URL).
const nodeZeroIssuerUrl =
  process.env.NZ_NODEZERO_ISSUER_URL ??
  (envProfile === 'production-mainnet' ? '' : 'https://solid.nodezero.social/')
const jssProvisionerUrl =
  process.env.NZ_JSS_PROVISIONER_URL ??
  (envProfile === 'staging-testnet' ? 'https://nodezero-social-staging-testnet-provisioner.azurewebsites.net' : '')
const qaLocalOverridesEnabled = process.env.NZ_QA_LOCAL_OVERRIDES_ENABLED ?? 'false'
const seamlessOnboardingEnabled =
  process.env.NZ_SEAMLESS_ONBOARDING_ENABLED ?? (envProfile === 'staging-testnet' ? 'true' : 'false')
const solidBootstrapEnabled = process.env.NZ_SOLID_BOOTSTRAP_ENABLED ?? 'false'
function nonEmptyEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const mashlibExplorerEnabled =
  nonEmptyEnv('NZ_MASHLIB_EXPLORER_ENABLED') ?? (envProfile === 'staging-testnet' ? 'true' : 'false')
const mashlibModuleId =
  nonEmptyEnv('NZ_MASHLIB_MODULE_ID') ?? (envProfile === 'staging-testnet' ? 'nodezero:mashlib-pane-provider' : '')
const nodeZeroDirectoryUrl = nonEmptyEnv('NZ_NODEZERO_DIRECTORY_URL') ?? ''

if (profile.enforceStrictVariables) {
  if (!relayUrl) {
    throw new Error(`NZ_RELAY_URL is required for ${envProfile}.`)
  }
  if (!identityContractId || !lockboxContractId) {
    throw new Error(`NZ_IDENTITY_CONTRACT_ID and NZ_LOCKBOX_CONTRACT_ID are required for ${envProfile}.`)
  }
  if (!zkArtifactsUrl || !zkManifestUrl) {
    throw new Error(`NZ_ZK_ARTIFACTS_URL and NZ_ZK_MANIFEST_URL are required for ${envProfile}.`)
  }
  if (!nodeZeroIssuerUrl) {
    throw new Error(`NZ_NODEZERO_ISSUER_URL (Node Zero Community Server / Pod host) is required for ${envProfile}.`)
  }
  // The provisioner issues NodeZero sessions and proxies all Pod traffic;
  // without it there is no authentication path at all (fail-closed).
  if (!jssProvisionerUrl) {
    throw new Error(`NZ_JSS_PROVISIONER_URL is required for ${envProfile}.`)
  }
}

if (envProfile === 'staging-testnet' && relayUrl) {
  const normalizedRelayUrl = relayUrl.toLowerCase().trim()
  const pointsToSwaShell =
    (normalizedRelayUrl === 'wss://staging.nodezero.social/relay' ||
      normalizedRelayUrl === 'https://staging.nodezero.social/relay')

  if (pointsToSwaShell) {
    throw new Error(
      'NZ_RELAY_URL for staging-testnet points to the Static Web App shell path (/relay), which does not terminate WebSocket signaling. Set NZ_RELAY_URL to a live relay host endpoint.'
    )
  }
}

if (envProfile === 'staging-testnet' && profile.passphrase !== 'Test SDF Network ; September 2015') {
  throw new Error('Staging profile must use the Stellar TestNet passphrase.')
}

if (envProfile === 'production-mainnet' && profile.passphrase !== 'Public Global Stellar Network ; September 2015') {
  throw new Error('Production profile must use the Stellar MainNet passphrase.')
}

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
    envProfile,
    nodeZeroIssuerUrl,
    nodeZeroDirectoryUrl,
    jssProvisionerUrl,
    qaLocalOverridesEnabled,
    seamlessOnboardingEnabled,
    solidBootstrapEnabled,
    mashlibExplorerEnabled,
    mashlibModuleId,
    primaryColor: process.env.NZ_PRIMARY_COLOR ?? '#6C63FF',
    backgroundColor: process.env.NZ_BACKGROUND_COLOR ?? '#0D0D0D',
    relayUrl,
    stellarRpcUrl: profile.rpcUrl,
    stellarNetworkPassphrase: profile.passphrase,
    identityContractId,
    lockboxContractId,
    lockboxFactoryContractId,
    zkArtifactsUrl,
    zkManifestUrl,
  },
}
