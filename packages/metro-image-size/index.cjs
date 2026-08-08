const fs = require('node:fs')
const probe = require('probe-image-size')

function imageSize(input) {
  const bytes = typeof input === 'string' ? fs.readFileSync(input) : input
  const dimensions = probe.sync(bytes)
  if (!dimensions) throw new TypeError('Unsupported or malformed image asset.')
  return dimensions
}

module.exports = imageSize
