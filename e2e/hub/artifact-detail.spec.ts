import { test, expect } from '../fixtures/test.js';
import { getHubUrl } from '../fixtures/constants.js';
import { createUser, createArtifact } from '../fixtures/test-data-factory.js';

test.describe('Hub — Artifact detail', () => {
  let artifactId: string;

  test.beforeAll(async () => {
    const user = await createUser(`detail-${Date.now()}`);
    const artifact = await createArtifact({
      sessionCookie: user.sessionCookie,
      name: `E2E Detail Test ${Date.now()}`,
    });
    artifactId = artifact.id;
  });

  test('artifact detail page renders metadata', async ({ page }) => {
    await page.goto(`${getHubUrl()}/artifact/${artifactId}`);

    await expect(page.locator('main')).toBeVisible();
    // Title should contain the artifact name
    await expect(page.locator('h1, h2').first()).toContainText('E2E Detail Test');
  });
});
