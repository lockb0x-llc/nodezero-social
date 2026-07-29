export function isWalletReadyForAttestation(
  isLoading: boolean,
  walletPublicKey: string | null | undefined,
): boolean {
  return !isLoading && Boolean(walletPublicKey)
}