/**
 * ============================================================
 * DOCS_AGENT DEVELOPMENT-ONLY MOCK — NEVER DEPLOY
 * ============================================================
 * This script is exclusively for use by DOCS_AGENT during
 * Playwright-driven documentation walkthroughs in the local
 * development environment.
 *
 * PURPOSE: Virtual/CI environments cannot provide real GPS data.
 * This mock injects a fixed geolocation so the geo-discovery
 * feature renders meaningfully in screenshots and videos.
 *
 * FIXED LOCATION: Sahara Ave & Las Vegas Blvd, Las Vegas, NV
 *   Latitude:  36.1147 N
 *   Longitude: -115.1728 W
 *
 * SAFETY CONSTRAINTS:
 *   - This file must NOT be imported by any package in packages/
 *   - This file must NOT be bundled into any deployable artifact
 *   - This file must NOT be referenced outside of DOCS_AGENT role card
 *   - This file lives in docs/dev-only/ which is excluded from all
 *     build and deployment pipelines
 *
 * USAGE (via mcp_playwright_browser_evaluate, before any geo route):
 *   Paste or read file contents and evaluate in the browser context.
 * ============================================================
 */

(function installDocsAgentMockGeolocation() {
  if (typeof window === 'undefined') return;

  // Guard: refuse to run in non-development contexts
  const host = window.location.hostname;
  const isDevContext =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.local') ||
    host.includes('staging');

  if (!isDevContext) {
    console.warn('[mock-geolocation] Refused to install: not a dev/staging host.');
    return;
  }

  const MOCK_POSITION = {
    coords: {
      latitude: 36.1147,
      longitude: -115.1728,
      accuracy: 10,
      altitude: 615,         // Las Vegas elevation ~615 m
      altitudeAccuracy: 5,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  };

  const mockGeolocation = {
    getCurrentPosition(successCallback, _errorCallback, _options) {
      setTimeout(() => successCallback(MOCK_POSITION), 0);
    },
    watchPosition(successCallback, _errorCallback, _options) {
      setTimeout(() => successCallback(MOCK_POSITION), 0);
      return 1; // mock watch ID
    },
    clearWatch(_watchId) {},
  };

  // Override via defineProperty so Permissions API prompts are also
  // suppressed without requiring the user to click Allow.
  Object.defineProperty(navigator, 'geolocation', {
    value: mockGeolocation,
    configurable: true,
    writable: false,
  });

  console.info(
    '[mock-geolocation] DOCS_AGENT dev mock installed. ' +
    'Fixed position: Sahara Ave & Las Vegas Blvd, Las Vegas NV ' +
    '(36.1147, -115.1728). NEVER DEPLOY.'
  );
})();
