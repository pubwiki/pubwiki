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
      // Capture console messages for diagnostics
      const errors: string[] = [];
      const logs: string[] = [];
      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error') errors.push(text);
        else logs.push(text);
      });
      page.on('pageerror', err => errors.push(`PAGE_ERROR: ${err.message}`));
      // Track ALL network requests to/from the sandbox iframe
      const networkRequests: string[] = [];
      page.on('response', resp => {
        const url = resp.url();
        if (url.includes('sandbox') || url.includes('__sandbox') || resp.status() >= 400) {
          networkRequests.push(`${resp.status()} ${resp.request().method()} ${url}`);
        }
      });
      page.on('requestfailed', req => {
        networkRequests.push(`FAILED ${req.method()} ${req.url()} ${req.failure()?.errorText}`);
      });

      // Wait for the iframe to appear in the floating panel
      const sandboxIframe = page.locator('iframe[sandbox]');
      await expect(sandboxIframe).toBeVisible({ timeout: 60_000 });

      // Wait for the sandbox to initialize (give it time to register the service worker
      // and set up the RPC channel)
      await page.waitForTimeout(10_000);

      // Check all page frames to understand the iframe nesting
      const allFrames = page.frames();
      const frameInfo = allFrames.map(f => `  ${f.name() || '(unnamed)'}: ${f.url()}`).join('\n');
      console.log(`Frames after 10s wait:\n${frameInfo}`);
      console.log(`Network requests:\n${networkRequests.slice(0, 30).join('\n')}`);
      console.log(`Console errors:\n${errors.slice(0, 20).join('\n')}`);
      console.log(`Console logs (last 30):\n${logs.slice(-30).join('\n')}`);

      // Now check the nested iframe for the React app
      const userIframe = page.frameLocator('iframe[sandbox]').frameLocator('iframe');
      
      // Try to find the React app UI elements
      const skipBtn = userIframe.locator('.welcome-skip');
      const creaturesTab = userIframe.locator('.paper-tab-btn').filter({ hasText: '👥' });

      try {
        await expect(skipBtn.or(creaturesTab).first()).toBeVisible({ timeout: 120_000 });
        console.log('SUCCESS: React app rendered correctly in sandbox preview (local build)');
        
        // Analyze the bundle content for comparison with published version
        const userFrame = page.frames().find(f => f.name() === 'user-iframe');
        if (userFrame) {
          const bundleAnalysis = await userFrame.evaluate(async () => {
            try {
              const resp = await fetch('/src/main.tsx');
              const text = await resp.text();
              
              // Find CustomGame2 and its surrounding context
              const cg2Idx = text.indexOf('var CustomGame2 = ');
              const cg2Context = cg2Idx >= 0 
                ? text.slice(Math.max(0, cg2Idx - 200), cg2Idx + 200)
                : 'var CustomGame2 NOT FOUND';
              
              // Find how lazy is bound — look for "lazy" as a standalone identifier near usage
              const lazyUsageIdx = text.indexOf('lazy(');
              const lazyContext = lazyUsageIdx >= 0
                ? text.slice(Math.max(0, lazyUsageIdx - 500), lazyUsageIdx + 100)
                : 'lazy( NOT FOUND';
              
              // Find if there's a "var lazy" or "lazy =" somewhere
              const varLazyMatch = text.match(/var\s+([^;]{0,200}?\blazy\b[^;]{0,200}?);/);
              const varLazy = varLazyMatch ? `@${varLazyMatch.index}: ${varLazyMatch[0].slice(0, 400)}` : 'NO var lazy FOUND';
              
              // Check for "lazy:" in export definitions
              const lazyExportMatch = text.match(/lazy:\s*\(\)\s*=>\s*(\w+)/);
              const lazyExport = lazyExportMatch ? `lazy => ${lazyExportMatch[1]}` : 'NO lazy export';
              
              return `[${text.length} bytes]\nCustomGame2: ${cg2Context}\nLazy context: ${lazyContext}\nVar lazy: ${varLazy}\nLazy export: ${lazyExport}`;
            } catch (e) {
              return `fetch error: ${e}`;
            }
          });
          console.log(`BUNDLE ANALYSIS (local build):\n${bundleAnalysis}`);
        }
      } catch (e) {
        // Gather diagnostics
        const finalFrames = page.frames();
        const finalFrameInfo = finalFrames.map(f => `  ${f.name() || '(unnamed)'}: ${f.url()}`).join('\n');
        
        // Try to get bundle content from the sandbox service worker
        let bundleInfo = 'COULD_NOT_GET';
        try {
          const innerFrame = finalFrames.find(f => f.url().includes('index.html') || f.name() === 'user-iframe');
          if (innerFrame) {
            bundleInfo = await innerFrame.evaluate(async () => {
              try {
                const resp = await fetch('/src/main.tsx');
                const text = await resp.text();
                const cgIdx = text.indexOf('CustomGame2');
                const cgContext = cgIdx >= 0 
                  ? text.slice(Math.max(0, cgIdx - 500), cgIdx + 500)
                  : 'CustomGame2 NOT FOUND';
                
                const lazyMatch = text.match(/var\s+(?:[^;]*?\blazy\b[^;]*?);/);
                const lazyDecl = lazyMatch ? lazyMatch[0].slice(0, 300) : 'NO var lazy FOUND';
                
                return `[${text.length} bytes]\nCustomGame2 context: ${cgContext}\nLazy decl: ${lazyDecl}`;
              } catch (e) {
                return `fetch error: ${e}`;
              }
            });
          }
        } catch { /* ignore */ }

        // Get BuildAwareVfs logs
        const buildLogs = logs.filter(l => l.includes('[BuildAwareVfs]') || l.includes('[BundlerService]') || l.includes('[ESBuildEngine]') || l.includes('[SandboxPreviewView]') || l.includes('sandbox'));
        
        throw new Error(
          `Sandbox preview: React app did not render.\n` +
          `Frames:\n${finalFrameInfo}\n` +
          `Console errors (${errors.length}):\n${errors.slice(0, 30).join('\n')}\n` +
          `Build/sandbox logs:\n${buildLogs.slice(0, 30).join('\n')}\n` +
          `Network requests:\n${networkRequests.slice(0, 30).join('\n')}\n` +
          `Bundle info:\n${bundleInfo}\n` +
          `All logs (last 50):\n${logs.slice(-50).join('\n')}\n` +
          `Original: ${(e as Error).message}`
        );
      }

      // If welcome page is showing, skip it
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await expect(creaturesTab).toBeVisible({ timeout: 30_000 });
      }

      console.log('Sandbox preview test PASSED: React app renders correctly via local build');
    });
  });
});
