import { test, expect } from '../fixtures/test.js';
import { HubPage } from '../fixtures/pages/hub-page.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';
import { packArtifact } from '../fixtures/pack-artifact.js';
import path from 'node:path';

const BLOBS = path.resolve(import.meta.dirname, '../blobs');
const ARTIFACT_DIR = path.join(BLOBS, 'artifacts/artifact1');

/**
 * Sandbox Preview — test local build via Studio's sandbox node "Open" button.
 *
 * This bypasses the entire publish → backend → Player pipeline and tests
 * ONLY the local compilation path (L3). If this works but the publish-flow
 * test fails at Step 18, the bug is in the publish/build-cache pipeline.
 */
test.describe('Integration — Sandbox Preview (local build)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('import → open sandbox preview → verify React app renders', async ({ page }) => {
    test.setTimeout(180_000);
    const artifactZip = packArtifact(ARTIFACT_DIR);
    const timestamp = Date.now();
    const username = `e2e_sandbox_${timestamp}`;
    const email = `${username}@e2e-test.local`;

    // ── Step 1: Register ──
    await test.step('Register a new account', async () => {
      const hub = new HubPage(page);
      await hub.register(username, email);
    });

    // ── Step 2: Import project ──
    let projectId: string;
    await test.step('Import project from ZIP in Studio', async () => {
      const studio = new StudioPage(page);
      await studio.goto();
      await studio.importFromFile(artifactZip);
      projectId = studio.getProjectId();
    });

    // ── Step 3: Click sandbox node's "Open" button ──
    await test.step('Click sandbox node Open button to start local preview', async () => {
      // The sandbox node ID from the artifact manifest
      const sandboxNodeId = 'fa7cd77a-ea55-4640-930c-bd879e56287f';

      // Collapse the sidebar so it doesn't overlap the canvas
      const studio = new StudioPage(page);
      await studio.collapseSidebar();

      // Fit all nodes into view so the sandbox node is visible
      const fitViewBtn = page.locator('button[title="Fit View"], button:has-text("Fit View")').first();
      if (await fitViewBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await fitViewBtn.click({ force: true });
        await page.waitForTimeout(500);
      }

      // Click the sandbox node to select it (ensures it's visible on canvas)
      const node = page.locator(`.svelte-flow__node[data-id="${sandboxNodeId}"]`);
      await expect(node).toBeVisible({ timeout: 30_000 });

      // Find and click the orange "Open" button inside the sandbox node
      const openBtn = node.locator('button.bg-orange-500');
      await expect(openBtn).toBeVisible({ timeout: 30_000 });
      await openBtn.click({ force: true });
    });

    // ── Step 4: Wait for sandbox preview to load and verify React app renders ──
    await test.step('Verify React app renders in sandbox preview', async () => {
      // Capture console messages for failure diagnostics
      const errors: string[] = [];
      const logs: string[] = [];
      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') errors.push(text);
        else logs.push(text);
      });
      page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`));

      // Wait for the iframe to appear in the floating panel
      const sandboxIframe = page.locator('iframe[sandbox]');
      await expect(sandboxIframe).toBeVisible({ timeout: 60_000 });

      // Note: the build runs before the iframe opens (warmup), so the module
      // script is served instantly from the L0 cache.
      const userIframe = page.frameLocator('iframe[sandbox]').frameLocator('iframe');
      const skipBtn = userIframe.locator('.welcome-skip');
      const creaturesTab = userIframe.locator('.paper-tab-btn').filter({ hasText: '👥' });

      await expect(skipBtn.or(creaturesTab).first()).toBeVisible({ timeout: 120_000 }).catch(async (e) => {
        const buildLogs = logs.filter(l =>
          l.includes('[BuildAwareVfs]') || l.includes('[BundlerService]') ||
          l.includes('[ESBuildEngine]') || l.includes('[SandboxPreviewView]') ||
          l.includes('[SandboxSW]')
        );
        const frames = page.frames().map(f => `  ${f.name() || '(unnamed)'}: ${f.url()}`).join('\n');
        const userFrame = page.frames().find(f =>
          f.name() === 'user-iframe' || (f.url().includes('index.html') && !f.url().includes('__sandbox'))
        );
        let userIframeDiag = 'N/A';
        if (userFrame) {
          try {
            userIframeDiag = await userFrame.evaluate(async () => {
              const root = document.getElementById('root');
              const perf = performance.getEntriesByType('resource').map((e: any) =>
                `${e.initiatorType} ${e.name.slice(0, 120)} ${e.duration.toFixed(0)}ms status=${e.responseStatus} size=${e.decodedBodySize}`
              );
              return JSON.stringify({
                rootHTML: root ? root.innerHTML.slice(0, 500) : 'NO ROOT',
                hasReactRoot: !!(root && Object.keys(root).some(k => k.startsWith('__react'))),
                readyState: document.readyState,
                swController: !!navigator.serviceWorker?.controller,
                failedResources: perf.filter(p => p.includes('status=0') || p.includes('size=0')).slice(0, 10),
              });
            });
          } catch (err) {
            userIframeDiag = `eval error: ${err}`;
          }
        }
        throw new Error(
          `Sandbox preview: React app did not render.\n` +
          `Frames:\n${frames}\n` +
          `Console errors (${errors.length}):\n${errors.slice(0, 20).join('\n')}\n` +
          `User iframe diag:\n${userIframeDiag}\n` +
          `Build/sandbox logs:\n${buildLogs.slice(0, 20).join('\n')}\n` +
          `All logs (last 30):\n${logs.slice(-30).join('\n')}\n` +
          `Original: ${(e as Error).message}`
        );
      });

      // If welcome page is showing, skip it
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await expect(creaturesTab).toBeVisible({ timeout: 30_000 });
      }
    });
  });
});
