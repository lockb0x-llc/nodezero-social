export function isWalletReadyForAttestation(
  usesHostedWalletBroker: boolean,
  isLoading: boolean,
  walletPublicKey: string | null | undefined,
): boolean {
  return usesHostedWalletBroker || (!isLoading && Boolean(walletPublicKey))
}
