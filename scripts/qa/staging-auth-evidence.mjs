#!/usr/bin/env node

/**
 * staging-auth-evidence.mjs
 *
 * Dedicated onboarding + authentication E2E evidence for staging.
 * Scope: identity only — Solid Pod/WebID creation, Stellar lockb0x anchoring,
 * ZK attestation, OIDC bridge sign-in, consent authorization, and the final
 * authenticated session handoff. DocuStream/application features are
 * deliberately out of scope (see staging-docustream-pane-evidence.mjs).
 *
 * Journeys:
 *  1. New user: create node -> ZK proof -> Pod -> on-chain anchor ->
 *     OIDC bridge auto-login -> consent -> authenticated app session.
 *  2. Returning user: manual sign-in with the credentials chosen at
 *     onboarding -> consent (remembered or re-granted) -> authenticated
 *     app session.
 *
 * Usage:
 *   node scripts/qa/staging-auth-evidence.mjs
 *   STAGING_BASE_URL=https://staging.nodezero.social node scripts/qa/staging-auth-evidence.mjs
 */

import { chromium } from '@playwright/test'

const baseUrl = (process.env.STAGING_BASE_URL || 'https://staging.nodezero.social').replace(/\/$/, '')
const solidHost = (process.env.SOLID_HOST || 'solid.nodezero.social').toLowerCase()
const createTimeoutMs = Number(process.env.AUTH_E2E_CREATE_TIMEOUT_MS || 8 * 60 * 1000)
const authRedirectTimeoutMs = Number(process.env.AUTH_E2E_REDIRECT_TIMEOUT_MS || 4 * 60 * 1000)
const sessionTimeoutMs = Number(process.env.AUTH_E2E_SESSION_TIMEOUT_MS || 3 * 60 * 1000)

function log(message) {
  console.log(`[auth-evidence] ${message}`)
}

function fail(message) {
  console.error(`[auth-evidence] FAIL: ${message}`)
  process.exit(1)
}

function nowStamp() {
  return Date.now().toString(36)
}

function randomSuffix() {
  return Math.floor(Math.random() * 1e6).toString(36)
}

async function pageTextSnippet(page, length = 600) {
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? '')
    return text.replace(/\s+/g, ' ').slice(0, length)
  } catch {
    return '<unavailable>'
  }
}

function currentHost(page) {
  try {
    return new URL(page.url()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Detects a terminal identity-provider error page (e.g. invalid_request). */
async function detectIdpErrorPage(page) {
  return await page
    .evaluate(() => {
      const text = document.body?.innerText ?? ''
      if (text.includes('Bad request') || text.includes('invalid_request')) {
        return text.replace(/\s+/g, ' ').slice(0, 300)
      }
      return null
    })
    .catch(() => null)
}

/**
 * Handles the CSS consent screen when it appears: waits for the WebID radio
 * list to populate and clicks "Authorize and Continue" exactly once per
 * consent interaction. The consent template runs a multi-step async POST
 * sequence after the click, so re-clicking mid-flight corrupts the OIDC
 * interaction (surfaces as invalid_request). After clicking we wait for the
 * page to navigate away before returning control to the caller.
 */
async function authorizeConsentIfPresent(page, flowState) {
  const isConsent = await page
    .waitForFunction(() => {
      const text = document.body?.innerText ?? ''
      return text.includes('Authorize and Continue') || text.includes('Continue to NodeZero.social')
    }, { timeout: 10000 })
    .then(() => true)
    .catch(() => false)

  if (!isConsent) return false

  const consentUrl = page.url()
  if (flowState.authorizedUrls.has(consentUrl)) {
    // Already authorized this interaction; let the in-flight consent finish.
    await page.waitForTimeout(2000)
    return true
  }

  log('Consent screen detected; authorizing...')

  // Wait for the authorize button to become enabled (WebID list populated).
  const enabled = await page
    .waitForFunction(() => {
      const btn = document.getElementById('authorize')
      return btn && !btn.disabled
    }, { timeout: 30000 })
    .then(() => true)
    .catch(() => false)

  if (!enabled) {
    const idpError = await detectIdpErrorPage(page)
    if (idpError) {
      fail(`Identity provider rejected the interaction: ${idpError}`)
    }
    const snippet = await pageTextSnippet(page)
    fail(`Consent authorize button never became enabled. Page snippet: ${snippet}`)
  }

  // Ensure a WebID radio is selected (single WebID is auto-checked).
  await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"][name="webId"]'))
    if (radios.length > 0 && !radios.some((r) => r.checked)) {
      radios[0].checked = true
    }
  })

  flowState.authorizedUrls.add(consentUrl)
  await page.locator('#authorize').click({ timeout: 15000 })
  log('Consent authorized; waiting for redirect...')

  // The consent handler POSTs twice then sets location.href. Wait for the
  // navigation instead of re-entering the loop and re-clicking.
  await page
    .waitForURL((url) => url.toString() !== consentUrl, { timeout: 60000 })
    .catch(() => {})
  return true
}

/**
 * Drives the identity-provider (CSS) side of the flow to completion: bridge
 * auto-login (or manual credentials) and consent, until the browser returns
 * to the app origin.
 */
async function completeIdentityProviderFlow(page, options) {
  const { email, password, expectManual } = options
  const deadline = Date.now() + authRedirectTimeoutMs
  const appHost = new URL(baseUrl).hostname.toLowerCase()
  const flowState = {
    authorizedUrls: new Set(),
    manualSubmitted: false,
    manualAttempts: 0,
    lastManualSubmitAt: 0,
    loginPageFirstSeenAt: 0,
    forcedPlainLogin: false,
  }
  // Grace window that lets the OIDC bridge auto-login run before we fall back
  // to manual credentials (bridge consume + native form submit take a moment).
  const bridgeGraceMs = Number(process.env.AUTH_E2E_BRIDGE_GRACE_MS || 20000)
  // Upper bound for waiting on bridge-controlled readonly forms before forcing
  // navigation to a plain manual-login page.
  const bridgeStallMs = Number(process.env.AUTH_E2E_BRIDGE_STALL_MS || 45000)
  const manualRetryDelayMs = Number(process.env.AUTH_E2E_MANUAL_RETRY_DELAY_MS || 5000)
  const manualMaxAttempts = Number(process.env.AUTH_E2E_MANUAL_MAX_ATTEMPTS || 3)

  while (Date.now() < deadline) {
    const host = currentHost(page)

    if (host === appHost) {
      return
    }

    if (host !== solidHost) {
      await page.waitForTimeout(1000)
      continue
    }

    const idpError = await detectIdpErrorPage(page)
    if (idpError) {
      fail(`Identity provider returned an error page: ${idpError}`)
    }

    const path = new URL(page.url()).pathname

    if (path.includes('/oidc/') || path.includes('consent')) {
      await authorizeConsentIfPresent(page, flowState)
      await page.waitForTimeout(1000)
      continue
    }

    if (path.includes('/login/password')) {
      // Consent may render on this path too depending on CSS routing; check first.
      const consented = await authorizeConsentIfPresent(page, flowState)
      if (consented) {
        await page.waitForTimeout(1000)
        continue
      }

      const state = await page.evaluate(() => {
        const emailEl = document.getElementById('email')
        const passwordEl = document.getElementById('password')
        const errorEl = document.getElementById('error')
        const submitEl = document.querySelector('button[type="submit"]')
        return {
          hasForm: Boolean(emailEl && passwordEl),
          emailValue: emailEl ? emailEl.value : '',
          emailReadOnly: emailEl ? emailEl.readOnly : false,
          passwordReadOnly: passwordEl ? passwordEl.readOnly : false,
          errorText: errorEl ? errorEl.textContent.trim() : '',
          submitDisabled: submitEl ? submitEl.disabled : true,
        }
      })

      if (!state.hasForm) {
        await page.waitForTimeout(1000)
        continue
      }

      if (!flowState.loginPageFirstSeenAt) {
        flowState.loginPageFirstSeenAt = Date.now()
      }

      // Bridge auto-login in progress: the login template consumes the bridge
      // ticket and submits the native form itself. Give it the grace window.
      if (!expectManual) {
        const bridgeFellBack =
          state.errorText.includes('could not be completed automatically') ||
          state.errorText.toLowerCase().includes('audience is required')
        const bridgeManagedReadonly = state.emailReadOnly || state.passwordReadOnly
        const onLoginPageMs = Date.now() - flowState.loginPageFirstSeenAt
        const withinGrace = onLoginPageMs < bridgeGraceMs
        if (!bridgeFellBack && withinGrace) {
          if (state.errorText.includes('Completing secure sign-in')) {
            log('Bridge auto-login in progress...')
          }
          await page.waitForTimeout(1500)
          continue
        }

        // When the bridge owns the form, email/password stay readonly and are
        // not safe for manual fallback entry. Wait up to a capped window and
        // then drop bridge query params to recover manual login.
        if (!bridgeFellBack && bridgeManagedReadonly) {
          if (onLoginPageMs < bridgeStallMs) {
            await page.waitForTimeout(1500)
            continue
          }

          log('Bridge appears stalled on readonly login form; reloading manual login route.')
          const manualLoginUrl = new URL(page.url())
          manualLoginUrl.search = ''
          await page
            .goto(manualLoginUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 })
            .catch(() => {})
          flowState.loginPageFirstSeenAt = Date.now()
          await page.waitForTimeout(1500)
          continue
        }

        if (bridgeFellBack) {
          const bridgeScopedUrl = page.url().includes('nz_oidc_bridge=')
          if (!flowState.forcedPlainLogin && (bridgeScopedUrl || bridgeManagedReadonly)) {
            log('Bridge fallback detected on bridge-scoped login; reloading plain login route.')
            const manualLoginUrl = new URL(page.url())
            manualLoginUrl.search = ''
            await page
              .goto(manualLoginUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 })
              .catch(() => {})
            flowState.loginPageFirstSeenAt = Date.now()
            flowState.forcedPlainLogin = true
            await page.waitForTimeout(1500)
            continue
          }

          log('Bridge fallback message shown; continuing with manual credentials (fallback path).')
        } else if (!flowState.manualSubmitted) {
          log('Bridge auto-login did not complete within grace window; using manual credentials.')
        }
      }

      if (!flowState.manualSubmitted) {
        if (state.emailReadOnly || state.passwordReadOnly) {
          await page.waitForTimeout(1500)
          continue
        }

        flowState.manualAttempts += 1
        flowState.manualSubmitted = true
        flowState.lastManualSubmitAt = Date.now()
        log(`Submitting manual credentials on login page (${page.url()})...`)
        await page.locator('#email').fill(email, { timeout: 15000 })
        await page.locator('#password').fill(password, { timeout: 15000 })
        await page.locator('button[type="submit"]').first().click({ timeout: 15000 })
      } else if (
        state.errorText.toLowerCase().includes('invalid email/password combination') &&
        flowState.manualAttempts < manualMaxAttempts &&
        Date.now() - flowState.lastManualSubmitAt >= manualRetryDelayMs
      ) {
        log(
          `Manual login attempt ${flowState.manualAttempts} was rejected; retrying (max ${manualMaxAttempts}).`,
        )
        flowState.manualSubmitted = false
      }
      await page.waitForTimeout(2000)
      continue
    }

    // Unknown CSS page (e.g. .account index); give it a moment to route.
    await page.waitForTimeout(1500)
  }

  const snippet = await pageTextSnippet(page)
  fail(`Identity-provider flow did not return to the app in time. URL=${page.url()}. Page snippet: ${snippet}`)
}

/** Waits for the app to establish the authenticated session after OIDC return. */
async function waitForAuthenticatedSession(page, label) {
  log(`Waiting for authenticated session (${label})...`)
  const state = await page
    .waitForFunction(() => {
      try {
        const webId = localStorage.getItem('solid.webId.v1')
        if (webId) return { webId }
      } catch {
        // storage unavailable; fall through
      }
      return false
    }, { timeout: sessionTimeoutMs, polling: 1000 })
    .then(async (handle) => handle.jsonValue())
    .catch(() => null)

  if (!state || !state.webId) {
    const snippet = await pageTextSnippet(page)
    fail(`Authenticated session was not established (${label}). URL=${page.url()}. Page snippet: ${snippet}`)
  }

  log(`Session established (${label}): webId=${state.webId}`)
  return state.webId
}

/** Collects on-chain/node metadata persisted by onboarding for the evidence report. */
async function collectNodeSessionEvidence(page) {
  return await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('node.session.v1')
      if (!raw) return null
      const parsed = JSON.parse(raw)
      return {
        webId: parsed.webId ?? null,
        podUrl: parsed.podUrl ?? null,
        stellarPublicKey: parsed.stellarPublicKey ?? null,
        userLockboxContractId: parsed.userLockboxContractId ?? null,
        lockboxFactoryContractId: parsed.lockboxFactoryContractId ?? null,
        proofRootHex: parsed.proofRootHex ?? null,
      }
    } catch {
      return null
    }
  })
}

async function runNewUserJourney(browser, credentials) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const navigations = []
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    navigations.push(frame.url())
    if (navigations.length > 40) navigations.shift()
  })

  log(`NEW USER: starting create-node with handle '${credentials.handle}'.`)
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })

  try {
    await page.locator('input[aria-label="Node handle"]').first().fill(credentials.handle, { timeout: 30000 })
    await page.locator('input[aria-label="Notification email"]').first().fill(credentials.email, { timeout: 30000 })
  } catch {
    const snippet = await pageTextSnippet(page)
    fail(`Could not fill onboarding credentials. Page snippet: ${snippet}`)
  }

  log('NEW USER: waiting for wallet-ready create button...')
  await page
    .waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      return nodes.some((node) => (node.textContent || '').trim() === 'Create Your Node')
    }, { timeout: createTimeoutMs })
    .catch(async () => {
      const snippet = await pageTextSnippet(page)
      fail(`Create button never became ready (wallet init). Page snippet: ${snippet}`)
    })

  log('NEW USER: submitting Create Your Node...')
  const clicked = await page.evaluate(() => {
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      .filter((node) => (node.textContent || '').trim() === 'Create Your Node')
      .filter(isVisible)
    const target = nodes[nodes.length - 1]
    if (!target) return false
    const clickable = target.closest('[role="button"], button') ?? target
    clickable.scrollIntoView({ block: 'center' })
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  })
  if (!clicked) {
    fail('Create Your Node button could not be clicked.')
  }

  // Phase 1: provisioning on the app origin (ZK proof, Pod, anchor). Track
  // progress text or an explicit error until the page redirects to the IdP.
  log('NEW USER: waiting for provisioning to complete and bridge redirect to begin...')
  const provisioningDeadline = Date.now() + createTimeoutMs
  let sawProgress = false
  for (;;) {
    if (Date.now() > provisioningDeadline) {
      const snippet = await pageTextSnippet(page)
      fail(`Provisioning did not reach the identity provider in time. sawProgress=${sawProgress}. URL=${page.url()}. Navigations=${JSON.stringify(navigations.slice(-8))}. Page snippet: ${snippet}`)
    }

    const host = currentHost(page)
    if (host === solidHost) {
      log('NEW USER: redirected to identity provider for bridge sign-in.')
      break
    }

    const status = await page
      .evaluate(() => {
        const text = document.body?.innerText ?? ''
        const progressMarkers = [
          'Checking account availability',
          'Generating your zero-knowledge proof',
          'Creating your Pod on the Node Zero Community Server',
          'Confirming your on-chain lockb0x anchor',
          'Continuing to secure sign-in',
        ]
        const errorMarkers = [
          'Node created, but',
          'Could not create your node',
          'This email address is already registered',
          'Zero-knowledge proof assets could not be loaded',
          'Your wallet is still initializing',
          'Password must be at least',
          'Passwords do not match',
        ]
        return {
          progress: progressMarkers.find((m) => text.includes(m)) ?? null,
          error: errorMarkers.find((m) => text.includes(m)) ?? null,
        }
      })
      .catch(() => null)

    if (status?.error) {
      const snippet = await pageTextSnippet(page)
      fail(`Onboarding surfaced an error: '${status.error}'. Page snippet: ${snippet}`)
    }
    if (status?.progress) {
      if (!sawProgress) log(`NEW USER: provisioning progress: ${status.progress}`)
      sawProgress = true
    }

    await page.waitForTimeout(1500)
  }

  // Phase 2: identity-provider flow (bridge auto-login + consent).
  await completeIdentityProviderFlow(page, {
    email: credentials.email,
    password: credentials.password,
    expectManual: false,
  })
  log(`NEW USER: returned to app at ${page.url()}.`)

  // Phase 3: session establishment on the app origin.
  const webId = await waitForAuthenticatedSession(page, 'new user')
  const nodeEvidence = await collectNodeSessionEvidence(page)

  if (!nodeEvidence?.userLockboxContractId) {
    fail(`Node session is missing the on-chain lockb0x contract id. Evidence=${JSON.stringify(nodeEvidence)}`)
  }

  log(`NEW USER: PASS. webId=${webId}`)
  log(`NEW USER: on-chain evidence: ${JSON.stringify(nodeEvidence)}`)

  return { webId, nodeEvidence, context }
}

async function runReturningUserJourney(context, credentials) {
  const page = await context.newPage()

  log('RETURNING USER: starting sign-in from same browser context (preserved IdP session).')

  // Simulate app restart while preserving the embedded wallet key so the
  // user appears signed out locally but can still complete the auth flow.
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => {
    const walletKey = 'nodezero.embedded-wallet.nodezero.stellar.secret'
    const walletSecret = localStorage.getItem(walletKey)
    localStorage.clear()
    if (walletSecret) {
      localStorage.setItem(walletKey, walletSecret)
    }
  })

  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)

  const signInButton = page.getByRole('button', { name: 'Sign In' }).first()
  await signInButton.click({ timeout: 30000 }).catch(async () => {
    const snippet = await pageTextSnippet(page)
    fail(`Sign In button was not clickable. Page snippet: ${snippet}`)
  })

  await page
    .waitForURL((url) => url.hostname.toLowerCase() === solidHost, { timeout: authRedirectTimeoutMs })
    .catch(async () => {
      const snippet = await pageTextSnippet(page)
      fail(`Sign In did not reach the identity provider. URL=${page.url()}. Page snippet: ${snippet}`)
    })

  await completeIdentityProviderFlow(page, {
    email: credentials.email,
    password: credentials.password,
    expectManual: false,
  })
  log(`RETURNING USER: returned to app at ${page.url()}.`)

  const webId = await waitForAuthenticatedSession(page, 'returning user')
  log(`RETURNING USER: PASS. webId=${webId}`)

  return { webId }
}

async function run() {
  if (!baseUrl.startsWith('https://')) {
    fail(`STAGING_BASE_URL must use https (got '${baseUrl}').`)
  }

  const runId = `${nowStamp()}${randomSuffix()}`
  const credentials = {
    handle: `qa${runId}`,
    email: `qa+${runId}@example.com`,
    password: `NzQa!${runId}Pass2026`,
  }

  log(`Run against ${baseUrl} (IdP: ${solidHost}); handle=${credentials.handle}.`)

  const browser = await chromium.launch({ headless: true })
  try {
    const newUser = await runNewUserJourney(browser, credentials)
    const returningUser = await runReturningUserJourney(newUser.context, credentials)

    if (newUser.webId !== returningUser.webId) {
      fail(`WebID mismatch between journeys: new='${newUser.webId}' returning='${returningUser.webId}'.`)
    }

    log('AUTH EVIDENCE: PASS — new-user onboarding and returning-user authentication verified end-to-end.')
    log(`Summary: ${JSON.stringify({
      webId: newUser.webId,
      lockbox: newUser.nodeEvidence?.userLockboxContractId ?? null,
      factory: newUser.nodeEvidence?.lockboxFactoryContractId ?? null,
      proofRoot: newUser.nodeEvidence?.proofRootHex ?? null,
    })}`)

    await newUser.context.close()
  } finally {
    await browser.close()
  }
}

run().catch((err) => {
  console.error('[auth-evidence] Error stack:', err)
  fail(err instanceof Error ? err.message : String(err))
})
