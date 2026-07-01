import { Buffer } from 'buffer'

// Ensure a global Buffer at boot (main bundle) — required by the ZK stack
// (snarkjs/circomlibjs) which is loaded on demand during node creation.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

require('expo-router/entry')
