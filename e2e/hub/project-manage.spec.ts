import { test, expect } from '../fixtures/test.js';
import { HUB_URL } from '../fixtures/constants.js';

test.describe('Hub — Project management', () => {
  test('navigate to create-project page', async ({ page }) => {
    await page.goto(`${HUB_URL}/me/create-project`);
    await expect(page.locator('#name')).toBeVisible({ timeout: 10_000 });
  });

  test('create a new project', async ({ page }) => {
    await page.goto(`${HUB_URL}/me/create-project`);
    await expect(page.locator('#name')).toBeVisible({ timeout: 10_000 });

    const projectName = `E2E Project ${Date.now()}`;
    await page.locator('#name').fill(projectName);
    // Fill in the required topic/hashtag field
    await page.getByPlaceholder('game-jam').fill('e2e-test');
    await page.locator('button[type="submit"]').click();

    // Should redirect away from create-project page
    await expect(page).not.toHaveURL(/create-project/, { timeout: 10_000 });
  });
});
