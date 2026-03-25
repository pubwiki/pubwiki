/**
 * Playwright global setup — registers a default test user and persists
 * the authenticated browser state so every other project can skip login.
 *
 * We register via the API first (fast, idempotent), then log in through
 * the Hub's actual login page so the browser picks up auth cookies for
 * the correct API domain (which may differ from localhost in dev).
 */

import { test as setup, expect } from '@playwright/test';
import { getApiBaseUrl, getHubUrl, TEST_PASSWORD, AUTH_STATE_PATH } from './constants.js';

const DEFAULT_USER = 'e2e_default';

setup('authenticate default user', async ({ page }) => {
  // 1. Ensure the user exists via API (idempotent)
  const API_BASE_URL = getApiBaseUrl();
  const HUB_URL = getHubUrl();
  const origin = new URL(API_BASE_URL).origin;

  const _res = await page.request.post(`${API_BASE_URL}/auth/sign-up/email`, {
    data: {
      name: DEFAULT_USER,
      username: DEFAULT_USER,
      email: `${DEFAULT_USER}@e2e-test.local`,
      password: TEST_PASSWORD,
    },
    headers: { Origin: origin },
    ignoreHTTPSErrors: true,
  });
  // User may already exist — that's fine.

  // 2. Intercept API calls in the browser so they hit localhost
  //    (the Hub .env may point to a LAN IP).
  const apiPort = new URL(API_BASE_URL).port;
  await page.route(new RegExp(`https?://(?!localhost)[^/]*:${apiPort}/`), (route) => {
    const rewritten = route.request().url().replace(
      new RegExp(`https?://[^/]+:${apiPort}`),
      origin,
    );
    route.continue({ url: rewritten });
  });

  // 3. Log in via the actual Hub login page so the browser gets cookies
  await page.goto(`${HUB_URL}/login`);

  await page.locator('#usernameOrEmail').fill(`${DEFAULT_USER}@e2e-test.local`);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.locator('button[type="submit"]').click();

  // Wait for successful redirect to home
  await expect(page).toHaveURL(/\/(\?|$)/, { timeout: 15_000 });

  // 4. Persist the authenticated state for downstream projects
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
