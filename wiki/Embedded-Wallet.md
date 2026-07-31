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
              └── IndexedDbSecureStore ← encrypted PWA storage
```

### EnclaveAdapter
Wraps the platform secure store behind the `ISecureStore` interface
(`getItemAsync`, `setItemAsync`, `deleteItemAsync`). Native platforms use
`expo-secure-store`; the PWA injects `IndexedDbSecureStore`.

### IndexedDbSecureStore
Each logical wallet record is AES-256-GCM encrypted with a random 12-byte IV.
The profile/schema/key name is authenticated as additional data. The wrapping
key is non-extractable and stored by the browser's IndexedDB implementation.

### WalletService
High-level Stellar operations: derive keypair from enclave, submit Soroban contract invocations, check funding status. Defaults to Stellar TestNet (`soroban-testnet.stellar.org`).

## Platform compatibility

| Platform | Storage backend | Notes |
|---|---|---|
| iOS | expo-secure-store → iOS Secure Enclave | Hardware key isolation |
| Android | expo-secure-store → Android Keystore | Hardware key isolation |
| Web/PWA | Encrypted profile-scoped IndexedDB | Persists across reload/browser close; no plaintext localStorage key |

## Responsibilities

- Account creation and secure key handling abstractions.
- Transaction signing bridge.
- Registration hooks for app onboarding and settings flows.

## Recovery

Settings exports a versioned recovery bundle containing the Stellar secret.
The signed-out landing screen can restore it after validating the environment
profile, Stellar network passphrase, and public/secret key formats. The imported
identity is immediately encrypted into IndexedDB; the user then taps Sign In.

Wallet registration (WR2) will write the Stellar public key to the `NodeZeroIdentity` Soroban contract using the WebID as the identifier.

## Known issues and resolution status

| ID | Issue | Status | Fix |
|---|---|---|---|
| WR1 | Empty browser wallet looked permanently stuck at “Preparing wallet…” | **FIXED** in `v0.2.0-testnet` | Explicit Create/Restore actions and accurate disabled-button labels. |
| WR2 | Retained web wallet and returning lockb0x validation | **PASS** | Automated release gate plus retained mobile close/reopen acceptance. |
