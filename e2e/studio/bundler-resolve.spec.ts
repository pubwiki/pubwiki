import { test, expect } from '../fixtures/test.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';
import { packArtifact } from '../fixtures/pack-artifact.js';
import path from 'node:path';
import type { Page, Locator } from '@playwright/test';

const BLOBS = path.resolve(import.meta.dirname, '../blobs');
const ARTIFACT_DIR = path.join(BLOBS, 'artifacts/artifact1');

/**
 * Wait for a locator to become visible, extending the deadline as long as
 * CDN fetches (esm.sh / unpkg / jsdelivr) or build-progress console logs
 * are still happening.
 */
async function waitWhileBundling(
  page: Page,
  locator: Locator,
  { idleTimeout = 30_000 }: { idleTimeout?: number } = {},
): Promise<void> {
  let lastActivity = Date.now();
  const trackActivity = () => { lastActivity = Date.now(); };

  const onRequest = (req: { url(): string }) => {
    if (/esm\.sh|unpkg|jsdelivr/.test(req.url())) trackActivity();
  };
  const onConsole = (msg: { text(): string }) => {
    if (/Downloading|Resolving|Building|Bundling/.test(msg.text())) trackActivity();
  };

  page.on('request', onRequest);
  page.on('console', onConsole);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (await locator.isVisible().catch(() => false)) return;

      if (Date.now() - lastActivity > idleTimeout) {
        throw new Error(
          `waitWhileBundling: no CDN/build activity for ${idleTimeout}ms, element still not visible`,
        );
      }

      await page.waitForTimeout(500);
    }
  } finally {
    page.off('request', onRequest);
    page.off('console', onConsole);
  }
}

test.describe('Studio — Bundler Dependency Resolution', () => {
  test('no duplicate esm.sh requests and no 404 responses', async ({ page }) => {
    // No fixed timeout — waitWhileBundling handles dynamic deadline extension
    test.setTimeout(0);

    const artifactZip = packArtifact(ARTIFACT_DIR);

    // ── Set up network interception BEFORE import ──
    // Track only non-redirect requests (redirectedFrom === null means it's an original request)
    const esmRequests: { url: string; method: string }[] = [];
    const esmResponses: { url: string; status: number }[] = [];

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('esm.sh') && !req.redirectedFrom()) {
        esmRequests.push({ url, method: req.method() });
      }
    });

    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('esm.sh')) {
        esmResponses.push({ url, status: res.status() });
      }
    });

    // ── Step 1: Import project ──
    const studio = new StudioPage(page);
    await studio.goto();
    await studio.importFromFile(artifactZip);

    // ── Step 2: Click sandbox node's "Open" button to trigger build ──
    const sandboxNodeId = 'fa7cd77a-ea55-4640-930c-bd879e56287f';
    await studio.collapseSidebar();

    // Fit all nodes into view
    const fitViewBtn = page.locator('button[title="Fit View"], button:has-text("Fit View")').first();
    if (await fitViewBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await fitViewBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    const node = page.locator(`.svelte-flow__node[data-id="${sandboxNodeId}"]`);
    await expect(node).toBeVisible({ timeout: 30_000 });

    const openBtn = node.locator('button.bg-orange-500');
    await expect(openBtn).toBeVisible({ timeout: 30_000 });
    await openBtn.click({ force: true });

    // ── Step 3: Wait for build to complete ──
    const sandboxIframe = page.locator('iframe[sandbox]');
    await waitWhileBundling(page, sandboxIframe);

    // Wait a bit more for any trailing requests
    await page.waitForTimeout(5_000);

    // ── Step 4: Verify no duplicate esm.sh requests ──
    // Group by method — HEAD requests come from dependency resolution,
    // GET requests come from content loading. Both should be deduplicated.
    const getRequests = esmRequests.filter(r => r.method === 'GET').map(r => r.url);
    const headRequests = esmRequests.filter(r => r.method === 'HEAD').map(r => r.url);

    const findDuplicates = (urls: string[]) => {
      const seen = new Set<string>();
      const dups: string[] = [];
      for (const url of urls) {
        if (seen.has(url)) dups.push(url);
        seen.add(url);
      }
      return dups;
    };

    const getDuplicates = findDuplicates(getRequests);
    const headDuplicates = findDuplicates(headRequests);

    if (getDuplicates.length > 0) {
      console.log(`\n── Duplicate GET requests (${getDuplicates.length}) ──`);
      for (const url of [...new Set(getDuplicates)]) {
        const count = getRequests.filter(u => u === url).length;
        console.log(`  [${count}x] ${url}`);
      }
    }

    if (headDuplicates.length > 0) {
      console.log(`\n── Duplicate HEAD requests (${headDuplicates.length}) ──`);
      for (const url of [...new Set(headDuplicates)]) {
        const count = headRequests.filter(u => u === url).length;
        console.log(`  [${count}x] ${url}`);
      }
    }

    expect(getDuplicates, `Duplicate GET requests to esm.sh (bundler http cache should prevent these):\n${[...new Set(getDuplicates)].join('\n')}`).toHaveLength(0);
    expect(headDuplicates, `Duplicate HEAD requests to esm.sh (resolve cache should prevent these):\n${[...new Set(headDuplicates)].join('\n')}`).toHaveLength(0);

    // ── Step 5: Verify no 404 responses from esm.sh ──
    const notFound = esmResponses.filter(r => r.status === 404);

    if (notFound.length > 0) {
      console.log(`Found ${notFound.length} 404 responses from esm.sh:`);
      for (const { url } of notFound) {
        console.log(`  404: ${url}`);
      }
    }

    expect(notFound, `esm.sh returned 404 for these URLs (wrong package names?):\n${notFound.map(r => r.url).join('\n')}`).toHaveLength(0);

    // ── Summary ──
    console.log(`\nesm.sh request summary:`);
    console.log(`  GET:  ${getRequests.length} total, ${new Set(getRequests).size} unique`);
    console.log(`  HEAD: ${headRequests.length} total, ${new Set(headRequests).size} unique`);
    console.log(`  404s: 0`);
  });
});
