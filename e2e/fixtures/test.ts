/**
 * Extended Playwright test fixture.
 *
 * When the Hub frontend is configured with a non-localhost API URL (e.g.
 * a LAN IP in .env), the browser sends API requests to that host. Auth
 * cookies would then be scoped to that domain, causing mismatches with
 * our test-setup API calls that go directly to localhost.
 *
 * This fixture intercepts browser requests and rewrites non-localhost API
 * URLs to the test API origin, ensuring cookies and auth state are
 * consistent across setup + browser tests.
 */

import { test as base } from '@playwright/test';
import { getApiBaseUrl } from './constants.js';

export const test = base.extend({
  page: async ({ page }, use) => {
    const apiBaseUrl = getApiBaseUrl();
    const apiOrigin = new URL(apiBaseUrl).origin;
    const apiPort = new URL(apiBaseUrl).port;
    // Rewrite any non-localhost API request to the test API origin.
    // Pattern matches any host on the backend port.
    const pattern = new RegExp(`https?://(?!localhost)[^/]*:${apiPort}/`);
    await page.route(pattern, (route) => {
      const original = route.request().url();
      const rewritten = original.replace(
        new RegExp(`https?://[^/]+:${apiPort}`),
        apiOrigin,
      );
      route.continue({ url: rewritten });
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
