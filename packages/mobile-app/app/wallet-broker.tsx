import React from 'react'
import { Platform, Text, View } from 'react-native'
import { useWallet } from '../src/contexts/WalletContext'
import { MissingIdentitySecretError } from '@nodezero/embedded-wallet'
import {
  WALLET_BROKER_PROTOCOL,
  WALLET_BROKER_READY,
  WALLET_BROKER_READY_REQUEST,
  type WalletBrokerRequest,
  type WalletBrokerReadyRequest,
  type WalletBrokerResponse,
} from '../src/wallet/brokerProtocol'
import type { OnboardingConfigDescriptor } from '../src/onboarding/seamlessSignup'

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
    initializationError,
    signAttestationChallenge,
    createSeamlessAttestation,
    getLockboxAccountCommitment,
    deriveAccountCommitment,
    createIdentity,
    importLegacyIdentity,
    selectIdentity,
    findIdentityKeyIdByPublicKey,
    listIdentitySummaries,
  } = useWallet()

  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return

    const onConnect = (event: MessageEvent<WalletBrokerRequest | WalletBrokerReadyRequest>): void => {
      if (!ALLOWED_PARENT_ORIGINS.has(event.origin)) return
      if (event.source !== window.parent) return
      if (event.data?.protocol !== WALLET_BROKER_PROTOCOL) return
      if ('type' in event.data && event.data.type === WALLET_BROKER_READY_REQUEST) {
        window.parent.postMessage(
          { protocol: WALLET_BROKER_PROTOCOL, type: WALLET_BROKER_READY },
          event.origin
        )
        return
      }
      const port = event.ports[0]
      if (!port) return

      const handleRequest = async (request: WalletBrokerRequest): Promise<void> => {
        if (!request || request.protocol !== WALLET_BROKER_PROTOCOL) return
        const reply = (
          ok: boolean,
          result?: Record<string, unknown>,
          error?: string,
          errorCode?: string,
        ): void =>
          send(port, {
            protocol: WALLET_BROKER_PROTOCOL,
            requestId: request.requestId,
            ok,
            result,
            error,
            errorCode,
          })

        try {
          if (request.operation === 'list-identities') {
            reply(true, { identities: await listIdentitySummaries() })
            return
          }
          if (request.operation === 'select-identity') {
            await selectIdentity(request.payload.keyId ?? '')
            reply(true)
            return
          }
          if (request.operation === 'import-legacy-identity') {
            const imported = await importLegacyIdentity({
              secret: request.payload.secret ?? '',
              expectedPublicKey: request.payload.expectedPublicKey ?? '',
              ...(request.payload.label ? { label: request.payload.label } : {}),
            })
            reply(true, {
              keyId: imported.keyId,
              stellarPublicKey: imported.publicKey,
            })
            return
          }
          if (request.operation === 'sign-challenge' && request.payload.keyId) {
            const signed = await signAttestationChallenge(
              request.payload.challengePayload ?? '',
              request.payload.keyId,
            )
            reply(true, signed)
            return
          }
          if (initializationError) throw new Error(initializationError)
          if (!walletInfo?.publicKey) throw new Error('Wallet is still initializing.')
          if (request.operation === 'get-public-key') {
            reply(true, { stellarPublicKey: walletInfo.publicKey })
            return
          }
          if (request.operation === 'sign-challenge') {
            const challengePayload = request.payload.challengePayload ?? ''
            const signed = await signAttestationChallenge(
              challengePayload,
              request.payload.keyId || undefined,
            )
            reply(true, signed)
            return
          }
          if (request.operation === 'create-attestation') {
            const webId = request.payload.webId ?? ''
            const podUrl = request.payload.podUrl ?? ''
            const onboardingConfig = JSON.parse(
              request.payload.onboardingConfig ?? '{}'
            ) as OnboardingConfigDescriptor
            const attestation = await createSeamlessAttestation(
              webId,
              podUrl,
              walletInfo.publicKey,
              onboardingConfig,
            )
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
          if (request.operation === 'activate-identity-for-public-key') {
            const keyId = await findIdentityKeyIdByPublicKey(request.payload.stellarPublicKey ?? '')
            if (!keyId) {
              reply(true, { selected: false })
              return
            }
            await selectIdentity(keyId)
            reply(true, { selected: true })
            return
          }
          throw new Error('Wallet broker operation is not supported.')
        } catch (error) {
          reply(
            false,
            undefined,
            error instanceof Error ? error.message : 'Wallet broker operation failed.',
            error instanceof MissingIdentitySecretError ? 'missing_identity_secret' : undefined,
          )
        }
      }
      port.onmessage = (messageEvent: MessageEvent<WalletBrokerRequest>): void => {
        void handleRequest(messageEvent.data)
      }
      port.start()
      void handleRequest(event.data as WalletBrokerRequest)
    }

    window.addEventListener('message', onConnect)
    return (): void => window.removeEventListener('message', onConnect)
  }, [
    createIdentity,
    createSeamlessAttestation,
    deriveAccountCommitment,
    findIdentityKeyIdByPublicKey,
    getLockboxAccountCommitment,
    initializationError,
    importLegacyIdentity,
    listIdentitySummaries,
    selectIdentity,
    signAttestationChallenge,
    walletInfo?.publicKey,
  ])

  return (
    <View accessible={false}>
      <Text>Wallet broker ready.</Text>
    </View>
  )
}
