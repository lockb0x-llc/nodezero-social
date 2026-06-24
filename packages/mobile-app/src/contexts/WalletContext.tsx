/**
 * @module WalletContext
 *
 * Provides the embedded Stellar wallet to all components.
 * The wallet is provisioned silently on first launch – users never see a
 * seed phrase or wallet address unless they explicitly navigate to Settings.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import * as SecureStore from 'expo-secure-store'
import { EnclaveAdapter, WalletService, type WalletInfo } from '@nodezero/embedded-wallet'
import Constants from 'expo-constants'

/** Shape of the wallet context value. */
interface WalletContextValue {
  /** Basic wallet info (public key, funded status), or `null` while loading. */
  walletInfo: WalletInfo | null
  /** Whether the wallet is currently loading / initialising. */
  isLoading: boolean
  /** Registers the user's WebID on-chain against their Stellar public key. */
  registerIdentity: (webId: string, contractId: string) => Promise<string>
}

const WalletContext = createContext<WalletContextValue | null>(null)

// Singleton instances – only created once per app session.
let _adapter: EnclaveAdapter | null = null
let _walletService: WalletService | null = null

function getWalletService(): WalletService {
  if (!_adapter) {
    _adapter = new EnclaveAdapter(SecureStore)
  }
  if (!_walletService) {
    const relayUrl: string =
      (Constants.expoConfig?.extra as Record<string, string> | undefined)?.relayUrl ??
      'wss://relay.nodezero.social'

    // For now we use the default testnet endpoint.
    _walletService = new WalletService(_adapter)
  }
  return _walletService
}

/**
 * Provisions and exposes the embedded Stellar wallet.
 */
export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const info = await getWalletService().getWalletInfo()
        setWalletInfo(info)
      } catch (err) {
        console.warn('[WalletContext] Failed to load wallet info:', err)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  const registerIdentity = useCallback(async (webId: string, contractId: string) => {
    const service = getWalletService()
    const info = walletInfo ?? (await service.getWalletInfo())
    const result = await service.registerIdentityOnChain(
      { webId, stellarPublicKey: info.publicKey },
      contractId
    )
    return result.hash
  }, [walletInfo])

  return (
    <WalletContext.Provider value={{ walletInfo, isLoading, registerIdentity }}>
      {children}
    </WalletContext.Provider>
  )
}

/**
 * Hook to access the embedded wallet.
 * Must be used inside a `WalletProvider`.
 */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used inside <WalletProvider>')
  return ctx
}
