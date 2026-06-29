import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const buildDir = path.join(repoRoot, 'packages', 'zk-crypto', 'build')
const outputDir = path.join(repoRoot, 'deployments')
const outputFile = path.join(outputDir, 'zk-testnet-artifacts.json')

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(dir, entry.name)
      if (entry.isDirectory()) return listFiles(resolved)
      return [resolved]
    })
  )
  return files.flat()
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

async function main() {
  const files = await listFiles(buildDir)
  const artifacts = await Promise.all(
    files
      .filter((file) => /\.(wasm|r1cs|sym|zkey|json)$/i.test(file))
      .map(async (file) => {
        const stat = await fs.stat(file)
        return {
          file: path.relative(repoRoot, file).replaceAll(path.sep, '/'),
          bytes: stat.size,
          sha256: await hashFile(file),
        }
      })
  )

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(
    outputFile,
    JSON.stringify(
      {
        network: 'testnet',
        protocolMajor: 27,
        generatedAt: new Date().toISOString(),
        artifacts,
      },
      null,
      2
    ) + '\n'
  )

  console.log(`Wrote ZK artifact manifest: ${outputFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
