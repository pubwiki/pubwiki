import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { getHubUrl, TEST_PASSWORD } from '../constants.js';

export class HubPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async register(username: string, email: string, password: string = TEST_PASSWORD) {
    await this.page.goto(`${getHubUrl()}/register`);

    await this.page.locator('#username').fill(username);
    await this.page.locator('#email').fill(email);
    await this.page.locator('#password').fill(password);
    await this.page.locator('#confirmPassword').fill(password);
    await this.page.locator('button[type="submit"]').click();

    await expect(this.page).toHaveURL(/\/(?:\?|$)/, { timeout: 15_000 });
  }

  async login(usernameOrEmail: string, password: string = TEST_PASSWORD) {
    await this.page.goto(`${getHubUrl()}/login`);

    await this.page.locator('#usernameOrEmail').fill(usernameOrEmail);
    await this.page.locator('#password').fill(password);
    await this.page.locator('button[type="submit"]').click();

    await expect(this.page).toHaveURL(/\/(?:\?|$)/, { timeout: 15_000 });
  }

  async openArtifact(artifactId: string) {
    await this.page.goto(`${getHubUrl()}/artifact/${artifactId}`);
    // Wait for the page to load
    await this.page.waitForLoadState('networkidle');
  }

  /** Returns the Play link element for the given artifact detail page */
  getPlayLink(): Locator {
    return this.page.locator('a[href*="/player/"], a[class*="bg-[#2da44e]"]').first();
  }

  async clickPlay(): Promise<Page> {
    const playLink = this.getPlayLink();
    await expect(playLink).toBeVisible({ timeout: 10_000 });

    // The play link opens in same tab or new tab; handle both
    const [newPage] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout: 10_000 }).catch(() => null),
      playLink.click(),
    ]);

    // If it opened a new tab, return that; otherwise return current page
    return newPage ?? this.page;
  }
}
