import { test, expect } from '../fixtures/test.js';
import type { Page } from '@playwright/test';
import { HubPage } from '../fixtures/pages/hub-page.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';
import { PlayerPage } from '../fixtures/pages/player-page.js';
import { packArtifact } from '../fixtures/pack-artifact.js';
import { getApiBaseUrl, getHubUrl } from '../fixtures/constants.js';
import path from 'node:path';

const BLOBS = path.resolve(import.meta.dirname, '../blobs');
const ARTIFACT_DIR = path.join(BLOBS, 'artifacts/artifact1');
const COVER_IMAGE = path.join(BLOBS, 'images/cover.jpg');

test.describe('Unlisted artifact visibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('unlisted artifact is hidden from Hub listing but accessible via direct link', async ({ page }) => {
    test.setTimeout(300_000);

    const artifactZip = packArtifact(ARTIFACT_DIR);
    const timestamp = Date.now();
    const username = `e2e_unlisted_${timestamp}`;
    const email = `${username}@e2e-test.local`;
    const artifactName = `E2E Parent ${timestamp}`;
    const unlistedName = `E2E Unlisted ${timestamp}`;
    let playerPageRef: Page;
    let unlistedArtifactId: string;

    // ── Step 1: Register ──
    await test.step('Register a new account', async () => {
      const hub = new HubPage(page);
      await hub.register(username, email);
    });

    // ── Step 2: Import project in Studio ──
    let projectId: string;
    await test.step('Import project from ZIP in Studio', async () => {
      const studio = new StudioPage(page);
      await studio.goto();
      await studio.importFromFile(artifactZip);
      projectId = studio.getProjectId();
    });

    // ── Step 3: Configure ──
    await test.step('Configure project metadata', async () => {
      const studio = new StudioPage(page);
      await studio.configureProject({
        name: artifactName,
        description: 'Parent artifact for unlisted test',
        tags: 'e2e, unlisted',
        version: '1.0.0',
      });
      await studio.uploadCover(COVER_IMAGE);
    });

    // ── Step 4: Set entrypoint ──
    await test.step('Set entrypoint to Sandbox', async () => {
      const studio = new StudioPage(page);
      await studio.setEntrypoint('Sandbox');
    });

    // ── Step 5: Build ──
    await test.step('Build the project', async () => {
      const studio = new StudioPage(page);
      await studio.build();
    });

    // ── Step 6: Publish (listed) ──
    await test.step('Publish to Hub', async () => {
      const studio = new StudioPage(page);
      await studio.publish();
    });

    // ── Step 7: Open in Player ──
    await test.step('Open artifact in Player', async () => {
      const hub = new HubPage(page);
      await hub.openArtifact(projectId!);
      playerPageRef = await hub.clickPlay();

      const player = new PlayerPage(playerPageRef);
      await player.waitForReady();
      await player.waitForAppLog();
      expect(await player.hasError()).toBeFalsy();
    });

    // ── Step 8: Save state in Player ──
    await test.step('Save state via RPC', async () => {
      const sandboxApp = playerPageRef.frameLocator('iframe').frameLocator('iframe');

      const skipBtn = sandboxApp.locator('.welcome-skip');
      const creaturesTab = sandboxApp.locator('.paper-tab-btn').filter({ hasText: '👥' });

      await expect(skipBtn.or(creaturesTab).first()).toBeVisible({ timeout: 120_000 });
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await expect(creaturesTab).toBeVisible({ timeout: 30_000 });
      }

      // Save state via RPC
      const rpcResult = await sandboxApp.locator('body').evaluate(async () => {
        const timeout = new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('SAVE_RPC_TIMEOUT_10s')), 10_000));
        const result = await Promise.race([(window as Record<string, unknown>).LoadStateToGame({
          worldEntity: { name: 'Unlisted Test World', description: '' },
          creatures: [],
          regions: [],
          organizations: [],
        }), timeout]);
        return result;
      });
      expect((rpcResult as Record<string, unknown>).success).toBeTruthy();
      await playerPageRef.waitForTimeout(1000);
    });

    // ── Step 9: Publish from Player as UNLISTED ──
    await test.step('Publish artifact from Player as UNLISTED', async () => {
      const sandboxApp = playerPageRef.frameLocator('iframe').frameLocator('iframe');

      // Listen for POST /api/artifacts
      const responsePromise = playerPageRef.waitForResponse(
        resp => resp.url().includes('/api/artifacts') && resp.request().method() === 'POST' && resp.status() < 400,
        { timeout: 60_000 }
      );

      // Open publish dialog via toolbar
      await sandboxApp.locator('.btn-toolbar').filter({ hasText: '📦' }).click();
      await sandboxApp.locator('.dropdown-content button').filter({ hasText: '🚀' }).click();

      // Dialog appears on the player page (portaled)
      const dialog = playerPageRef.locator('[role="dialog"][aria-modal="true"]');
      await expect(dialog).toBeVisible({ timeout: 30_000 });

      // Fill artifact name
      const nameInput = dialog.locator('input[type="text"]').first();
      await nameInput.fill(unlistedName);

      // Change visibility to "Unlisted" via the Dropdown component
      // The Dropdown renders as a button inside a relative div; click it to open options
      const visibilityDropdown = dialog.locator('button').filter({ hasText: 'Public' });
      await visibilityDropdown.click();

      // Select "Unlisted" from the dropdown options
      const unlistedOption = playerPageRef.locator('button').filter({ hasText: 'Unlisted' });
      await unlistedOption.click();

      // Verify dropdown now shows "Unlisted"
      await expect(dialog.locator('button').filter({ hasText: 'Unlisted' })).toBeVisible();

      // Confirm publish
      await dialog.locator('button.bg-blue-500').click();

      // Wait for API response
      const response = await responsePromise;
      const body = await response.json();
      unlistedArtifactId = body.artifact?.id;
      expect(unlistedArtifactId).toBeTruthy();

      // Wait for dialog to close
      await expect(dialog).not.toBeVisible({ timeout: 15_000 });

      // Close player page
      if (playerPageRef !== page) await playerPageRef.close();
    });

    // ── Step 10: Verify unlisted artifact is NOT in Hub listing (guest view) ──
    await test.step('Verify unlisted artifact is not in Hub artifact listing', async () => {
      // Use a fresh browser context with no auth (guest/visitor)
      const guestContext = await page.context().browser()!.newContext({
        ignoreHTTPSErrors: true,
      });
      const guestPage = await guestContext.newPage();

      try {
        // Check via API: GET /artifacts should NOT include the unlisted artifact
        const listResp = await guestPage.request.get(
          `${getApiBaseUrl()}/artifacts?page=1&limit=100&sortBy=createdAt&sortOrder=desc`
        );
        expect(listResp.ok()).toBeTruthy();
        const listData = await listResp.json();
        const artifactIds = (listData.artifacts ?? []).map((a: Record<string, unknown>) => a.id);
        expect(artifactIds,
          'Unlisted artifact should NOT appear in public artifact listing'
        ).not.toContain(unlistedArtifactId);

        // Also verify via Hub UI: navigate to homepage and confirm the name isn't shown
        await guestPage.goto(getHubUrl());
        await guestPage.waitForLoadState('networkidle');
        // Give time for artifact cards to render
        await guestPage.waitForTimeout(2000);

        const unlistedCard = guestPage.locator('text=' + unlistedName);
        await expect(unlistedCard).not.toBeVisible({ timeout: 5_000 });
      } finally {
        await guestContext.close();
      }
    });

    // ── Step 11: Verify unlisted artifact IS accessible via direct link ──
    await test.step('Verify unlisted artifact is accessible via direct link', async () => {
      // Use a guest context - anyone with the link can access unlisted artifacts
      const guestContext = await page.context().browser()!.newContext({
        ignoreHTTPSErrors: true,
      });
      const guestPage = await guestContext.newPage();

      try {
        // Direct API access — GET /artifacts/{artifactId} should return the artifact detail
        const detailResp = await guestPage.request.get(
          `${getApiBaseUrl()}/artifacts/${unlistedArtifactId}`
        );
        expect(detailResp.ok(),
          'Unlisted artifact should be accessible via GET /artifacts/{id}'
        ).toBeTruthy();
        const detailData = await detailResp.json();
        expect(detailData.artifact?.id).toBe(unlistedArtifactId);
        expect(detailData.artifact?.isListed).toBe(false);

        // Graph API access should also work
        const graphResp = await guestPage.request.get(
          `${getApiBaseUrl()}/artifacts/${unlistedArtifactId}/graph?version=latest`
        );
        expect(graphResp.ok(),
          'Unlisted artifact graph should be accessible via direct API call'
        ).toBeTruthy();
        const graphData = await graphResp.json();
        expect(graphData.version?.buildCacheKey,
          'Unlisted artifact should have inherited buildCacheKey'
        ).toBeTruthy();

        // Hub UI direct navigation should render the artifact detail page
        const hubUrl = getHubUrl();
        await guestPage.goto(`${hubUrl}/artifact/${unlistedArtifactId}`);
        await expect(guestPage.getByRole('heading', { name: unlistedName })).toBeVisible({ timeout: 30_000 });
      } finally {
        await guestContext.close();
      }
    });
  });
});
