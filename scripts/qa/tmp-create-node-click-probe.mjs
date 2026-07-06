#!/usr/bin/env node

import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const handle = `probe${Date.now().toString(36)}`
const email = `${handle}@example.com`

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

try {
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByLabel('Node handle').fill(handle)
  await page.getByLabel('Notification email').fill(email)

  await page.waitForFunction(() => (document.body?.innerText || '').includes('Create Your Node'), { timeout: 180000 })

  const candidates = await page.evaluate(() => {
    const out = []
    const nodes = Array.from(document.querySelectorAll('*'))
    for (const node of nodes) {
      const text = (node.textContent || '').trim()
      if (!text.includes('Create Your Node')) continue
      const rect = (node).getBoundingClientRect?.()
      out.push({
        tag: node.tagName,
        role: node.getAttribute('role'),
        ariaLabel: node.getAttribute('aria-label'),
        className: node.className,
        text: text.slice(0, 120),
        hasOnClickProp: typeof node.onclick === 'function',
        cursor: getComputedStyle(node).cursor,
        pointerEvents: getComputedStyle(node).pointerEvents,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      })
    }
    return out.slice(0, 40)
  })

  console.log('[probe] candidates with Create Your Node text:')
  console.log(JSON.stringify(candidates, null, 2))

  let clickResult
  try {
    await page.getByText('Create Your Node', { exact: true }).click({ force: true, timeout: 20000 })
    clickResult = { clicked: true, method: 'playwright-text-click' }
  } catch (err) {
    clickResult = {
      clicked: false,
      method: 'playwright-text-click',
      error: err instanceof Error ? err.message : String(err),
    }
  }

  console.log('[probe] clickResult:')
  console.log(JSON.stringify(clickResult, null, 2))

  await page.waitForTimeout(5000)

  const state = await page.evaluate(() => ({
    href: window.location.href,
    path: window.location.pathname,
    title: document.title,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 350),
  }))

  console.log('[probe] state-after-click:')
  console.log(JSON.stringify(state, null, 2))
} finally {
  await context.close()
  await browser.close()
}
