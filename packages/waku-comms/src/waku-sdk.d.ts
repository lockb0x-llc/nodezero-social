/**
 * Ambient type shim for the OPTIONAL @waku/sdk peer dependency.
 *
 * Why this exists: @waku/sdk is provided by the consuming app (the package
 * that actually opens network connections, e.g. mobile-app or the spike
 * harness adds "@waku/sdk" to its own dependencies). This shim types the
 * narrow API surface used by createWakuTransport.ts so this package
 * type-checks and tests in environments where the SDK is not installed.
 *
 * MAINTENANCE: once @waku/sdk is installed workspace-wide, DELETE this file
 * so the compiler uses the SDK's real typings, and fix any drift in
 * createWakuTransport.ts only.
 */
declare module '@waku/sdk' {
  export enum Protocols {
    Relay = 'relay',
    Store = 'store',
    LightPush = 'lightpush',
    Filter = 'filter',
  }

  export interface DecodedMessage {
    contentTopic: string
    payload: Uint8Array
  }

  export interface Encoder {
    contentTopic: string
  }

  export interface Decoder {
    contentTopic: string
  }

  export function createEncoder(options: { contentTopic: string; ephemeral?: boolean }): Encoder

  export function createDecoder(contentTopic: string): Decoder

  export interface SendResult {
    successes: unknown[]
    failures: Array<{ error: unknown }>
  }

  export interface Subscription {
    unsubscribe(contentTopics: string[]): Promise<void>
  }

  export interface SubscribeResult {
    error: string | null
    subscription: Subscription | null
  }

  export interface LightNode {
    start(): Promise<void>
    stop(): Promise<void>
    waitForPeers(protocols?: Protocols[]): Promise<void>
    libp2p: {
      getConnections(): unknown[]
      addEventListener(event: string, listener: () => void): void
    }
    lightPush: {
      send(encoder: Encoder, message: { payload: Uint8Array }): Promise<SendResult>
    }
    filter: {
      subscribe(
        decoders: Decoder[],
        callback: (message: DecodedMessage) => void,
      ): Promise<SubscribeResult>
    }
    store: {
      queryGenerator(
        decoders: Decoder[],
        options?: { timeStart?: Date; timeEnd?: Date },
      ): AsyncIterable<Array<Promise<DecodedMessage | undefined>>>
    }
  }

  export function createLightNode(options: {
    bootstrapPeers?: string[]
    defaultBootstrap?: boolean
  }): Promise<LightNode>
}
