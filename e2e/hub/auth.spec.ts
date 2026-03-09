import { test, expect } from '../fixtures/test.js';
import { HUB_URL, TEST_PASSWORD } from '../fixtures/constants.js';

test.describe('Hub — Authentication', () => {
  // Auth tests need a fresh context (no pre-existing session)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('register a new account and land on home page', async ({ page }) => {
    const username = `e2e_auth_${Date.now()}`;

    await page.goto(`${HUB_URL}/register`);

    await page.locator('#username').fill(username);
    await page.locator('#email').fill(`${username}@e2e-test.local`);
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('#confirmPassword').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    // Should redirect to home with authenticated state
    await expect(page).toHaveURL(/\/(?:\?|$)/, { timeout: 10_000 });
  });

  test('login with existing credentials', async ({ page }) => {
    // Relies on the default user created by auth.setup.ts
    await page.goto(`${HUB_URL}/login`);

    await page.locator('#usernameOrEmail').fill('e2e_default@e2e-test.local');
    await page.locator('#password').fill(TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/(?:\?|$)/, { timeout: 10_000 });
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto(`${HUB_URL}/login`);

    await page.locator('#usernameOrEmail').fill('e2e_default@e2e-test.local');
    await page.locator('#password').fill('wrong-password');
    await page.locator('button[type="submit"]').click();

    // Should stay on login page with an error message
    await expect(page).toHaveURL(/login/);
    await expect(page.locator('.bg-red-50')).toBeVisible();
  });
});
