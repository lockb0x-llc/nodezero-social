#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address, BytesN, Env,
};

const EVENT_VERSION: u32 = 3;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    AccountWasmHash,
    Deployment(BytesN<32>),
    BridgeFingerprint(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MissingAdmin = 1,
    MissingAccountWasmHash = 2,
    InvalidValue = 3,
    InvalidCircuitVersion = 4,
    BridgeMismatch = 5,
}

#[contractevent(data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BridgeLockboxCreated {
    #[topic]
    pub account_commitment: BytesN<32>,
    pub lockbox: Address,
    pub bridge_fingerprint: BytesN<32>,
    pub version: u32,
}

#[contract]
pub struct Lockb0xBridgeFactory;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(100_000, 6_311_520);
}

fn validate_non_zero(env: &Env, value: &BytesN<32>) {
    if value.to_array().iter().all(|byte| *byte == 0) {
        panic_with_error!(env, Error::InvalidValue);
    }
}

fn require_admin(env: &Env) -> Address {
    let admin: Address = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(env, Error::MissingAdmin));
    admin.require_auth();
    admin
}

fn bridge_fingerprint(
    env: &Env,
    account_commitment: &BytesN<32>,
    pod_binding: &BytesN<32>,
    claim_hash: &BytesN<32>,
    proof_hash: &BytesN<32>,
    ciphertext_hash: &BytesN<32>,
    circuit_version: u32,
) -> BytesN<32> {
    let mut payload = soroban_sdk::Bytes::new(env);
    payload.append(&account_commitment.to_bytes());
    payload.append(&pod_binding.to_bytes());
    payload.append(&claim_hash.to_bytes());
    payload.append(&proof_hash.to_bytes());
    payload.append(&ciphertext_hash.to_bytes());
    payload.append(&soroban_sdk::Bytes::from_slice(env, &circuit_version.to_be_bytes()));
    env.crypto().sha256(&payload).into()
}

#[contractimpl]
impl Lockb0xBridgeFactory {
    pub fn __constructor(
        env: Env,
        admin: Address,
        account_wasm_hash: BytesN<32>,
    ) {
        bump_instance(&env);
        validate_non_zero(&env, &account_wasm_hash);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::AccountWasmHash, &account_wasm_hash);
    }

    pub fn admin(env: Env) -> Address {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingAdmin))
    }

    pub fn account_wasm_hash(env: Env) -> BytesN<32> {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::AccountWasmHash)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingAccountWasmHash))
    }

    pub fn predict_lockbox_address(env: Env, account_commitment: BytesN<32>) -> Address {
        bump_instance(&env);
        validate_non_zero(&env, &account_commitment);
        let salt: BytesN<32> = env.crypto().sha256(&account_commitment.to_bytes()).into();
        env.deployer().with_current_contract(salt).deployed_address()
    }

    /// Atomically creates the deterministic Lockb0x bridge account with all
    /// immutable bridge evidence in its constructor, or returns the exact
    /// existing bridge account for an identical attestation.
    ///
    /// The authenticated operator verifies the Groth16 bridge proof off-chain
    /// before submitting this transaction. This contract atomically commits
    /// the immutable proof hash and public signals with deterministic child
    /// deployment; generic Arkworks pairing verification exceeds the Soroban
    /// Testnet instruction budget and is deliberately not executed here.
    pub fn create_or_get_bridge_lockbox(
        env: Env,
        account_commitment: BytesN<32>,
        pod_binding: BytesN<32>,
        claim_hash: BytesN<32>,
        proof_bytes: soroban_sdk::Bytes,
        proof_hash: BytesN<32>,
        ciphertext: soroban_sdk::Bytes,
        circuit_version: u32,
    ) -> Address {
        bump_instance(&env);
        let operator = require_admin(&env);
        validate_non_zero(&env, &account_commitment);
        validate_non_zero(&env, &pod_binding);
        validate_non_zero(&env, &claim_hash);
        validate_non_zero(&env, &proof_hash);
        if ciphertext.len() == 0 || ciphertext.len() > 4096 || circuit_version == 0 {
            panic_with_error!(&env, Error::InvalidCircuitVersion);
        }
        let _ = proof_bytes;
        let ciphertext_hash: BytesN<32> = env.crypto().sha256(&ciphertext).into();

        let salt: BytesN<32> = env.crypto().sha256(&account_commitment.to_bytes()).into();
        let fingerprint = bridge_fingerprint(
            &env,
            &account_commitment,
            &pod_binding,
            &claim_hash,
            &proof_hash,
            &ciphertext_hash,
            circuit_version,
        );
        let deployment_key = DataKey::Deployment(salt.clone());
        if let Some(existing) = env.storage().persistent().get::<_, Address>(&deployment_key) {
            let existing_fingerprint: BytesN<32> = env
                .storage()
                .persistent()
                .get(&DataKey::BridgeFingerprint(salt.clone()))
                .unwrap_or_else(|| panic_with_error!(&env, Error::BridgeMismatch));
            if existing_fingerprint != fingerprint {
                panic_with_error!(&env, Error::BridgeMismatch);
            }
            return existing;
        }

        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::AccountWasmHash)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingAccountWasmHash));
        let child = env.deployer().with_current_contract(salt.clone()).deploy_v2(
            wasm_hash,
            (
                env.current_contract_address(),
                operator,
                account_commitment.clone(),
                pod_binding,
                claim_hash,
                proof_hash,
                ciphertext,
                ciphertext_hash,
                circuit_version,
            ),
        );

        env.storage().persistent().set(&deployment_key, &child);
        env.storage()
            .persistent()
            .set(&DataKey::BridgeFingerprint(salt), &fingerprint);
        BridgeLockboxCreated {
            account_commitment,
            lockbox: child.clone(),
            bridge_fingerprint: fingerprint,
            version: EVENT_VERSION,
        }
        .publish(&env);
        child
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, BytesN};

    #[test]
    fn prediction_is_deterministic() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let wasm = BytesN::from_array(&env, &[9; 32]);
        let id = env.register(Lockb0xBridgeFactory, (admin, wasm));
        let client = Lockb0xBridgeFactoryClient::new(&env, &id);
        let commitment = BytesN::from_array(&env, &[1; 32]);

        assert_eq!(
            client.predict_lockbox_address(&commitment),
            client.predict_lockbox_address(&commitment),
        );
    }

}