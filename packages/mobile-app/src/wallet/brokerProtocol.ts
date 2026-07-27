export const WALLET_BROKER_PROTOCOL = 'nz-wallet-broker-v1'
export const WALLET_BROKER_READY = 'ready'
export const WALLET_BROKER_READY_REQUEST = 'ready-request'

export type WalletBrokerOperation =
  | 'get-public-key'
  | 'sign-challenge'
  | 'create-attestation'
  | 'get-account-commitment'
  | 'get-lockbox-commitment'
  | 'create-identity'
  | 'select-identity'
  | 'activate-identity-for-public-key'

export interface WalletBrokerRequest {
  protocol: typeof WALLET_BROKER_PROTOCOL
  requestId: string
  operation: WalletBrokerOperation
  payload: Record<string, string>
}

export interface WalletBrokerResponse {
  protocol: typeof WALLET_BROKER_PROTOCOL
  requestId: string
  ok: boolean
  result?: Record<string, unknown>
  error?: string
}

const REQUEST_TIMEOUT_MS = 30_000

function randomRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function walletBrokerOrigin(brokerUrl: string): string {
  const parsed = new URL(brokerUrl)
  if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'wallet.nodezero.social') {
    throw new Error('Wallet broker must use https://wallet.nodezero.social.')
  }
  return parsed.origin
}

export async function requestWalletBroker<T>(
  frame: HTMLIFrameElement,
  brokerUrl: string,
  operation: WalletBrokerOperation,
  payload: Record<string, string> = {}
): Promise<T> {
  const target = frame.contentWindow
  if (!target) throw new Error('Wallet broker frame is unavailable.')
  const targetOrigin = walletBrokerOrigin(brokerUrl)
  const channel = new MessageChannel()
  const requestId = randomRequestId()

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      channel.port1.close()
      reject(new Error('Wallet broker request timed out.'))
    }, REQUEST_TIMEOUT_MS)

    channel.port1.onmessage = (event: MessageEvent<WalletBrokerResponse>) => {
      const response = event.data
      if (
        !response ||
        response.protocol !== WALLET_BROKER_PROTOCOL ||
        response.requestId !== requestId
      )
        return
      clearTimeout(timeout)
      channel.port1.close()
      if (!response.ok) {
        reject(new Error(response.error ?? 'Wallet broker request failed.'))
        return
      }
      resolve((response.result ?? {}) as T)
    }

    const request: WalletBrokerRequest = {
      protocol: WALLET_BROKER_PROTOCOL,
      requestId,
      operation,
      payload,
    }
    target.postMessage(request, targetOrigin, [channel.port2])
  })
}

export interface WalletBrokerReady {
  protocol: typeof WALLET_BROKER_PROTOCOL
  type: typeof WALLET_BROKER_READY
}

export interface WalletBrokerReadyRequest {
  protocol: typeof WALLET_BROKER_PROTOCOL
  type: typeof WALLET_BROKER_READY_REQUEST
}
