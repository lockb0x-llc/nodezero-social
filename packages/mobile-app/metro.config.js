const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
const defaultResolveRequest = config.resolver.resolveRequest

// Include the pnpm virtual store so Metro can resolve transitive deps
// (e.g. @babel/runtime) that are not symlinked at the top-level node_modules.
const pnpmStoreRoot = path.resolve(workspaceRoot, 'node_modules/.pnpm')

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
  // pnpm virtual store — each package lives at .pnpm/<name>@<ver>/node_modules/
  path.resolve(pnpmStoreRoot, '@babel+runtime@7.29.7/node_modules'),
  pnpmStoreRoot,
]
config.resolver.unstable_enablePackageExports = true
// Force `buffer` to resolve to the real npm package (Node's builtin is empty on
// web, so `require('buffer').Buffer` returns undefined). snarkjs/circomlibjs
// need Buffer.from. Resolve the package dir, falling back to the pnpm store.
function resolveBufferDir() {
  const pnpmDir = path.join(workspaceRoot, 'node_modules/.pnpm')
  const entry = require('node:fs').readdirSync(pnpmDir).find((d) => d.startsWith('buffer@'))
  if (entry) {
    return path.join(pnpmDir, entry, 'node_modules/buffer')
  }

  try {
    return path.dirname(require.resolve('buffer/package.json', { paths: [workspaceRoot, projectRoot] }))
  } catch {
    throw new Error('buffer package not found in workspace pnpm store')
  }
}

function resolveBufferEntry() {
  return path.join(resolveBufferDir(), 'index.js')
}

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  buffer: resolveBufferDir(),
}
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'buffer') {
    return {
      type: 'sourceFile',
      filePath: resolveBufferEntry(),
    }
  }

  if (moduleName.startsWith('buffer/')) {
    return {
      type: 'sourceFile',
      filePath: path.join(resolveBufferDir(), moduleName.slice('buffer/'.length)),
    }
  }

  try {
    return defaultResolveRequest
      ? defaultResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    if (
      (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
      moduleName.endsWith('.js')
    ) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, '.ts'), platform)
    }
    throw error
  }
}

module.exports = config
