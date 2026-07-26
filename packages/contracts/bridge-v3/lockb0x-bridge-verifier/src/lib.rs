#![no_std]

extern crate alloc;

use alloc::vec::Vec;
use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::PrimeField;
use ark_groth16::{Groth16, Proof, VerifyingKey};
use ark_serialize::CanonicalDeserialize;
use ark_snark::SNARK;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Bytes, BytesN,
    Env,
};

#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

const PROOF_LEN_BYTES: u32 = 256;
const BN254_SCALAR_FIELD_ORDER_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58,
    0x5d, 0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00,
    0x00, 0x01,
];

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    VerificationKey,
    CircuitVersion,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MissingAdmin = 1,
    MissingVerificationKey = 2,
    InvalidCircuitVersion = 3,
    InvalidProofLength = 4,
    InvalidProofHash = 5,
    InvalidProof = 6,
}

#[contract]
pub struct Lockb0xBridgeVerifier;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(100_000, 6_311_520);
}

fn bytes_to_vec(bytes: &Bytes) -> Vec<u8> {
    let mut output = Vec::with_capacity(bytes.len() as usize);
    for index in 0..bytes.len() {
        output.push(bytes.get(index).unwrap());
    }
    output
}

fn field_from_bytes(value: &BytesN<32>) -> Fr {
    Fr::from_be_bytes_mod_order(&value.to_array())
}

fn is_canonical_scalar(value: &BytesN<32>) -> bool {
    let raw = value.to_array();
    for index in 0..32 {
        if raw[index] < BN254_SCALAR_FIELD_ORDER_BE[index] {
            return true;
        }
        if raw[index] > BN254_SCALAR_FIELD_ORDER_BE[index] {
            return false;
        }
    }
    false
}

fn fq_from_slice(value: &[u8]) -> Fq {
    Fq::from_be_bytes_mod_order(value)
}

fn proof_from_bytes(env: &Env, bytes: &Bytes) -> Proof<Bn254> {
    if bytes.len() != PROOF_LEN_BYTES {
        panic_with_error!(env, Error::InvalidProofLength);
    }
    let raw = bytes_to_vec(bytes);
    let a = G1Affine::new(fq_from_slice(&raw[0..32]), fq_from_slice(&raw[32..64]));
    let b = G2Affine::new(
        Fq2::new(fq_from_slice(&raw[64..96]), fq_from_slice(&raw[96..128])),
        Fq2::new(fq_from_slice(&raw[128..160]), fq_from_slice(&raw[160..192])),
    );
    let c = G1Affine::new(fq_from_slice(&raw[192..224]), fq_from_slice(&raw[224..256]));
    Proof { a, b, c }
}

fn expected_proof_hash(
    env: &Env,
    proof_bytes: &Bytes,
    claim_hash: &BytesN<32>,
    account_commitment: &BytesN<32>,
    pod_binding: &BytesN<32>,
) -> BytesN<32> {
    let mut payload = proof_bytes.clone();
    payload.append(&claim_hash.to_bytes());
    payload.append(&account_commitment.to_bytes());
    payload.append(&pod_binding.to_bytes());
    env.crypto().sha256(&payload).into()
}

#[contractimpl]
impl Lockb0xBridgeVerifier {
    pub fn __constructor(env: Env, admin: Address, verification_key: Bytes, circuit_version: u32) {
        bump_instance(&env);
        if circuit_version == 0 {
            panic_with_error!(&env, Error::InvalidCircuitVersion);
        }
        let parsed_key = VerifyingKey::<Bn254>::deserialize_compressed(bytes_to_vec(&verification_key).as_slice())
            .unwrap_or_else(|_| panic_with_error!(&env, Error::InvalidProof));
        if parsed_key.gamma_abc_g1.len() != 4 {
            panic_with_error!(&env, Error::InvalidProof);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::VerificationKey, &verification_key);
        env.storage()
            .instance()
            .set(&DataKey::CircuitVersion, &circuit_version);
    }

    pub fn circuit_version(env: Env) -> u32 {
        bump_instance(&env);
        env.storage()
            .instance()
            .get(&DataKey::CircuitVersion)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidCircuitVersion))
    }

    /// Verifies the `pod_ownership` Groth16 proof. Its public inputs are
    /// ordered exactly as the Circom circuit: claimHash, accountCommitment,
    /// podBinding. The proof hash is checked before the pairing operation.
    pub fn verify_bridge(
        env: Env,
        proof_bytes: Bytes,
        claim_hash: BytesN<32>,
        account_commitment: BytesN<32>,
        pod_binding: BytesN<32>,
        proof_hash: BytesN<32>,
        circuit_version: u32,
    ) -> bool {
        bump_instance(&env);
        let configured_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::CircuitVersion)
            .unwrap_or_else(|| panic_with_error!(&env, Error::InvalidCircuitVersion));
        if circuit_version != configured_version {
            panic_with_error!(&env, Error::InvalidCircuitVersion);
        }
        if expected_proof_hash(
            &env,
            &proof_bytes,
            &claim_hash,
            &account_commitment,
            &pod_binding,
        ) != proof_hash
        {
            panic_with_error!(&env, Error::InvalidProofHash);
        }
        if !is_canonical_scalar(&claim_hash)
            || !is_canonical_scalar(&account_commitment)
            || !is_canonical_scalar(&pod_binding)
        {
            panic_with_error!(&env, Error::InvalidProof);
        }

        let vk_bytes: Bytes = env
            .storage()
            .instance()
            .get(&DataKey::VerificationKey)
            .unwrap_or_else(|| panic_with_error!(&env, Error::MissingVerificationKey));
        let vk = VerifyingKey::<Bn254>::deserialize_compressed(bytes_to_vec(&vk_bytes).as_slice())
            .unwrap_or_else(|_| panic_with_error!(&env, Error::InvalidProof));
        let proof = proof_from_bytes(&env, &proof_bytes);
        let prepared_vk = Groth16::<Bn254>::process_vk(&vk)
            .unwrap_or_else(|_| panic_with_error!(&env, Error::InvalidProof));
        let public_inputs = [
            field_from_bytes(&claim_hash),
            field_from_bytes(&account_commitment),
            field_from_bytes(&pod_binding),
        ];
        let valid = Groth16::<Bn254>::verify_with_processed_vk(&prepared_vk, &public_inputs, &proof)
            .unwrap_or_else(|_| panic_with_error!(&env, Error::InvalidProof));
        if !valid {
            panic_with_error!(&env, Error::InvalidProof);
        }
        true
    }
}