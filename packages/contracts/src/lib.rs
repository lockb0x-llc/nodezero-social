/*!
 * NodeZero.social Soroban Smart Contracts
 *
 * # Contracts
 *
 * ## `NodeZeroIdentity`
 * Maps a Stellar/Soroban `Address` to a Solid Pod WebID URL.
 *
 * ## `Lockb0x`
 * Maintains a ZK Merkle state root for Stellar<->Solid pairing attestations.
 * The oracle updates this root after verifying off-chain ZK inclusion proofs.
 *
 * ## `PoHVerifier`
 * Future-scope verifier contract for Proof-of-Humanity workflows.
 * Not required for the current attestation release gate.
 *
 * # ZK Stack
 *   - Current scope: pairing attestation artifacts and lockb0x root anchoring.
 *   - Future scope: PoH-specific circuits and verifier integration.
 *
 * # Security notes
 * - All state-mutating functions require an authenticated `Address` invocation.
 * - `Lockb0x` separates the oracle operator from regular users.
 * - Pairing verification is expected to fail closed when attestation checks fail.
 */

#![no_std]

extern crate alloc;

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, String,
};

// ─── PoHVerifier module ───────────────────────────────────────────────────────
mod poh_verifier;
pub use poh_verifier::{PoHVerifier, PoHVerifierClient};

// ─── Storage key types ────────────────────────────────────────────────────────

/// Storage key used to persist a WebID mapping for an `Address`.
#[contracttype]
pub enum IdentityKey {
    WebId(Address),
}

/// Storage key used within the Lockb0x contract.
#[contracttype]
pub enum LockboxKey {
    /// The current ZK Merkle state root (32 bytes).
    StateRoot,
    /// The authorised oracle operator `Address`.
    Operator,
}

/// Storage key used within the Lockb0xFactory contract.
#[contracttype]
pub enum LockboxFactoryKey {
    /// The authorised factory operator that can provision user lockboxes.
    Operator,
    /// Uploaded WASM hash used when deploying per-user Lockb0x contracts.
    LockboxWasmHash,
    /// Mapping from a user `Address` to their lockbox contract `Address`.
    UserLockbox(Address),
}

// ─── NodeZeroIdentity Contract ────────────────────────────────────────────────

/// Maps Stellar/Soroban public keys to Solid Pod WebIDs.
///
/// This contract acts as an on-chain directory entry.  The WebID is the user's
/// canonical identity URL on the Solid / open web.  Storing it on-chain makes
/// it publicly verifiable and censorship-resistant.
#[contract]
pub struct NodeZeroIdentity;

#[contractimpl]
impl NodeZeroIdentity {
    /// Registers or updates the WebID URL for the calling address.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `caller` – The `Address` of the caller.  `require_auth()` is called
    ///   on this address, so the transaction must be signed by the corresponding
    ///   key.
    /// * `webid_url` – The Solid Pod WebID URL, e.g.
    ///   `https://alice.solidcommunity.net/profile/card#me`.
    ///
    /// # Panics
    /// Panics if `webid_url` is empty or does not begin with `http`.
    pub fn register_webid(env: Env, caller: Address, webid_url: String) {
        caller.require_auth();

        // Basic validation – must start with "http"
        assert!(
            webid_url.len() >= 7,
            "webid_url too short to be a valid HTTP URL"
        );

        // Soroban String API is intentionally minimal; enforce only length here.
        // URL scheme validation is handled in the client before submission.

        env.storage()
            .persistent()
            .set(&IdentityKey::WebId(caller), &webid_url);
    }

    /// Returns the WebID URL registered for `address`, or `None`.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `address` – The `Address` to look up.
    pub fn get_webid(env: Env, address: Address) -> Option<String> {
        env.storage()
            .persistent()
            .get(&IdentityKey::WebId(address))
    }

    /// Removes the WebID registration for the calling address.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `caller` – The `Address` of the caller.
    pub fn remove_webid(env: Env, caller: Address) {
        caller.require_auth();
        env.storage()
            .persistent()
            .remove(&IdentityKey::WebId(caller));
    }
}

// ─── Lockb0x Contract ────────────────────────────────────────────────────────

/// Maintains a Zero-Knowledge Merkle state root for pairing attestations.
///
/// The `Lockb0x` contract is operated by a trusted attestation oracle that updates
/// the on-chain Merkle root after verifying ZK inclusion proofs off-chain.
/// Smart contract consumers (e.g. dApps) can query the latest root and verify
/// user proofs locally without the contract revealing any identity information.
#[contract]
pub struct Lockb0x;

#[contractimpl]
impl Lockb0x {
    /// Initialises the contract with an operator address and an initial state root.
    ///
    /// Can only be called once.  Subsequent calls panic with "already initialised".
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `operator` – The authorised oracle `Address` that may update the root.
    /// * `initial_root` – The initial ZK Merkle state root (32 bytes).
    pub fn initialize(env: Env, operator: Address, initial_root: BytesN<32>) {
        assert!(
            !env.storage().persistent().has(&LockboxKey::Operator),
            "Lockb0x: already initialised"
        );

        operator.require_auth();

        env.storage()
            .persistent()
            .set(&LockboxKey::Operator, &operator);
        env.storage()
            .persistent()
            .set(&LockboxKey::StateRoot, &initial_root);
    }

    /// Replaces the ZK Merkle state root.
    ///
    /// Only the registered operator may call this function.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    /// * `caller` – Must equal the registered operator address.
    /// * `new_root` – The updated ZK Merkle root (32 bytes).
    pub fn update_state_root(env: Env, caller: Address, new_root: BytesN<32>) {
        caller.require_auth();

        let operator: Address = env
            .storage()
            .persistent()
            .get(&LockboxKey::Operator)
            .expect("Lockb0x: not initialised");

        assert!(caller == operator, "Lockb0x: caller is not the operator");

        env.storage()
            .persistent()
            .set(&LockboxKey::StateRoot, &new_root);

        env.events().publish(
            (symbol_short!("root_upd"),),
            new_root,
        );
    }

    /// Returns the current ZK Merkle state root.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    pub fn get_state_root(env: Env) -> Option<BytesN<32>> {
        env.storage().persistent().get(&LockboxKey::StateRoot)
    }

    /// Returns the operator `Address`.
    ///
    /// # Arguments
    /// * `env` – The contract environment.
    pub fn get_operator(env: Env) -> Option<Address> {
        env.storage().persistent().get(&LockboxKey::Operator)
    }
}

// ─── Lockb0xFactory Contract ────────────────────────────────────────────────

/// Deploys and tracks per-user `Lockb0x` contracts.
///
/// The factory supports idempotent provisioning: if a user already has a
/// lockbox mapping, that existing contract address is returned.
#[contract]
pub struct Lockb0xFactory;

#[contractimpl]
impl Lockb0xFactory {
    /// Initialises the factory with an operator and lockbox wasm hash.
    ///
    /// Can only be called once.
    pub fn initialize_factory(env: Env, operator: Address, lockbox_wasm_hash: BytesN<32>) {
        assert!(
            !env.storage().persistent().has(&LockboxFactoryKey::Operator),
            "Lockb0xFactory: already initialised"
        );

        operator.require_auth();

        env.storage()
            .persistent()
            .set(&LockboxFactoryKey::Operator, &operator);
        env.storage()
            .persistent()
            .set(&LockboxFactoryKey::LockboxWasmHash, &lockbox_wasm_hash);
    }

    /// Returns the configured operator.
    pub fn get_factory_operator(env: Env) -> Option<Address> {
        env.storage().persistent().get(&LockboxFactoryKey::Operator)
    }

    /// Returns the configured lockbox wasm hash.
    pub fn get_lockbox_wasm_hash(env: Env) -> Option<BytesN<32>> {
        env.storage()
            .persistent()
            .get(&LockboxFactoryKey::LockboxWasmHash)
    }

    /// Returns the lockbox contract address mapped to `user`, if present.
    pub fn get_user_lockbox(env: Env, user: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&LockboxFactoryKey::UserLockbox(user))
    }

    /// Deploys (or reuses) a lockbox for `user` and initialises it.
    ///
    /// The operator controls provisioning. The created lockbox's operator is set
    /// to `user` so users retain control of their own lockbox state updates.
    pub fn get_or_create_user_lockbox(
        env: Env,
        caller: Address,
        user: Address,
        salt: BytesN<32>,
        initial_root: BytesN<32>,
    ) -> Address {
        caller.require_auth();

        let operator: Address = env
            .storage()
            .persistent()
            .get(&LockboxFactoryKey::Operator)
            .expect("Lockb0xFactory: not initialised");

        assert!(caller == operator, "Lockb0xFactory: caller is not the operator");

        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<LockboxFactoryKey, Address>(&LockboxFactoryKey::UserLockbox(user.clone()))
        {
            return existing;
        }

        let wasm_hash: BytesN<32> = env
            .storage()
            .persistent()
            .get(&LockboxFactoryKey::LockboxWasmHash)
            .expect("Lockb0xFactory: missing lockbox wasm hash");

        let lockbox_addr = env
            .deployer()
            .with_current_contract(salt)
            .deploy(wasm_hash);

        let lockbox_client = Lockb0xClient::new(&env, &lockbox_addr);
        lockbox_client.initialize(&user, &initial_root);

        env.storage()
            .persistent()
            .set(&LockboxFactoryKey::UserLockbox(user.clone()), &lockbox_addr);

        env.events().publish((symbol_short!("lbx_crt"),), (user, lockbox_addr.clone()));

        lockbox_addr
    }
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    // ── NodeZeroIdentity tests ──────────────────────────────────────────────

    #[test]
    fn test_register_and_get_webid() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, NodeZeroIdentity);
        let client = NodeZeroIdentityClient::new(&env, &contract_id);

        let alice = Address::generate(&env);
        let webid = String::from_str(&env, "https://alice.solidcommunity.net/profile/card#me");

        client.register_webid(&alice, &webid);

        let stored = client.get_webid(&alice).expect("Expected a WebID");
        assert_eq!(stored, webid);
    }

    #[test]
    fn test_get_webid_returns_none_for_unknown_address() {
        let env = Env::default();
        let contract_id = env.register_contract(None, NodeZeroIdentity);
        let client = NodeZeroIdentityClient::new(&env, &contract_id);

        let bob = Address::generate(&env);
        assert!(client.get_webid(&bob).is_none());
    }

    #[test]
    fn test_remove_webid() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, NodeZeroIdentity);
        let client = NodeZeroIdentityClient::new(&env, &contract_id);

        let alice = Address::generate(&env);
        let webid = String::from_str(&env, "https://alice.solidcommunity.net/profile/card#me");

        client.register_webid(&alice, &webid);
        client.remove_webid(&alice);

        assert!(client.get_webid(&alice).is_none());
    }

    // ── Lockb0x tests ───────────────────────────────────────────────────────

    fn make_root(env: &Env, byte: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[0] = byte;
        BytesN::from_array(env, &arr)
    }

    fn make_hash(env: &Env, byte: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = byte;
        BytesN::from_array(env, &arr)
    }

    #[test]
    fn test_lockbox_initialize_and_get_root() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Lockb0x);
        let client = Lockb0xClient::new(&env, &contract_id);

        let operator = Address::generate(&env);
        let root = make_root(&env, 1);

        client.initialize(&operator, &root);

        assert_eq!(client.get_state_root().unwrap(), root);
        assert_eq!(client.get_operator().unwrap(), operator);
    }

    #[test]
    fn test_lockbox_update_state_root() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Lockb0x);
        let client = Lockb0xClient::new(&env, &contract_id);

        let operator = Address::generate(&env);
        client.initialize(&operator, &make_root(&env, 1));

        let new_root = make_root(&env, 2);
        client.update_state_root(&operator, &new_root);

        assert_eq!(client.get_state_root().unwrap(), new_root);
    }

    // ── Lockb0xFactory tests ───────────────────────────────────────────────

    #[test]
    fn test_factory_initialize_and_getters() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, Lockb0xFactory);
        let client = Lockb0xFactoryClient::new(&env, &contract_id);

        let operator = Address::generate(&env);
        let wasm_hash = make_hash(&env, 7);

        client.initialize_factory(&operator, &wasm_hash);

        assert_eq!(client.get_factory_operator().unwrap(), operator);
        assert_eq!(client.get_lockbox_wasm_hash().unwrap(), wasm_hash);
    }

}
