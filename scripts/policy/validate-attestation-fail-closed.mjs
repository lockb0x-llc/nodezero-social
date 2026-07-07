#!/usr/bin/env node

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

const nodeSessionStart = source.indexOf('if (nodeSession) {')
const nonNodeServiceStart = source.indexOf('const service = getWalletService()', nodeSessionStart)

if (nodeSessionStart === -1 || nonNodeServiceStart === -1 || nonNodeServiceStart <= nodeSessionStart) {
  fail('Could not isolate the node-session verification segment in WalletContext.')
  process.exit(process.exitCode ?? 1)
}

const nodeSessionSource = source.slice(nodeSessionStart, nonNodeServiceStart)

const noOnchainBlock = /if\s*\(\s*!onchain\s*\)\s*\{([\s\S]*?)\n\s*\}/m.exec(nodeSessionSource)
if (!noOnchainBlock) {
  fail('Could not locate the `if (!onchain)` branch in WalletContext node-session verification.')
} else {
  const block = noOnchainBlock[1]
  if (!/setAttestationStatus\(\s*'unlinked'\s*\)/.test(block)) {
    fail('`if (!onchain)` must set attestation status to `unlinked`.')
  }
  if (/setVerified\(/.test(block)) {
    fail('`if (!onchain)` must not call `setVerified(...)`.')
  }
}

const catchBlock = /catch\s*\([^)]*\)\s*\{([\s\S]*?)\n\s*\}/m.exec(nodeSessionSource)
if (!catchBlock) {
  fail('Could not locate the `catch` branch in WalletContext node-session verification.')
} else {
  const block = catchBlock[1]
  if (!/setAttestationStatus\(\s*'error'\s*\)/.test(block)) {
    fail('`catch` branch must set attestation status to `error`.')
  }
  if (/setVerified\(/.test(block)) {
    fail('`catch` branch must not call `setVerified(...)`.')
  }
}

const allCatchBlocks = extractCatchBlocks(source)
if (allCatchBlocks.length === 0) {
  fail('Could not locate any `catch` blocks in WalletContext.')
} else {
  for (const block of allCatchBlocks) {
    if (/setVerified\(/.test(block)) {
      fail('No `catch` branch may call `setVerified(...)` in WalletContext.')
    }
    if (/setAttestationStatus\(\s*["']verified["']\s*\)/.test(block)) {
      fail('No `catch` branch may set attestation status to `verified` in WalletContext.')
    }
  }
}

if (!process.exitCode) {
  console.log('[policy:validate-attestation-fail-closed] PASS')
}