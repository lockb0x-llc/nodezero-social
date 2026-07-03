# Embedded Wallet

Embedded wallet encapsulates Stellar account operations and signing flow.

## Files

- `packages/embedded-wallet/src/WalletService.ts`
- `packages/embedded-wallet/src/EnclaveAdapter.ts`
- `packages/embedded-wallet/src/types.ts`

## Architecture

```
WalletContext (mobile-app)
  └── WalletService (embedded-wallet)
        └── EnclaveAdapter (embedded-wallet)
              ├── expo-secure-store  ← native (iOS/Android)
              └── MemorySecureStore  ← web fallback
```

### EnclaveAdapter
Wraps the platform secure store behind the `ISecureStore` interface (`getItemAsync`, `setItemAsync`, `deleteItemAsync`). On native platforms, passes `expo-secure-store`. On web, passes `undefined` to trigger the built-in in-memory fallback.

### WalletService
High-level Stellar operations: derive keypair from enclave, submit Soroban contract invocations, check funding status. Defaults to Stellar TestNet (`soroban-testnet.stellar.org`).

## Platform compatibility

| Platform | Storage backend | Notes |
|---|---|---|
| iOS | expo-secure-store → iOS Secure Enclave | Hardware key isolation |
| Android | expo-secure-store → Android Keystore | Hardware key isolation |
| Web (browser) | MemorySecureStore (in-memory) | Session-scoped only — key lost on page reload |

> **Note**: The web in-memory fallback means wallet keys are not persisted across browser sessions. This is an acceptable limitation for staging UAT but requires a proper web key storage solution (e.g. IndexedDB + PBKDF2) before production.

## Responsibilities

- Account creation and secure key handling abstractions.
- Transaction signing bridge.
- Registration hooks for app onboarding and settings flows.

## Solid Pod configuration (verified 2026-06-25)

The test Solid Pod for staging is:
- **Pod URL**: `https://nodezero.solidcommunity.net/`
- **WebID**: `https://nodezero.solidcommunity.net/profile/card#me`
- **OIDC Issuer / IdP**: `https://solidcommunity.net/` (external-Pod test fixture; the app default IdP is the Node Zero Community Server at `https://solid.nodezero.social/`)
- **Pod structure**: `inbox/`, `public/`, `profile/`, `settings/`, `README`, `robots.txt`
- **Profile state**: Fresh pod — no custom `foaf:name`, no social graph (`/social/` not yet created)
- **Auth method**: CSS client credentials token exchange works (200 OK); DPoP required for write operations

Wallet registration (WR2) will write the Stellar public key to the `NodeZeroIdentity` Soroban contract using the WebID as the identifier.

## Known issues and resolution status

| ID | Issue | Status | Fix |
|---|---|---|---|
| WR1 | Wallet provisioning silently fails on web — `expo-secure-store` calls `getValueWithKeyAsync` (native-only bridge method); Settings shows "Provisioning…" forever | **FIXED** in testnet commit 778c37f | `Platform.OS === 'web'` guard in `WalletContext.tsx` skips `SecureStore` on web, using in-memory fallback |
| WR2 | On-chain WebID registration via `NodeZeroIdentity` contract | **Pass evidence exists; full authenticated QA rerun pending** | Covered by AT1 evidence in `docs/staging-uat-checklist.md`; include in J4 rerun matrix |
