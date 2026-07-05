#!/usr/bin/env node

import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const timeoutMs = Number(process.env.DOCUSTREAM_E2E_TIMEOUT_MS || 6 * 60 * 1000)
const redirectTimeoutMs = Number(process.env.DOCUSTREAM_E2E_REDIRECT_TIMEOUT_MS || 4 * 60 * 1000)
const walletReadyTimeoutMs = Number(process.env.DOCUSTREAM_E2E_WALLET_READY_TIMEOUT_MS || 3 * 60 * 1000)
const useSeededSession = (process.env.DOCUSTREAM_E2E_SEEDED_SESSION || 'true').toLowerCase() !== 'false'

function fail(message) {
  console.error(`[docustream-pane-evidence] FAIL: ${message}`)
  process.exit(1)
}

function nowStamp() {
  return Date.now().toString(36)
}

function randomSuffix() {
  return Math.floor(Math.random() * 1e6).toString(36)
}

async function pageTextSnippet(page) {
  const text = await page.evaluate(() => document.body?.innerText ?? '')
  return text.replace(/\s+/g, ' ').slice(0, 500)
}

async function ensureDocustreamVisible(page, baseUrl) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const state = await page.evaluate(() => {
      const path = window.location.pathname
      const text = document.body?.innerText ?? ''
      return {
        path,
        hasDownstreamHeader: text.includes('Downstream'),
      }
    })

    if (state.path === '/docustream' && state.hasDownstreamHeader) {
      return
    }

    if (attempt % 2 === 1) {
      await page.goto(`${baseUrl}/docustream`, { waitUntil: 'domcontentloaded' })
    } else {
      await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
        const streamNode = nodes.find((node) => (node.textContent || '').trim() === 'Stream')
        if (!streamNode) return
        const target = streamNode.closest('a, button, [role="button"]') ?? streamNode
        ;(target).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
    }

    await page.waitForTimeout(1200)
  }

  const snippet = await pageTextSnippet(page)
  fail(`Could not reach docustream view. Current URL: ${page.url()}. Page snippet: ${snippet}`)
}

async function waitForPaneHint(page, baseUrl, timeoutMs) {
  const start = Date.now()
  let attempts = 0

  while (Date.now() - start < timeoutMs) {
    attempts += 1
    const state = await page.evaluate(() => {
      const text = document.body?.innerText ?? ''
      return {
        path: window.location.pathname,
        hasPaneHint: text.includes('Web explorer panes:'),
      }
    })

    if (attempts === 1 || attempts % 10 === 0) {
      console.log(
        `[docustream-pane-evidence] pane wait attempt=${attempts} path=${state.path} hint=${state.hasPaneHint}`,
      )
    }

    if (state.hasPaneHint) {
      return
    }

    if (state.path !== '/docustream') {
      const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('a, button, [role="button"], span, div'))
        const streamNode = nodes.find((node) => (node.textContent || '').trim() === 'Stream')
        if (!streamNode) return false
        const target = streamNode.closest('a, button, [role="button"]') ?? streamNode
        ;(target).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      })

      if (!clicked) {
        await page.goto(`${baseUrl}/docustream`, { waitUntil: 'domcontentloaded' })
      }

      await page.waitForTimeout(1200)
      continue
    }

    await page.waitForTimeout(1200)
  }
}

async function run() {
  if (!baseUrl.startsWith('https://')) {
    fail(`STAGING_BASE_URL must use https (got '${baseUrl}').`)
  }

  const runId = `${nowStamp()}${randomSuffix()}`
  const handle = `qa${runId}`
  const email = `qa+${runId}@example.com`
  const seededWebId = `https://solid.nodezero.social/${handle}/profile/card#me`
  const seededPodUrl = `https://solid.nodezero.social/${handle}/`

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    console.log(`[docustream-pane-evidence] Starting run against ${baseUrl} with handle ${handle}.`)
    page.setDefaultTimeout(timeoutMs)

    if (useSeededSession) {
      console.log('[docustream-pane-evidence] Seeding deterministic authenticated session...')
      await page.addInitScript(({ webId, podUrl }) => {
        const createdAt = new Date().toISOString()
        const nodeSession = {
          webId,
          podUrl,
          stellarPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          userLockboxContractId: 'CSEEDEDEVIDENCELOCKBOX0000000000000000000000000000',
          lockboxFactoryContractId: 'CA5MASVC7CH646QUZM6HFC3JAYIG4TCRHJDSBDOBFP66IW7TXYYHFUVB',
          proofRootHex: '0xseededproofroot',
          accountDocumentUrl: `${podUrl}profile/nodezero-account`,
          createdAt,
        }
        localStorage.setItem('solid.webId.v1', webId)
        localStorage.setItem('node.session.v1', JSON.stringify(nodeSession))
      }, { webId: seededWebId, podUrl: seededPodUrl })

      // Seeded node sessions still pass through async wallet attestation verification.
      // During that window RouteGuard can force onboarding and then land on /local.
      // Wait for the authenticated surface first, then navigate to docustream.
      await page.goto(`${baseUrl}/onboarding`, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(/\/(local|feed)(\?.*)?$/, { timeout: redirectTimeoutMs })
      await page.goto(`${baseUrl}/docustream`, { waitUntil: 'domcontentloaded' })
      await ensureDocustreamVisible(page, baseUrl)
    } else {
      console.log('[docustream-pane-evidence] Opening landing page...')
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })

      console.log('[docustream-pane-evidence] Filling seamless onboarding form...')
      await page.getByLabel('Node handle').fill(handle)
      await page.getByLabel('Notification email').fill(email)

      await page
        .waitForFunction(() => {
          const text = document.body?.innerText ?? ''
          return text.includes('Or create your node in seconds')
        }, { timeout: 60000 })
        .catch(async () => {
          const snippet = await pageTextSnippet(page)
          fail(`Create-node section never became visible. Page snippet: ${snippet}`)
        })

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight)
      })

      console.log('[docustream-pane-evidence] Waiting for wallet-ready create button...')
      await page
        .waitForFunction(() => {
          const text = document.body?.innerText ?? ''
          return text.includes('Create Your Node')
        }, { timeout: walletReadyTimeoutMs })
        .catch(async () => {
          const snippet = await pageTextSnippet(page)
          fail(`Create button never became ready. Page snippet: ${snippet}`)
        })

      console.log('[docustream-pane-evidence] Submitting Create Your Node...')
      const clicked = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
        const match = nodes.find((node) => (node.textContent || '').includes('Create Your Node'))
        if (!match) return false
        const target = match.closest('button, [role="button"], a') ?? match
        ;(target).scrollIntoView({ block: 'center', inline: 'nearest' })
        ;(target).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        return true
      })
      if (!clicked) {
        const snippet = await pageTextSnippet(page)
        fail(`Create button could not be clicked. Page snippet: ${snippet}`)
      }

      await page
        .waitForFunction(() => {
          const bodyText = document.body?.innerText ?? ''
          const path = window.location.pathname
          return (
            bodyText.includes('Generating your zero-knowledge proof') ||
            bodyText.includes('Creating your Pod on the Node Zero Community Server') ||
            bodyText.includes('Confirming your on-chain lockb0x anchor') ||
            path === '/local' ||
            path === '/feed'
          )
        }, { timeout: 20000 })
        .catch(async () => {
          const snippet = await pageTextSnippet(page)
          fail(`Create flow did not start after submit. Page snippet: ${snippet}`)
        })

      console.log('[docustream-pane-evidence] Waiting for authenticated route redirect...')
      await page.waitForURL(/\/(local|feed)(\?.*)?$/, { timeout: redirectTimeoutMs })
      console.log(`[docustream-pane-evidence] Redirected to ${page.url()}.`)

      console.log('[docustream-pane-evidence] Opening docustream route...')
      await page.goto(`${baseUrl}/docustream`, { waitUntil: 'domcontentloaded' })
      await ensureDocustreamVisible(page, baseUrl)
    }

    const paneHint = page.getByText('Web explorer panes:', { exact: false })
    const runtimeFlags = await page.evaluate(() => {
      try {
        const constantsMod = __r(29)
        const extra = constantsMod?.default?.expoConfig?.extra ?? null
        return {
          mashlibExplorerEnabled: extra?.mashlibExplorerEnabled ?? null,
          mashlibModuleId: extra?.mashlibModuleId ?? null,
          envProfile: extra?.envProfile ?? null,
        }
      } catch {
        return {
          mashlibExplorerEnabled: null,
          mashlibModuleId: null,
          envProfile: null,
        }
      }
    })

    if (
      runtimeFlags.mashlibExplorerEnabled !== 'true' ||
      runtimeFlags.mashlibModuleId !== 'nodezero:mashlib-pane-provider'
    ) {
      fail(
        `Runtime mashlib flags are not enabled in deployed config: ${JSON.stringify(runtimeFlags)}`,
      )
    }

    console.log('[docustream-pane-evidence] Waiting for pane hint to render...')
    await waitForPaneHint(page, baseUrl, 60000)
    await paneHint.waitFor({ state: 'visible', timeout: 10000 }).catch(async () => {
      const snippet = await pageTextSnippet(page)
      fail(
        `Pane hint did not render. Current URL: ${page.url()}. Runtime flags: ${JSON.stringify(runtimeFlags)}. Page snippet: ${snippet}`,
      )
    })
    const paneText = (await paneHint.first().innerText()).trim()

    if (!/Activity Stream/.test(paneText) || !/Timeline View/.test(paneText)) {
      fail(`Pane hint missing expected labels. Actual: '${paneText}'`)
    }

    const webId = await page.evaluate(() => {
      try {
        return localStorage.getItem('solid.webId.v1')
      } catch {
        return null
      }
    })

    const result = {
      baseUrl,
      runId,
      handle,
      mode: useSeededSession ? 'seeded-session' : 'live-seamless-provisioning',
      webId,
      paneText,
      capturedAt: new Date().toISOString(),
    }

    console.log(`[docustream-pane-evidence] PASS: authenticated docustream pane evidence captured for ${handle}.`)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await context.close()
    await browser.close()
  }
}

run().catch((err) => {
  console.error('[docustream-pane-evidence] Error stack:', err)
  fail(err instanceof Error ? err.message : 'Unknown failure.')
})
