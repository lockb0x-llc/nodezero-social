import { Buffer } from 'buffer'

// Ensure a global Buffer at boot (main bundle) — required by the ZK stack
// (snarkjs/circomlibjs) which is loaded on demand during node creation.
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

// buffer@5, used by Metro's browser polyfill, predates the BigInt writers the
// Stellar XDR SDK uses for 64-bit ledger values. Supply the four Node-compatible
// methods before any wallet/SDK code loads.
const UINT64_MAX = (1n << 64n) - 1n
const INT64_MIN = -(1n << 63n)
const INT64_MAX = (1n << 63n) - 1n

function writeBigUint64(value, offset = 0, littleEndian = false) {
  const normalized = BigInt(value)
  if (normalized < 0n || normalized > UINT64_MAX) {
    throw new RangeError('The value of "value" is out of range for uint64.')
  }
  const high = Number((normalized >> 32n) & 0xffffffffn)
  const low = Number(normalized & 0xffffffffn)
  if (littleEndian) {
    this.writeUInt32LE(low, offset)
    this.writeUInt32LE(high, offset + 4)
  } else {
    this.writeUInt32BE(high, offset)
    this.writeUInt32BE(low, offset + 4)
  }
  return offset + 8
}

function writeBigInt64(value, offset = 0, littleEndian = false) {
  const normalized = BigInt(value)
  if (normalized < INT64_MIN || normalized > INT64_MAX) {
    throw new RangeError('The value of "value" is out of range for int64.')
  }
  const unsigned = normalized < 0n ? (1n << 64n) + normalized : normalized
  return writeBigUint64.call(this, unsigned, offset, littleEndian)
}

function readBigUint64(offset = 0, littleEndian = false) {
  const high = littleEndian ? this.readUInt32LE(offset + 4) : this.readUInt32BE(offset)
  const low = littleEndian ? this.readUInt32LE(offset) : this.readUInt32BE(offset + 4)
  return (BigInt(high) << 32n) | BigInt(low)
}

function readBigInt64(offset = 0, littleEndian = false) {
  const unsigned = readBigUint64.call(this, offset, littleEndian)
  return unsigned >= (1n << 63n) ? unsigned - (1n << 64n) : unsigned
}

if (typeof Buffer.prototype.writeBigUInt64BE !== 'function') {
  Buffer.prototype.writeBigUInt64BE = function (value, offset) {
    return writeBigUint64.call(this, value, offset, false)
  }
  Buffer.prototype.writeBigUInt64LE = function (value, offset) {
    return writeBigUint64.call(this, value, offset, true)
  }
  Buffer.prototype.writeBigInt64BE = function (value, offset) {
    return writeBigInt64.call(this, value, offset, false)
  }
  Buffer.prototype.writeBigInt64LE = function (value, offset) {
    return writeBigInt64.call(this, value, offset, true)
  }
}

if (typeof Buffer.prototype.readBigUInt64BE !== 'function') {
  Buffer.prototype.readBigUInt64BE = function (offset) {
    return readBigUint64.call(this, offset, false)
  }
  Buffer.prototype.readBigUInt64LE = function (offset) {
    return readBigUint64.call(this, offset, true)
  }
  Buffer.prototype.readBigInt64BE = function (offset) {
    return readBigInt64.call(this, offset, false)
  }
  Buffer.prototype.readBigInt64LE = function (offset) {
    return readBigInt64.call(this, offset, true)
  }
}

require('expo-router/entry')
