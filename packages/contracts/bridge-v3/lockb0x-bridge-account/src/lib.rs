#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN, Env,
};

const EVENT_VERSION: u32 = 3;

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Factory,
    Operator,
    AccountCommitment,
    PodBinding,
    ClaimHash,
    ProofHash,
    Ciphertext,
    CiphertextHash,
    CircuitVersion,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MissingFactory = 1,
    MissingOperator = 2,
    MissingBridgeState = 3,
    InvalidCommitment = 4,
    InvalidCircuitVersion = 5,
    Unauthorized = 6,
}

#[contractevent(data_format = "vec")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BridgeInitialized {
    #[topic]
    pub account_commitment: BytesN<32>,
    pub pod_binding: BytesN<32>,
    pub proof_hash: BytesN<32>,
    pub circuit_version: u32,
    pub version: u32,
}

#[contract]
pub struct Lockb0xBridgeAccount;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(100_000, 6_311_520);
}

fn non_zero(env: &Env, value: &BytesN<32>) {
    if value.to_array().iter().all(|byte| *byte == 0) {
        panic_with_error!(env, Error::InvalidCommitment);
    }
}

#[contractimpl]
impl Lockb0xBridgeAccount {
    /// All bridge state is initialized by the factory constructor invocation.
    /// There is deliberately no public post-deploy initialize operation.
    pub fn __constructor(
        env: Env,
        factory: Address,
        operator: Address,
        account_commitment: BytesN<32>,
        pod_binding: BytesN<32>,
        claim_hash: BytesN<32>,
        proof_hash: BytesN<32>,
        ciphertext: Bytes,
        ciphertext_hash: BytesN<32>,
        circuit_version: u32,
    ) {
        bump_instance(&env);
        non_zero(&env, &account_commitment);
        non_zero(&env, &pod_binding);
        non_zero(&env, &claim_hash);
        non_zero(&env, &proof_hash);
        non_zero(&env, &ciphertext_hash);
        if circuit_version == 0 || ciphertext.len() == 0 || ciphertext.len() > 4096 {
            panic_with_error!(&env, Error::InvalidCircuitVersion);
        }

        env.storage().instance().set(&DataKey::Factory, &factory);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage()
            .instance()
            .set(&DataKey::AccountCommitment, &account_commitment);
        env.storage().instance().set(&DataKey::PodBinding, &pod_binding);
        env.storage().instance().set(&DataKey::ClaimHash, &claim_hash);
        env.storage().instance().set(&DataKey::ProofHash, &proof_hash);
        env.storage().instance().set(&DataKey::Ciphertext, &ciphertext);
        env.storage()
            .instance()
            .set(&DataKey::CiphertextHash, &ciphertext_hash);
        env.storage()
            .instance()
            .set(&DataKey::CircuitVersion, &circuit_version);

        BridgeInitialized {
            account_commitment,
            pod_binding,
            proof_hash,
            circuit_version,
            version: EVENT_VERSION,
        }
        .publish(&env);
    }

    pub fn factory(env: Env) -> Address {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Factory)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingFactory))
    }

    pub fn operator(env: Env) -> Address {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Operator)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingOperator))
    }

    pub fn bridge_state(
        env: Env,
    ) -> (BytesN<32>, BytesN<32>, BytesN<32>, BytesN<32>, BytesN<32>, u32) {
        bump_instance(&env);
        let state = (
            env.storage().instance().get(&DataKey::AccountCommitment),
            env.storage().instance().get(&DataKey::PodBinding),
            env.storage().instance().get(&DataKey::ClaimHash),
            env.storage().instance().get(&DataKey::ProofHash),
            env.storage().instance().get(&DataKey::CiphertextHash),
            env.storage().instance().get(&DataKey::CircuitVersion),
        );
        match state {
            (Some(account_commitment), Some(pod_binding), Some(claim_hash), Some(proof_hash), Some(ciphertext_hash), Some(circuit_version)) => {
                (account_commitment, pod_binding, claim_hash, proof_hash, ciphertext_hash, circuit_version)
            }
            _ => panic_with_error!(&env, Error::MissingBridgeState),
        }
    }

    /// Compatibility getter used by the existing NodeZero return-sign-in
    /// verification path. The value is the V3 constructor's immutable bridge
    /// account commitment.
    pub fn get_account_commitment(env: Env) -> BytesN<32> {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::AccountCommitment)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingBridgeState))
    }

    pub fn attestation_ciphertext(env: Env) -> Bytes {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::Ciphertext)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingBridgeState))
    }

    pub fn get_attestation_ciphertext(env: Env) -> Bytes {
        Self::attestation_ciphertext(env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, BytesN};

    #[test]
    fn constructor_persists_bridge_state() {
        let env = Env::default();
        let factory = Address::generate(&env);
        let operator = Address::generate(&env);
        let account = BytesN::from_array(&env, &[1; 32]);
        let pod = BytesN::from_array(&env, &[2; 32]);
        let claim = BytesN::from_array(&env, &[3; 32]);
        let proof = BytesN::from_array(&env, &[4; 32]);
        let cipher = BytesN::from_array(&env, &[5; 32]);
        let ciphertext = Bytes::from_slice(&env, &[1, 2, 3]);
        let id = env.register(
            Lockb0xBridgeAccount,
            (
                factory.clone(),
                operator.clone(),
                account.clone(),
                pod.clone(),
                claim.clone(),
                proof.clone(),
                ciphertext.clone(),
                cipher.clone(),
                1u32,
            ),
        );
        let client = Lockb0xBridgeAccountClient::new(&env, &id);

        assert_eq!(client.factory(), factory);
        assert_eq!(client.operator(), operator);
        assert_eq!(client.bridge_state(), (account.clone(), pod, claim, proof, cipher, 1));
        assert_eq!(client.get_account_commitment(), account);
        assert_eq!(client.attestation_ciphertext(), ciphertext);
    }
}