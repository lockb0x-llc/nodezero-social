#!/usr/bin/env node

import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const runMs = Number(process.env.ONBOARDING_DEBUG_WINDOW_MS || 180000)

function now() {
  return new Date().toISOString()
}

function stamp(msg) {
  console.log(`[onboarding-debug] ${now()} ${msg}`)
}

function makeHandle() {
  return `dbg${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

const handle = makeHandle()
const email = `${handle}@example.com`

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    stamp(`navigated -> ${frame.url()}`)
  }
})

page.on('requestfailed', (req) => {
  if (req.isNavigationRequest() || /solid-account|oidc-bridge|login|onboarding|docustream|staging\.nodezero\.social|solid\.nodezero\.social/i.test(req.url())) {
    stamp(`requestfailed ${req.method()} ${req.url()} error=${req.failure()?.errorText || 'unknown'}`)
  }
})

page.on('response', async (res) => {
  const url = res.url()
  if (/solid-account|oidc-bridge|login|onboarding|docustream|staging\.nodezero\.social|solid\.nodezero\.social/i.test(url)) {
    stamp(`response ${res.status()} ${res.request().method()} ${url}`)
  }
})

try {
  stamp(`start baseUrl=${baseUrl} handle=${handle}`)
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByLabel('Node handle').fill(handle)
  await page.getByLabel('Notification email').fill(email)

  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? ''
    return text.includes('Create Your Node')
  }, { timeout: 180000 })

  stamp('click create node')
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
    const match = nodes.find((node) => (node.textContent || '').includes('Create Your Node'))
    if (!match) return false
    const target = match.closest('button, [role="button"], a') ?? match
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  })

  if (!clicked) {
    stamp('ERROR create button not found')
    process.exitCode = 1
  } else {
    stamp(`monitoring for ${runMs}ms`)
    const started = Date.now()
    while (Date.now() - started < runMs) {
      await page.waitForTimeout(3000)
      const state = await page.evaluate(() => ({
        href: window.location.href,
        path: window.location.pathname,
        title: document.title,
        body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
      }))
      stamp(`state path=${state.path} title=${state.title} href=${state.href}`)
      if (/\/(local|feed|docustream)(\?|$)/.test(state.path)) {
        stamp('success-route-reached')
        break
      }
    }
  }

  const finalState = await page.evaluate(() => ({
    href: window.location.href,
    path: window.location.pathname,
    title: document.title,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
  }))
  stamp(`final path=${finalState.path} title=${finalState.title} href=${finalState.href}`)
  stamp(`final-body ${finalState.body}`)
} catch (err) {
  stamp(`ERROR ${(err && err.stack) || err}`)
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}
