import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'acorn'

function propertyName(node) {
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name
  if (node.computed && node.property?.type === 'Literal') return node.property.value
  return undefined
}

function containsRegisterAssetMember(node) {
  let found = false
  walk(node, (candidate) => {
    if (candidate.type === 'MemberExpression' && propertyName(candidate) === 'registerAsset') {
      found = true
    }
  })
  return found
}

function registrationMember(callee) {
  if (callee.type === 'MemberExpression' && propertyName(callee) === 'registerAsset') return callee
  if (callee.type === 'SequenceExpression') {
    const last = callee.expressions.at(-1)
    if (last?.type === 'MemberExpression' && propertyName(last) === 'registerAsset') return last
  }
  return undefined
}

function validateStaticObject(object) {
  const names = new Set()
  for (const property of object.properties) {
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.computed ||
      property.method ||
      property.shorthand
    ) {
      throw new Error('Expo asset metadata must contain only static initializer properties.')
    }
    const name =
      property.key.type === 'Identifier'
        ? property.key.name
        : property.key.type === 'Literal' && typeof property.key.value === 'string'
          ? property.key.value
          : undefined
    if (!name) throw new Error('Expo asset metadata keys must be static names.')
    if (names.has(name)) throw new Error(`Expo asset metadata contains duplicate ${name} fields.`)
    names.add(name)
  }
}

function objectField(object, name) {
  const matches = object.properties.filter(
    (property) =>
      property.type === 'Property' &&
      property.kind === 'init' &&
      !property.computed &&
      ((property.key.type === 'Identifier' && property.key.name === name) ||
        (property.key.type === 'Literal' && property.key.value === name))
  )
  if (matches.length !== 1) throw new Error(`Expo asset must contain exactly one ${name} field.`)
  return matches[0].value
}

function literalString(node, name) {
  if (node.type !== 'Literal' || typeof node.value !== 'string' || node.value.length === 0) {
    throw new Error(`Expo asset ${name} must be a nonempty string literal.`)
  }
  return node.value
}

function numericScales(node) {
  if (node.type !== 'ArrayExpression' || node.elements.length === 0) {
    throw new Error('Expo asset scales must be a nonempty literal array.')
  }
  return node.elements.map((element) => {
    if (
      element?.type !== 'Literal' ||
      typeof element.value !== 'number' ||
      !Number.isFinite(element.value) ||
      element.value <= 0
    ) {
      throw new Error('Expo asset scales must contain positive finite numeric literals.')
    }
    return element.value
  })
}

function walk(node, visit, parent, grandparent) {
  if (!node || typeof node !== 'object') return
  visit(node, parent, grandparent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end' || key === 'loc') continue
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node, parent)
    } else {
      walk(value, visit, node, parent)
    }
  }
}

export function extractExpoAssetPaths(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' })
  const paths = []
  let registrationCount = 0

  walk(ast, (node, parent, grandparent) => {
    if (node.type === 'MemberExpression' && propertyName(node) === 'registerAsset') {
      const directCall = parent?.type === 'CallExpression' && parent.callee === node
      const sequenceCall =
        parent?.type === 'SequenceExpression' &&
        parent.expressions.at(-1) === node &&
        grandparent?.type === 'CallExpression' &&
        grandparent.callee === parent
      if (!directCall && !sequenceCall) {
        throw new Error('registerAsset must be invoked directly without aliasing or extraction.')
      }
    }
    if (node.type === 'ObjectPattern') {
      const extractsRegisterAsset = node.properties.some(
        (property) =>
          property.type === 'Property' &&
          ((property.key.type === 'Identifier' && property.key.name === 'registerAsset') ||
            (property.key.type === 'Literal' && property.key.value === 'registerAsset'))
      )
      if (extractsRegisterAsset) {
        throw new Error('registerAsset must not be extracted through destructuring.')
      }
    }
  })

  walk(ast, (node) => {
    if (node.type !== 'CallExpression' || !containsRegisterAssetMember(node.callee)) return
    if (!registrationMember(node.callee)) {
      throw new Error('Unsupported registerAsset invocation shape.')
    }
    registrationCount += 1
    if (node.arguments.length !== 1 || node.arguments[0].type !== 'ObjectExpression') {
      throw new Error('Every registerAsset call must have one static object argument.')
    }
    const asset = node.arguments[0]
    validateStaticObject(asset)
    const location = literalString(objectField(asset, 'httpServerLocation'), 'httpServerLocation')
    const name = literalString(objectField(asset, 'name'), 'name')
    const type = literalString(objectField(asset, 'type'), 'type')
    const scales = numericScales(objectField(asset, 'scales'))
    for (const scale of scales) {
      const suffix = scale === 1 ? '' : `@${scale}x`
      paths.push(`${location}/${name}${suffix}.${type}`)
    }
  })

  if (paths.length < registrationCount)
    throw new Error('Not every Expo asset registration produced a path.')
  return [...new Set(paths)].sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = extractExpoAssetPaths(await readFile(process.argv[2], 'utf8'))
  process.stdout.write(`${JSON.stringify(paths)}\n`)
}
