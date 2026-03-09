import { test, expect } from '../fixtures/test.js';
import { HUB_URL } from '../fixtures/constants.js';

test.describe('Hub — User profile', () => {
  test('view own profile page', async ({ page }) => {
    await page.goto(`${HUB_URL}/me`);

    await expect(page.locator('main')).toBeVisible();
  });

  test.skip('edit display name', async ({ page }) => {
    // TODO
  });
});
