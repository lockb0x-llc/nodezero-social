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

## Known issues and resolution status

| ID | Issue | Status | Fix |
|---|---|---|---|
| WR1 | `expo-secure-store` called `getValueWithKeyAsync` (native bridge method) on web, causing `TypeError` on every page load; wallet showed "Provisioning…" forever | **FIXED** testnet 778c37f | `Platform.OS === 'web'` guard in `WalletContext.tsx` passes `undefined` to `EnclaveAdapter`, triggering `MemorySecureStore` fallback |
| WR2 | On-chain WebID registration via `NodeZeroIdentity` contract | **Pending** | Requires authenticated session + funded wallet |
