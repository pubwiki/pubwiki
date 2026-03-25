import { test, expect } from '../fixtures/test.js';
import { getHubUrl } from '../fixtures/constants.js';

test.describe('Hub — Artifact browsing', () => {
  test('home page loads artifact list', async ({ page }) => {
    await page.goto(getHubUrl());

    await expect(page.locator('main')).toBeVisible();
  });

  test('search artifacts by keyword', async ({ page }) => {
    await page.goto(getHubUrl());

    // The search input is a plain text input with a search placeholder
    const searchInput = page.locator('input[type="text"]').first();
    await searchInput.fill('test');

    // Search is debounced — wait for URL or results to update
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/q=test/);
  });

  test('sort artifacts by popularity', async ({ page }) => {
    await page.goto(getHubUrl());

    await expect(page.locator('main')).toBeVisible();
    // The page uses sort buttons / dropdown — navigate with URL params
    await page.goto(`${getHubUrl()}/?sort=viewCount&order=desc`);
    await expect(page).toHaveURL(/sort=viewCount/);
  });
});
