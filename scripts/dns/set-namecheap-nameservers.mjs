#!/usr/bin/env node
/**
 * set-namecheap-nameservers.mjs
 *
 * Switches the nodezero.social domain to Azure DNS by calling
 * namecheap.domains.dns.setCustom with the four Azure nameservers.
 *
 * Required environment variables:
 *   NAMECHEAP_API_KEY   – Namecheap API key
 *   NAMECHEAP_API_USER  – Namecheap API user (account username)
 *   NAMECHEAP_CLIENT_IP – Public IP of the caller (must be allowlisted in Namecheap)
 *
 * Optional:
 *   NAMECHEAP_USERNAME  – Namecheap username if different from API user
 *   NAMECHEAP_SANDBOX   – 'true' to use sandbox API endpoint
 *   NAMECHEAP_DOMAIN    – Domain to update (default: nodezero.social)
 */

const AZURE_NAMESERVERS = [
  'ns1-09.azure-dns.com',
  'ns2-09.azure-dns.net',
  'ns3-09.azure-dns.org',
  'ns4-09.azure-dns.info',
]

function fail(message) {
  console.error(`[set-ns] FAIL: ${message}`)
  process.exit(1)
}

function requireEnv(name) {
  const value = process.env[name] ?? ''
  if (!value.trim()) fail(`${name} is required but not set.`)
  return value.trim()
}

async function resolvePublicIp() {
  const ip = (process.env.NAMECHEAP_CLIENT_IP ?? '').trim()
  if (ip) return ip
  const res = await fetch('https://api.ipify.org?format=text')
  if (!res.ok) fail(`Cannot resolve public IP: HTTP ${res.status}`)
  return (await res.text()).trim()
}

function parseDomain(domain) {
  const parts = domain.split('.')
  if (parts.length < 2) fail(`Invalid domain: ${domain}`)
  return { sld: parts.slice(0, -1).join('.'), tld: parts.at(-1) }
}

async function namecheapRequest(apiKey, apiUser, username, clientIp, sandbox, command, extra = {}) {
  const base = sandbox
    ? 'https://api.sandbox.namecheap.com/xml.response'
    : 'https://api.namecheap.com/xml.response'
  const params = new URLSearchParams({ ApiUser: apiUser, ApiKey: apiKey, UserName: username, ClientIp: clientIp, Command: command, ...extra })
  const res = await fetch(`${base}?${params}`)
  const xml = await res.text()
  if (!res.ok) fail(`Namecheap HTTP ${res.status}: ${xml.slice(0, 400)}`)
  if (!/Status="OK"/i.test(xml)) {
    const err = xml.match(/<Error[^>]*>([^<]+)<\/Error>/i)?.[1] ?? 'Unknown error'
    fail(err)
  }
  return xml
}

async function main() {
  const apiKey = requireEnv('NAMECHEAP_API_KEY')
  const apiUser = requireEnv('NAMECHEAP_API_USER')
  const username = (process.env.NAMECHEAP_USERNAME ?? apiUser).trim() || apiUser
  const domain = (process.env.NAMECHEAP_DOMAIN ?? 'nodezero.social').trim()
  const sandbox = (process.env.NAMECHEAP_SANDBOX ?? 'false').toLowerCase() === 'true'
  const clientIp = await resolvePublicIp()
  const { sld, tld } = parseDomain(domain)

  console.log(`[set-ns] Public IP: ${clientIp}`)
  console.log(`[set-ns] Switching ${domain} to Azure DNS nameservers...`)
  console.log(`[set-ns] Nameservers: ${AZURE_NAMESERVERS.join(', ')}`)

  await namecheapRequest(apiKey, apiUser, username, clientIp, sandbox,
    'namecheap.domains.dns.setCustom',
    {
      SLD: sld,
      TLD: tld,
      Nameservers: AZURE_NAMESERVERS.join(','),
    }
  )

  console.log(`[set-ns] SUCCESS: ${domain} nameservers updated to Azure DNS.`)
  console.log(`[set-ns] Propagation typically takes 10–60 minutes.`)
  console.log(`[set-ns] Verify with: nslookup -type=NS ${domain} 8.8.8.8`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
