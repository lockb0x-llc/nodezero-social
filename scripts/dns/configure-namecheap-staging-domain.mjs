#!/usr/bin/env node
import { setTimeout as delay } from 'node:timers/promises'

function parseNamecheapCredentials() {
  const rawApiKey = process.env.NAMECHEAP_API_KEY ?? ''
  let apiKey = rawApiKey
  let apiUser = process.env.NAMECHEAP_API_USER ?? ''
  let username = process.env.NAMECHEAP_USERNAME ?? apiUser

  if (rawApiKey.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(rawApiKey)
      apiKey = parsed.apiKey ?? parsed.ApiKey ?? apiKey
      apiUser = apiUser || parsed.apiUser || parsed.ApiUser || parsed.username || parsed.UserName || ''
      username = username || parsed.username || parsed.UserName || apiUser
    } catch {
      // Keep raw API key handling below; validation will fail with a clear message if needed.
    }
  } else if (!apiUser && rawApiKey.includes('|')) {
    const parts = rawApiKey.split('|').map((part) => part.trim())
    if (parts.length === 2) {
      apiUser = parts[0]
      username = username || parts[0]
      apiKey = parts[1]
    } else if (parts.length >= 3) {
      apiUser = parts[0]
      username = username || parts[1]
      apiKey = parts.slice(2).join('|')
    }
  } else if (!apiUser && rawApiKey.includes(':')) {
    const parts = rawApiKey.split(':').map((part) => part.trim())
    if (parts.length === 2) {
      apiUser = parts[0]
      username = username || parts[0]
      apiKey = parts[1]
    } else if (parts.length >= 3) {
      apiUser = parts[0]
      username = username || parts[1]
      apiKey = parts.slice(2).join(':')
    }
  }

  return { apiKey, apiUser, username }
}

const credentials = parseNamecheapCredentials()

const config = {
  apiKey: credentials.apiKey,
  apiUser: credentials.apiUser,
  username: credentials.username,
  clientIp: process.env.NAMECHEAP_CLIENT_IP ?? '',
  domain: process.env.NAMECHEAP_DOMAIN ?? 'nodezero.social',
  host: process.env.NAMECHEAP_HOST ?? 'staging',
  target: process.env.NAMECHEAP_TARGET ?? '',
  sandbox: (process.env.NAMECHEAP_SANDBOX ?? 'false').toLowerCase() === 'true',
}

const checkOnly = process.argv.includes('--check-only')

function fail(message) {
  console.error(`[namecheap] FAIL: ${message}`)
  process.exit(1)
}

function requireValue(name, value) {
  if (!value || value.trim().length === 0) {
    fail(`${name} is required.`)
  }
}

async function resolveClientIp() {
  if (config.clientIp) return config.clientIp
  const response = await fetch('https://api.ipify.org?format=text')
  if (!response.ok) {
    fail(`Unable to resolve GitHub runner public IP (${response.status}).`)
  }
  return (await response.text()).trim()
}

function parseDomain(domain) {
  const parts = domain.split('.')
  if (parts.length < 2) fail(`Invalid domain: ${domain}`)
  return {
    sld: parts.slice(0, -1).join('.'),
    tld: parts.at(-1),
  }
}

function parseHostAttributes(tag) {
  const attrs = {}
  const attrPattern = /([A-Za-z]+)="([^"]*)"/g
  let match
  while ((match = attrPattern.exec(tag)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function parseHosts(xml) {
  return Array.from(xml.matchAll(/<host\s+([^>]+?)\s*\/>/g)).map((match) => parseHostAttributes(match[1]))
}

function assertNamecheapSuccess(xml) {
  if (!/Status="OK"/i.test(xml)) {
    const error = xml.match(/<Error[^>]*>([^<]+)<\/Error>/i)?.[1] ?? 'Unknown Namecheap API error.'
    if (/API Key is invalid|API access has not been enabled/i.test(error)) {
      fail(`${error}. Confirm the API key belongs to NAMECHEAP_API_USER, API access is enabled in Namecheap, and the GitHub runner public IP printed above is allowed in Namecheap API access settings.`)
    }
    fail(error)
  }
}

async function namecheapRequest(command, params) {
  const endpoint = config.sandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response'

  const searchParams = new URLSearchParams({
    ApiUser: config.apiUser,
    ApiKey: config.apiKey,
    UserName: config.username,
    ClientIp: config.clientIp,
    Command: command,
    ...params,
  })

  const response = await fetch(`${endpoint}?${searchParams.toString()}`)
  const text = await response.text()
  if (!response.ok) {
    fail(`Namecheap API returned HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  assertNamecheapSuccess(text)
  return text
}

function toSetHostsParams(hosts) {
  return hosts.reduce((params, host, index) => {
    const n = String(index + 1)
    params[`HostName${n}`] = host.Name ?? '@'
    params[`RecordType${n}`] = host.Type ?? 'A'
    params[`Address${n}`] = host.Address ?? ''
    params[`TTL${n}`] = host.TTL ?? '300'
    if (host.MXPref) params[`MXPref${n}`] = host.MXPref
    return params
  }, {})
}

async function main() {
  requireValue('NAMECHEAP_API_KEY', config.apiKey)
  requireValue('NAMECHEAP_API_USER', config.apiUser)
  requireValue('NAMECHEAP_USERNAME', config.username)
  if (!checkOnly) {
    requireValue('NAMECHEAP_TARGET', config.target)
  }

  config.clientIp = await resolveClientIp()
  const { sld, tld } = parseDomain(config.domain)

  console.log(`[namecheap] Runner public IP: ${config.clientIp}`)
  console.log(`[namecheap] Reading existing ${config.domain} DNS hosts...`)

  const existingXml = await namecheapRequest('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld })
  const existingHosts = parseHosts(existingXml)

  if (checkOnly) {
    console.log(`[namecheap] Credential check succeeded; ${existingHosts.length} host record(s) visible for ${config.domain}.`)
    return
  }

  const preservedHosts = existingHosts.filter((host) => (host.Name ?? '').toLowerCase() !== config.host.toLowerCase())
  const nextHosts = [
    ...preservedHosts,
    {
      Name: config.host,
      Type: 'CNAME',
      Address: config.target,
      TTL: '300',
    },
  ]

  console.log(`[namecheap] Setting ${config.host}.${config.domain} CNAME -> ${config.target}`)
  await namecheapRequest('namecheap.domains.dns.setHosts', {
    SLD: sld,
    TLD: tld,
    ...toSetHostsParams(nextHosts),
  })

  console.log('[namecheap] DNS update submitted successfully.')

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const result = await fetch(`https://dns.google/resolve?name=${config.host}.${config.domain}&type=CNAME`)
      if (result.ok) {
        const body = await result.json()
        const answer = body.Answer?.find((entry) => entry.type === 5)?.data?.replace(/\.$/, '')
        if (answer && answer.toLowerCase() === config.target.toLowerCase()) {
          console.log(`[namecheap] DNS propagated: ${config.host}.${config.domain} -> ${answer}`)
          return
        }
      }
    } catch {
      // Continue retrying; Azure validation can also handle propagation delays.
    }
    console.log(`[namecheap] Waiting for DNS propagation (${attempt}/10)...`)
    await delay(30_000)
  }

  console.log('[namecheap] DNS update submitted, but propagation was not confirmed within the retry window.')
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
