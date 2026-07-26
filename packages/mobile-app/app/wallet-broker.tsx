import React from 'react'
import { Platform, Text, View } from 'react-native'
import { useWallet } from '../src/contexts/WalletContext'
import {
  WALLET_BROKER_PROTOCOL,
  WALLET_BROKER_READY,
  type WalletBrokerRequest,
  type WalletBrokerResponse,
} from '../src/wallet/brokerProtocol'

const ALLOWED_PARENT_ORIGINS = new Set([
  'https://nodezero.social',
  'https://www.nodezero.social',
  'https://staging.nodezero.social',
])

function send(port: MessagePort, response: WalletBrokerResponse): void {
  port.postMessage(response)
}

export default function WalletBrokerScreen(): JSX.Element {
  const {
    walletInfo,
    signAttestationChallenge,
    createSeamlessAttestation,
    getLockboxAccountCommitment,
    deriveAccountCommitment,
    createIdentity,
    selectIdentity,
  } = useWallet()

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return

    const onConnect = (event: MessageEvent<WalletBrokerRequest>) => {
      if (!ALLOWED_PARENT_ORIGINS.has(event.origin)) return
      if (event.source !== window.parent) return
      if (event.data?.protocol !== WALLET_BROKER_PROTOCOL) return
      const port = event.ports[0]
      if (!port) return

      const handleRequest = async (request: WalletBrokerRequest) => {
        if (!request || request.protocol !== WALLET_BROKER_PROTOCOL) return
        const reply = (ok: boolean, result?: Record<string, unknown>, error?: string) =>
          send(port, { protocol: WALLET_BROKER_PROTOCOL, requestId: request.requestId, ok, result, error })

        try {
          if (!walletInfo?.publicKey) throw new Error('Wallet is still initializing.')
          if (request.operation === 'get-public-key') {
            reply(true, { stellarPublicKey: walletInfo.publicKey })
            return
          }
          if (request.operation === 'sign-challenge') {
            const challengePayload = request.payload.challengePayload ?? ''
            const signed = await signAttestationChallenge(challengePayload)
            reply(true, signed)
            return
          }
          if (request.operation === 'create-attestation') {
            const webId = request.payload.webId ?? ''
            const podUrl = request.payload.podUrl ?? ''
            const attestation = await createSeamlessAttestation(webId, podUrl, walletInfo.publicKey)
            reply(true, attestation as unknown as Record<string, unknown>)
            return
          }
          if (request.operation === 'get-account-commitment') {
            reply(true, { accountCommitmentHex: await deriveAccountCommitment() })
            return
          }
          if (request.operation === 'get-lockbox-commitment') {
            const contractId = request.payload.contractId ?? ''
            reply(true, { accountCommitmentHex: await getLockboxAccountCommitment(contractId) })
            return
          }
          if (request.operation === 'create-identity') {
            await createIdentity(request.payload.label)
            reply(true)
            return
          }
          if (request.operation === 'select-identity') {
            await selectIdentity(request.payload.keyId ?? '')
            reply(true)
            return
          }
          throw new Error('Wallet broker operation is not supported.')
        } catch (error) {
          reply(false, undefined, error instanceof Error ? error.message : 'Wallet broker operation failed.')
        }
      }
      port.onmessage = (messageEvent: MessageEvent<WalletBrokerRequest>) => {
        void handleRequest(messageEvent.data)
      }
      port.start()
      void handleRequest(event.data)
    }

    window.addEventListener('message', onConnect)
    try {
      const parentOrigin = new URL(document.referrer).origin
      if (ALLOWED_PARENT_ORIGINS.has(parentOrigin)) {
        window.parent.postMessage(
          { protocol: WALLET_BROKER_PROTOCOL, type: WALLET_BROKER_READY },
          parentOrigin,
        )
      }
    } catch {
      // Standalone broker pages have no trusted parent to notify.
    }
    return () => window.removeEventListener('message', onConnect)
  }, [createIdentity, createSeamlessAttestation, deriveAccountCommitment, getLockboxAccountCommitment, selectIdentity, signAttestationChallenge, walletInfo?.publicKey])

  return <View accessible={false}><Text>Wallet broker ready.</Text></View>
}