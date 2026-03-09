/**
 * Extended Playwright test fixture.
 *
 * When the Hub frontend is configured with a non-localhost API URL (e.g.
 * a LAN IP in .env), the browser sends API requests to that host. Auth
 * cookies would then be scoped to that domain, causing mismatches with
 * our test-setup API calls that go directly to localhost.
 *
 * This fixture intercepts browser requests and rewrites non-localhost API
 * URLs to https://localhost:8787, ensuring cookies and auth state are
 * consistent across setup + browser tests.
 */

import { test as base } from '@playwright/test';
import { API_BASE_URL } from './constants.js';

const API_ORIGIN = new URL(API_BASE_URL).origin; // e.g. "https://localhost:8787"

export const test = base.extend({
  page: async ({ page }, use) => {
    // Rewrite any non-localhost API request to the test API origin.
    // Pattern matches any host on port 8787 (the backend port).
    await page.route(/https?:\/\/(?!localhost)[^/]*:8787\//, (route) => {
      const original = route.request().url();
      const rewritten = original.replace(/https?:\/\/[^/]+:8787/, API_ORIGIN);
      route.continue({ url: rewritten });
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
