#!/usr/bin/env node

const apiKey = process.env.NAMECHEAP_API_KEY ?? ''
const apiUser = process.env.NAMECHEAP_API_USER ?? ''
const username = process.env.NAMECHEAP_USERNAME ?? ''

function classifyApiKey(value) {
  if (!value) return 'missing'
  if (/^[a-f0-9]{32}$/i.test(value)) return 'looks-like-32-char-hex-key'
  if (/^[a-f0-9-]{36}$/i.test(value)) return 'looks-like-guid'
  if (value.trim().startsWith('{')) return 'looks-like-json'
  if (value.includes('|')) return 'looks-like-pipe-delimited'
  if (value.includes(':')) return 'looks-like-colon-delimited'
  return 'unrecognized-format'
}

console.log(`NAMECHEAP_API_KEY_present=${apiKey.length > 0}`)
console.log(`NAMECHEAP_API_KEY_length=${apiKey.length}`)
console.log(`NAMECHEAP_API_KEY_shape=${classifyApiKey(apiKey)}`)
console.log(`NAMECHEAP_API_USER_present=${apiUser.length > 0}`)
console.log(`NAMECHEAP_USERNAME_present=${username.length > 0}`)
