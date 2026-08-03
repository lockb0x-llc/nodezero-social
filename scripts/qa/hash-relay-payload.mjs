#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function listFiles(root, directory = root) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) throw new Error(`Relay payload contains link: ${path}`)
    if (stat.isDirectory()) files.push(...listFiles(root, path))
    else if (stat.isFile() && entry.name !== 'build-info.json') {
      files.push({ path, relative: relative(root, path).split(sep).join('/') })
    }
  }
  return files
}

export function hashRelayPayload(directory) {
  const root = resolve(directory)
  const lines = listFiles(root)
    .sort((left, right) => Buffer.compare(Buffer.from(left.relative), Buffer.from(right.relative)))
    .map(({ path, relative: relativePath }) => {
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
      return `${digest}  deploy/${relativePath}\n`
    })
    .join('')
  return createHash('sha256').update(lines).digest('hex')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory) throw new Error('Usage: hash-relay-payload.mjs <relay-artifact-directory>')
  process.stdout.write(`${hashRelayPayload(directory)}\n`)
}
