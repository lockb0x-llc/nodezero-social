use ark_bn254::{Bn254, Fq, Fq2, G1Affine, G2Affine};
use ark_groth16::VerifyingKey;
use ark_serialize::CanonicalSerialize;
use serde_json::Value;
use std::{env, fs, str::FromStr};

fn coordinate(value: &Value, label: &str) -> Result<Fq, String> {
    let raw = value
        .as_str()
        .ok_or_else(|| format!("{label} must be a decimal string"))?;
    Fq::from_str(raw).map_err(|_| format!("{label} is not a canonical BN254 field element"))
}

fn array<'a>(value: &'a Value, label: &str, minimum: usize) -> Result<&'a Vec<Value>, String> {
    let values = value
        .as_array()
        .ok_or_else(|| format!("{label} must be an array"))?;
    if values.len() < minimum {
        return Err(format!("{label} must contain at least {minimum} values"));
    }
    Ok(values)
}

fn g1(value: &Value, label: &str) -> Result<G1Affine, String> {
    let values = array(value, label, 2)?;
    Ok(G1Affine::new(
        coordinate(&values[0], &format!("{label}[0]"))?,
        coordinate(&values[1], &format!("{label}[1]"))?,
    ))
}

fn g2(value: &Value, label: &str) -> Result<G2Affine, String> {
    let values = array(value, label, 2)?;
    let x = array(&values[0], &format!("{label}[0]"), 2)?;
    let y = array(&values[1], &format!("{label}[1]"), 2)?;
    Ok(G2Affine::new(
        Fq2::new(
            coordinate(&x[0], &format!("{label}[0][0]"))?,
            coordinate(&x[1], &format!("{label}[0][1]"))?,
        ),
        Fq2::new(
            coordinate(&y[0], &format!("{label}[1][0]"))?,
            coordinate(&y[1], &format!("{label}[1][1]"))?,
        ),
    ))
}

fn read_field<'a>(root: &'a Value, name: &str) -> Result<&'a Value, String> {
    root.get(name)
        .ok_or_else(|| format!("snarkjs verification key is missing {name}"))
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn run(input_path: &str, output_path: &str) -> Result<(), String> {
    let source = fs::read_to_string(input_path)
        .map_err(|error| format!("Could not read {input_path}: {error}"))?;
    let root: Value = serde_json::from_str(&source)
        .map_err(|error| format!("Could not parse snarkjs verification key: {error}"))?;
    if root.get("protocol").and_then(Value::as_str) != Some("groth16") {
        return Err("Only snarkjs groth16 verification keys are supported".to_string());
    }
    if root.get("curve").and_then(Value::as_str) != Some("bn128") {
        return Err("Only snarkjs bn128 verification keys are supported".to_string());
    }

    if root.get("nPublic").and_then(Value::as_u64) != Some(3) {
        return Err("Bridge verifier requires exactly three pod_ownership public signals".to_string());
    }
    let ic = array(read_field(&root, "IC")?, "IC", 4)?;
    if ic.len() != 4 {
        return Err("Bridge verifier verification key must contain exactly four IC points".to_string());
    }
    let gamma_abc_g1 = ic
        .iter()
        .enumerate()
        .map(|(index, point)| g1(point, &format!("IC[{index}]")))
        .collect::<Result<Vec<_>, _>>()?;
    let key = VerifyingKey::<Bn254> {
        alpha_g1: g1(read_field(&root, "vk_alpha_1")?, "vk_alpha_1")?,
        beta_g2: g2(read_field(&root, "vk_beta_2")?, "vk_beta_2")?,
        gamma_g2: g2(read_field(&root, "vk_gamma_2")?, "vk_gamma_2")?,
        delta_g2: g2(read_field(&root, "vk_delta_2")?, "vk_delta_2")?,
        gamma_abc_g1,
    };
    let mut compressed = Vec::new();
    key.serialize_compressed(&mut compressed)
        .map_err(|error| format!("Could not serialize Arkworks verification key: {error}"))?;
    fs::write(output_path, format!("{}\n", hex(&compressed)))
        .map_err(|error| format!("Could not write {output_path}: {error}"))?;
    println!("Wrote {} compressed Arkworks VK bytes as hex to {output_path}", compressed.len());
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        eprintln!("Usage: nodezero-bridge-vk-encoder <snarkjs-vk.json> <arkworks-vk.hex>");
        std::process::exit(2);
    }
    if let Err(error) = run(&args[1], &args[2]) {
        eprintln!("nodezero-bridge-vk-encoder: {error}");
        std::process::exit(1);
    }
}