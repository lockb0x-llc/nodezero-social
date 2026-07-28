import { poseidonHash } from '../poseidon.js'

describe('Poseidon compatibility vectors', () => {
  test.each([
    {
      inputs: [1n],
      expected: 18586133768512220936620570745912940619677854269274689475585506675881198879027n,
    },
    {
      inputs: [1n, 2n],
      expected: 7853200120776062878684798364095072458815029376092732009249414926327459813530n,
    },
    {
      inputs: [123456789n, 987654321n],
      expected: 16832421271961222550979173996485995711342823810308835997146707681980704453417n,
    },
  ])('hashes $inputs with the circomlibjs 0.1.7 implementation', async ({ inputs, expected }) => {
    await expect(poseidonHash(inputs)).resolves.toBe(expected)
  })
})
