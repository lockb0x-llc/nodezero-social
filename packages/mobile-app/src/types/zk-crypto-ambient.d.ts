declare module 'snarkjs' {
  export interface Groth16Proof {
    pi_a: unknown
    pi_b: unknown
    pi_c: unknown
    protocol?: string
    curve?: string
  }

  export const groth16: {
    fullProve: (
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string
    ) => Promise<{ proof: Groth16Proof; publicSignals: string[] }>
    verify: (verificationKey: unknown, publicSignals: string[], proof: Groth16Proof) => Promise<boolean>
  }
}

declare module 'circomlibjs' {
  export function buildPoseidon(): Promise<unknown>
}