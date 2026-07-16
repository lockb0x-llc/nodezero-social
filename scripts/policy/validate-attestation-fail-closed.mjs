#!/usr/bin/env node

/**
 * Policy: the client-side on-chain attestation check must stay fail-closed.
 *
 * Post-cutover there is a single verification path in WalletContext (driven by
 * the NodeZero session's lockbox anchor metadata). This validates:
 *  - a session without a lockbox anchor is an `error`, never `verified`
 *  - a missing on-chain commitment (`!onchain`) is `unlinked`, never `verified`
 *  - a device/on-chain commitment mismatch is an `error`
 *  - no `catch` block anywhere may report `verified`
 */

import fs from 'node:fs'
import path from 'node:path'

const walletContextPath = path.resolve('packages/mobile-app/src/contexts/WalletContext.tsx')

function fail(message) {
  console.error(`[policy:validate-attestation-fail-closed] ${message}`)
  process.exitCode = 1
}

if (!fs.existsSync(walletContextPath)) {
  fail(`Target file not found: ${walletContextPath}`)
  process.exit(process.exitCode ?? 1)
}

const source = fs.readFileSync(walletContextPath, 'utf8')

function extractCatchBlocks(input) {
  const blocks = []
  let cursor = 0
  while (cursor < input.length) {
    const catchIndex = input.indexOf('catch', cursor)
    if (catchIndex === -1) break

    const before = catchIndex > 0 ? input[catchIndex - 1] : ''
    const after = catchIndex + 5 < input.length ? input[catchIndex + 5] : ''
    if ((before && /[A-Za-z0-9_$]/.test(before)) || (after && /[A-Za-z0-9_$]/.test(after))) {
      cursor = catchIndex + 5
      continue
    }

    let i = catchIndex + 5
    while (i < input.length && /\s/.test(input[i])) i += 1

    if (input[i] === '(') {
      let depth = 1
      i += 1
      while (i < input.length && depth > 0) {
        const ch = input[i]
        if (ch === '(') depth += 1
        if (ch === ')') depth -= 1
        i += 1
      }
      while (i < input.length && /\s/.test(input[i])) i += 1
    }

    if (input[i] !== '{') {
      cursor = catchIndex + 5
      continue
    }

    let braceDepth = 1
    const start = i + 1
    i += 1
    while (i < input.length && braceDepth > 0) {
      const ch = input[i]
      if (ch === '{') braceDepth += 1
      if (ch === '}') braceDepth -= 1
      i += 1
    }

    if (braceDepth === 0) {
      blocks.push(input.slice(start, i - 1))
    }

    cursor = i
  }

  return blocks
}

// ── Isolate the session verification effect (single path post-cutover). ─────
const verificationStart = source.indexOf('const lockboxId = lockbox?.userLockboxContractId ?? null')
if (verificationStart === -1) {
  fail('Could not isolate the session verification segment in WalletContext (lockbox anchor resolution missing).')
  process.exit(process.exitCode ?? 1)
}
const verificationEnd = source.indexOf('const exportRecoveryBundle', verificationStart)
const verificationSource = source.slice(
  verificationStart,
  verificationEnd === -1 ? source.length : verificationEnd,
)

// 1) A session without an on-chain lockb0x anchor must fail closed as `error`.
const noAnchorBlock = /if\s*\(\s*!lockboxId\s*\)\s*\{([\s\S]*?)\n\s{4}\}/m.exec(verificationSource)
if (!noAnchorBlock) {
  fail('Could not locate the `if (!lockboxId)` guard in the verification effect.')
} else {
  const block = noAnchorBlock[1]
  if (!/setAttestationStatus\(\s*'error'\s*\)/.test(block)) {
    fail('`if (!lockboxId)` must set attestation status to `error`.')
  }
  if (/setAttestationStatus\(\s*'verified'\s*\)/.test(block)) {
    fail('`if (!lockboxId)` must never report `verified`.')
  }
}

// 2) A missing on-chain commitment must be `unlinked`, never `verified`.
const noOnchainBlock = /if\s*\(\s*!onchain\s*\)\s*\{([\s\S]*?)\n\s*\}/m.exec(verificationSource)
if (!noOnchainBlock) {
  fail('Could not locate the `if (!onchain)` branch in the verification effect.')
} else {
  const block = noOnchainBlock[1]
  if (!/setAttestationStatus\(\s*'unlinked'\s*\)/.test(block)) {
    fail('`if (!onchain)` must set attestation status to `unlinked`.')
  }
  if (/setAttestationStatus\(\s*'verified'\s*\)/.test(block)) {
    fail('`if (!onchain)` must never report `verified`.')
  }
}

// 3) The device/on-chain commitment comparison must gate `verified` and the
//    mismatch branch must fail closed as `error`.
if (!/norm\(deviceCommitment\)\s*===\s*norm\(onchain\)/.test(verificationSource)) {
  fail('Verification must compare the device commitment to the on-chain commitment.')
}
const mismatchElse = /norm\(deviceCommitment\)\s*===\s*norm\(onchain\)\s*\)\s*\{[\s\S]*?\}\s*else\s*\{([\s\S]*?)\n\s{6}\}/m.exec(verificationSource)
if (!mismatchElse) {
  fail('Could not locate the commitment mismatch branch in the verification effect.')
} else if (!/setAttestationStatus\(\s*'error'\s*\)/.test(mismatchElse[1])) {
  fail('The commitment mismatch branch must set attestation status to `error`.')
}

// 4) The verification effect's catch handling must fail closed as `error`:
//    at least one catch block sets `error`, and none may report `verified`.
const verificationCatchBlocks = extractCatchBlocks(verificationSource)
if (verificationCatchBlocks.length === 0) {
  fail('Could not locate any `catch` blocks in the verification effect.')
} else {
  const hasErrorCatch = verificationCatchBlocks.some((block) =>
    /setAttestationStatus\(\s*'error'\s*\)/.test(block),
  )
  if (!hasErrorCatch) {
    fail('The verification effect must have a `catch` branch that sets attestation status to `error`.')
  }
  for (const block of verificationCatchBlocks) {
    if (/setAttestationStatus\(\s*'verified'\s*\)/.test(block)) {
      fail('No `catch` branch in the verification effect may report `verified`.')
    }
  }
}

// 5) No catch block anywhere in the file may report `verified`.
const allCatchBlocks = extractCatchBlocks(source)
if (allCatchBlocks.length === 0) {
  fail('Could not locate any `catch` blocks in WalletContext.')
} else {
  for (const block of allCatchBlocks) {
    if (/setAttestationStatus\(\s*["']verified["']\s*\)/.test(block)) {
      fail('No `catch` branch may set attestation status to `verified` in WalletContext.')
    }
  }
}

if (!process.exitCode) {
  console.log('[policy:validate-attestation-fail-closed] PASS')
}
