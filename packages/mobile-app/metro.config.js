const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)
const defaultResolveRequest = config.resolver.resolveRequest

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.unstable_enablePackageExports = true
config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return defaultResolveRequest
      ? defaultResolveRequest(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform)
  } catch (error) {
    if (moduleName.startsWith('./') && moduleName.endsWith('.js')) {
      return context.resolveRequest(context, moduleName.replace(/\.js$/, '.ts'), platform)
    }
    throw error
  }
}

module.exports = config
