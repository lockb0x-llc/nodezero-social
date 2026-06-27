/*!
 * NodeZero.social Soroban Smart Contracts
 *
 * # Contracts
 *
 * ## `NodeZeroIdentity`
 * Maps a Stellar/Soroban `Address` (user's embedded wallet public key) to
 * their decentralised Solid Pod `WebID` URL.  This bridges the user's
 * self-sovereign Web3 identity to their off-chain data Pod.
 *
 * ## `Lockb0x`
 * Maintains a Zero-Knowledge state root for Proof of Humanity (PoH).
 * An authorised operator (the NodeZero PoH oracle) can update the Merkle
 * root that ZK proofs are verified against, without revealing the underlying
 * identity set.  This ensures one human = one account without a public
 * identity list.
 *
 * # Security notes
 * - All state-mutating functions require an authenticated `Address` invocation
 *   (enforced by `require_auth()`).
 * - The `Lockb0x` contract separates the oracle operator from regular users.
 * - `WebID` URLs are validated to be non-empty strings starting with `http`.
 */

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, String,
};

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

        // String::slice() does not exist in soroban-sdk 20.x; copy into a
        // stack buffer and compare the first 4 bytes directly.
        let url_len = webid_url.len() as usize;
        let mut buf = [0u8; 2048];
        assert!(url_len <= buf.len(), "webid_url too long");
        webid_url.copy_into_slice(&mut buf[..url_len]);
        assert!(&buf[..4] == b"http", "webid_url must start with 'http'");

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

/// Maintains a Zero-Knowledge Merkle state root for Proof of Humanity (PoH).
///
/// The `Lockb0x` contract is operated by a trusted PoH oracle that updates the
/// on-chain Merkle root after verifying ZK inclusion proofs off-chain.
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
}
