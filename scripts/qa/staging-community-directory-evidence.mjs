#!/usr/bin/env node

/**
 * Community Directory acceptance evidence checks.
 *
 * Coverage:
 * - Tab sequence contract in source (`Feed` -> `Directory` -> `Backpack`).
 * - Optional live staging verification using an authenticated Playwright
 *   storage state file.
 *
 * Usage:
 *   node scripts/qa/staging-community-directory-evidence.mjs
 *
 * Optional live check (requires authenticated storage state JSON):
 *   STAGING_BASE_URL=https://staging.nodezero.social \
 *   COMMUNITY_DIRECTORY_STORAGE_STATE=./playwright/.auth/staging.json \
 *   node scripts/qa/staging-community-directory-evidence.mjs
 */

import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const layoutPath = 'packages/mobile-app/app/_layout.tsx'
const storageStatePath = (process.env.COMMUNITY_DIRECTORY_STORAGE_STATE || '').trim()

function log(message) {
  console.log(`[community-directory-evidence] ${message}`)
}

function fail(message) {
  console.error(`[community-directory-evidence] FAIL: ${message}`)
  process.exit(1)
}

async function runSourceTabSequenceCheck() {
  const source = await readFile(layoutPath, 'utf8')

  const linksBlockMatch = source.match(/const links = \[(.*?)\] as const/s)
  if (!linksBlockMatch) {
    fail(`Could not find WebNavBar links array in ${layoutPath}.`)
  }

  const linksBlock = linksBlockMatch[1]
  const indexOfFeed = linksBlock.indexOf("{ href: '/feed', label: 'Feed' }")
  const indexOfDirectory = linksBlock.indexOf("{ href: '/directory', label: 'Directory' }")
  const indexOfBackpack = linksBlock.indexOf("{ href: '/backpack', label: 'Backpack' }")

  if (indexOfFeed === -1 || indexOfDirectory === -1 || indexOfBackpack === -1) {
    fail('One or more required nav links are missing from the WebNavBar links array.')
  }

  if (!(indexOfFeed < indexOfDirectory && indexOfDirectory < indexOfBackpack)) {
    fail('WebNavBar tab order does not satisfy Feed -> Directory -> Backpack.')
  }

  log('PASS source tab sequence: Feed -> Directory -> Backpack')
}

async function runOptionalLiveCheck() {
  if (!storageStatePath) {
    log('SKIP live staging nav check (COMMUNITY_DIRECTORY_STORAGE_STATE not provided).')
    return
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: storageStatePath })
  const page = await context.newPage()

  try {
    await page.goto(`${baseUrl}/profile`, { waitUntil: 'networkidle' })

    const labels = await page
      .locator('a')
      .evaluateAll((anchors) =>
        anchors
          .map((a) => (a.textContent || '').trim())
          .filter((text) => Boolean(text))
      )

    const feedIndex = labels.indexOf('Feed')
    const directoryIndex = labels.indexOf('Directory')
    const backpackIndex = labels.indexOf('Backpack')

    if (feedIndex === -1 || directoryIndex === -1 || backpackIndex === -1) {
      fail(`Live nav is missing required labels. Labels seen: ${JSON.stringify(labels)}`)
    }

    if (!(feedIndex < directoryIndex && directoryIndex < backpackIndex)) {
      fail(`Live nav order mismatch. Labels seen: ${JSON.stringify(labels)}`)
    }

    log('PASS live staging tab sequence: Feed -> Directory -> Backpack')
  } finally {
    await context.close()
    await browser.close()
  }
}

await runSourceTabSequenceCheck()
await runOptionalLiveCheck()
log('All community directory evidence checks completed.')
