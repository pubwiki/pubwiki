import { test, expect } from '../fixtures/test.js';
import type { Page } from '@playwright/test';
import { HubPage } from '../fixtures/pages/hub-page.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';
import { PlayerPage } from '../fixtures/pages/player-page.js';
import { packArtifact } from '../fixtures/pack-artifact.js';
import { getStudioUrl, getApiBaseUrl, getPlayerUrl } from '../fixtures/constants.js';
import path from 'node:path';

const BLOBS = path.resolve(import.meta.dirname, '../blobs');
const ARTIFACT_DIR = path.join(BLOBS, 'artifacts/artifact1');
const COVER_IMAGE = path.join(BLOBS, 'images/cover.jpg');

test.describe('Integration — Publish flow (Studio → Hub)', () => {
  // This test creates its own user, so start with a clean session
  test.use({ storageState: { cookies: [], origins: [] } });

  test('register → import → configure → build → publish → verify on Hub → play', async ({ page, context: _context }) => {
    test.setTimeout(300_000); // Multi-step integration test needs extended timeout
    
    const artifactZip = packArtifact(ARTIFACT_DIR);
    const timestamp = Date.now();
    const username = `e2e_publish_${timestamp}`;
    const email = `${username}@e2e-test.local`;
    const artifactName = `E2E Test Artifact ${timestamp}`;
    const artifactDesc = 'Automated e2e publish flow test';
    const creatureName = `E2E Creature ${timestamp}`;
    const publishedArtifactName = `Published World ${timestamp}`;
    let playerPageRef: Page;
    let publishedArtifactId: string;

    // ── Step 1: Register on Hub ──
    await test.step('Register a new account on Hub', async () => {
      const hub = new HubPage(page);
      await hub.register(username, email);
    });

    // ── Step 2: Open Studio and import project from ZIP ──
    let projectId: string;
    await test.step('Import project from ZIP in Studio', async () => {
      const studio = new StudioPage(page);
      await studio.goto();
      await studio.importFromFile(artifactZip);
      projectId = studio.getProjectId();
    });

    // ── Step 3: Configure project metadata ──
    await test.step('Configure project name, description, and cover', async () => {
      const studio = new StudioPage(page);
      await studio.configureProject({
        name: artifactName,
        description: artifactDesc,
        tags: 'e2e, test, automated',
        version: '1.0.0',
      });
      await studio.uploadCover(COVER_IMAGE);
    });

    // ── Step 4: Select entrypoint ──
    await test.step('Set entrypoint to Preview sandbox', async () => {
      const studio = new StudioPage(page);
      await studio.setEntrypoint('Sandbox');
    });

    // ── Step 5: Build ──
    await test.step('Build the project', async () => {
      const studio = new StudioPage(page);
      await studio.build();
    });

    // ── Step 6: Publish ──
    await test.step('Publish to Hub', async () => {
      const studio = new StudioPage(page);
      await studio.publish();
    });

    // ── Step 7: Verify the artifact on Hub ──
    await test.step('Verify artifact is visible on Hub', async () => {
      const hub = new HubPage(page);
      await hub.openArtifact(projectId!);

      // Verify the artifact name is displayed
      await expect(page.getByRole('heading', { name: artifactName })).toBeVisible({ timeout: 15_000 });
    });

    // ── Step 8: Play in Player ──
    await test.step('Open Player and verify it loads with build cache', async () => {
      const hub = new HubPage(page);
      const playerPage = await hub.clickPlay();

      const player = new PlayerPage(playerPage);
      await player.waitForReady();

      // Wait for the sandbox app to actually start running (produce console logs)
      await player.waitForAppLog();

      // Verify no error state
      expect(await player.hasError()).toBeFalsy();

      // Verify remote build cache (L2) was used, not local compilation (L3)
      player.assertBuildCacheUsed();

      // Close the player tab so it doesn't hold sandbox connections
      if (playerPage !== page) await playerPage.close();
    });

    // ── Step 9: Update metadata ──
    await test.step('Update project name and verify on Hub', async () => {
      // Navigate back to Studio
      const studio = new StudioPage(page);
      await studio.goto();
      // Navigate to the imported project (will be at /<projectId>)
      await page.goto(`${getStudioUrl()}/${projectId!}`);
      await expect(page.locator('.svelte-flow')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

      // Change the project name
      const updatedName = `${artifactName} (Updated)`;
      await studio.configureProject({ name: updatedName });
      await studio.update();

      // Go to Hub and verify the updated name
      const hub = new HubPage(page);
      await hub.openArtifact(projectId!);
      await expect(page.getByRole('heading', { name: updatedName })).toBeVisible({ timeout: 15_000 });
    });

    // ── Step 10: Patch — delete State node, verify Update disabled ──
    await test.step('Delete State node and verify Update is disabled', async () => {
      // Navigate back to Studio project
      const studio = new StudioPage(page);
      await page.goto(`${getStudioUrl()}/${projectId!}`);
      await expect(page.locator('.svelte-flow')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

      // Delete the existing State node
      const stateNodeId = '4feac849-bebc-409e-bd03-ffe47ba47c34';
      await studio.deleteNodeById(stateNodeId);

      // After deleting a node, the Update button should be disabled
      await studio.assertUpdateDisabled();
    });

    // ── Step 11: Re-add State node, reconnect, and update ──
    await test.step('Add new State node, reconnect, and update without rebuild', async () => {
      const studio = new StudioPage(page);
      const loaderNodeId = '01d047f7-0aa0-4231-867f-9ef65c221ad9';

      // Add a new State node via context menu
      const newStateId = await studio.addStateNode();

      // Connect the new State node's "default" output to the Loader's "loader-state" input
      await studio.connectNodes(newStateId, 'default', loaderNodeId, 'loader-state');

      // Verify build is still ready (STATE changes don't require rebuild)
      await studio.assertBuildReady();

      // Update should now be enabled and work without rebuilding
      await studio.update();
    });

    // ── Step 12: Edit VFS main.tsx to break compilation ──
    const frontendVfsNodeId = 'aca5a8b5-ad46-4fb2-912d-453417777bf8';
    await test.step('Edit main.tsx to introduce a syntax error', async () => {
      const studio = new StudioPage(page);

      // Open main.tsx in the VFS file editor via the sidebar
      await studio.openVfsFile(frontendVfsNodeId, '/src/main.tsx');

      // Replace content with broken code (invalid JSX)
      await studio.replaceEditorContent('THIS IS NOT VALID TYPESCRIPT {{{');

      // Save and close
      await studio.saveFileInEditor();
      await studio.closeEditor();
    });

    // ── Step 13: Verify build is stale, build fails, Update disabled ──
    await test.step('Verify build fails with syntax error and Update is disabled', async () => {
      const studio = new StudioPage(page);

      // Build should be required (cache doesn't match new content hash)
      await studio.assertNeedsBuild();

      // Trigger build — expect failure
      await studio.buildExpectFailure();

      // Update button should be disabled (build failed, no valid cache)
      await studio.assertUpdateDisabled();
    });

    // ── Step 14: Fix main.tsx, rebuild, and update ──
    await test.step('Fix main.tsx, rebuild successfully, and update', async () => {
      const studio = new StudioPage(page);

      // Re-open main.tsx and replace with EXACT original content (CRLF line endings, Chinese comment)
      await studio.openVfsFile(frontendVfsNodeId, '/src/main.tsx');
      await studio.replaceEditorContent(
        "import { StrictMode } from 'react'\r\n" +
        "import { createRoot } from 'react-dom/client'\r\n" +
        "import App from './App'\r\n" +
        "import { AlertDialogProvider } from './components/AlertDialog'\r\n" +
        "import { ToastProvider } from './components/Toast'\r\n" +
        "import './i18n' // 初始化 i18n\r\n" +
        "import './index.css'\r\n" +
        "\r\n" +
        "createRoot(document.getElementById('root')!).render(\r\n" +
        "  <StrictMode>\r\n" +
        "    <AlertDialogProvider>\r\n" +
        "      <ToastProvider>\r\n" +
        "        <App />\r\n" +
        "      </ToastProvider>\r\n" +
        "    </AlertDialogProvider>\r\n" +
        "  </StrictMode>,\r\n" +
        ")\r\n"
      );
      await studio.saveFileInEditor();
      await studio.closeEditor();

      // Build needed (VFS content hash differs from previous build cache)
      await studio.assertNeedsBuild();

      // Rebuild — should succeed with valid code
      await studio.build();

      // Update should be enabled (VFS content changed from published version)
      await studio.update();
    });

    // ── Step 15: Edit App.tsx with a non-breaking comment change ──
    await test.step('Add a comment to App.tsx (build dependency, non-breaking change)', async () => {
      const studio = new StudioPage(page);

      // Open App.tsx
      await studio.openVfsFile(frontendVfsNodeId, '/src/App.tsx');

      // Prepend a comment via keyboard — insertText bypasses auto-indentation
      const editorPanel = page.locator('.fixed.top-4.right-4.bottom-4.z-30');
      const monacoEditor = editorPanel.locator('.monaco-editor').first();
      await expect(monacoEditor).toBeVisible({ timeout: 10_000 });
      await monacoEditor.click();

      // Go to beginning of file and add a comment line
      await page.keyboard.press('Control+Home');
      await page.waitForTimeout(100);
      await page.keyboard.insertText('// E2E test comment\r\n');

      // Save and close
      await studio.saveFileInEditor();
      await studio.closeEditor();
    });

    // ── Step 16: Rebuild succeeds, Update succeeds ──
    await test.step('Rebuild after App.tsx change, verify Update succeeds', async () => {
      const studio = new StudioPage(page);

      // Build should be required (VFS content changed from cached build)
      await studio.assertNeedsBuild();

      // Rebuild — should succeed since we only added a comment
      await studio.build();

      // Update should now be enabled (VFS content changed from published version)
      await studio.update();
    });

    // ── Step 17: Verify player loads with updated build ──
    await test.step('Verify player loads with new build cache', async () => {
      // Navigate to Hub artifact page
      const hub = new HubPage(page);
      await hub.openArtifact(projectId!);

      // Open player
      playerPageRef = await hub.clickPlay();
      const player = new PlayerPage(playerPageRef);
      await player.waitForReady();

      // Verify no error
      expect(await player.hasError()).toBeFalsy();

      // Verify remote build cache (L2) was used, not local compilation (L3)
      player.assertBuildCacheUsed();
    });

    // ── Step 18: World editing — add a creature in Player ──
    await test.step('Add a creature in the player world editor', async () => {
      // The sandbox uses nested iframes: player → __sandbox.html → index.html (React app)
      const sandboxApp = playerPageRef.frameLocator('iframe').frameLocator('iframe');

      const skipBtn = sandboxApp.locator('.welcome-skip');
      const creaturesTab = sandboxApp.locator('.paper-tab-btn').filter({ hasText: '👥' });

      // Wait for the sandbox React app to render (either welcome page or editor tabs)
      await expect(skipBtn.or(creaturesTab).first()).toBeVisible({ timeout: 60_000 });

      // If the welcome page is showing, skip it
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await expect(creaturesTab).toBeVisible({ timeout: 30_000 });
      }

      await creaturesTab.click();

      // Click "Add NPC" — the second .paper-btn-add button
      const addButtons = sandboxApp.locator('.paper-btn-add');
      await expect(addButtons.first()).toBeVisible({ timeout: 5_000 });
      await addButtons.last().click();

      // A new creature card should appear
      await expect(sandboxApp.locator('.paper-entity-card')).toBeVisible({ timeout: 5_000 });

      // Update the creature name in the detail editor
      const nameInput = sandboxApp.locator('.paper-creature-basic input[type="text"]').first();
      await expect(nameInput).toBeVisible({ timeout: 5_000 });
      await nameInput.click({ clickCount: 3 }); // Select all text
      await nameInput.fill(creatureName);

      // Save state to game via Ctrl+S (explicit save required — React state doesn't auto-sync to RDF store)
      await nameInput.press('Control+s');
      // Wait for the success toast to confirm the state was written to the RDF store
      await expect(sandboxApp.locator('.toast.toast-success')).toBeVisible({ timeout: 10_000 });

      await playerPageRef.waitForTimeout(1000);
    });

    // ── Step 19: Publish from within the Player ──
    await test.step('Publish artifact from within the player', async () => {
      const sandboxApp = playerPageRef.frameLocator('iframe').frameLocator('iframe');

      // Listen for the POST /api/artifacts response BEFORE triggering publish
      const responsePromise = playerPageRef.waitForResponse(
        resp => resp.url().includes('/api/artifacts') && resp.request().method() === 'POST' && resp.status() < 400,
        { timeout: 60_000 }
      );

      // Click the "📦 App" dropdown in the iframe toolbar
      await sandboxApp.locator('.btn-toolbar').filter({ hasText: '📦' }).click();
      await sandboxApp.locator('.dropdown-content button').filter({ hasText: '🚀' }).click();

      // The confirmation dialog appears on the PLAYER page (outside the iframe, portaled to body)
      const dialog = playerPageRef.locator('[role="dialog"][aria-modal="true"]');
      await expect(dialog).toBeVisible({ timeout: 30_000 });

      // Fill in the artifact name (required field)
      const nameInput = dialog.locator('input[type="text"]').first();
      await nameInput.fill(publishedArtifactName);

      // Click the "Confirm" button (blue button)
      await dialog.locator('button.bg-blue-500').click();

      // Wait for the POST /artifacts API call to complete
      const response = await responsePromise;
      const body = await response.json();
      publishedArtifactId = body.artifact?.id;
      expect(publishedArtifactId).toBeTruthy();

      // Wait for the dialog to disappear
      await expect(dialog).not.toBeVisible({ timeout: 15_000 });

      // Close the player page
      if (playerPageRef !== page) await playerPageRef.close();
    });

    // ── Step 20: Verify the published artifact on Hub ──
    await test.step('Verify published artifact exists on Hub and has inherited build cache key', async () => {
      const hub = new HubPage(page);
      await hub.openArtifact(publishedArtifactId);

      await expect(page.getByRole('heading', { name: publishedArtifactName })).toBeVisible({ timeout: 15_000 });

      // Verify via API that the player-published artifact inherited the parent's buildCacheKey.
      // Without this, the player would fall back to slow L3 local compilation.
      const graphResp = await page.request.get(
        `${getApiBaseUrl()}/artifacts/${publishedArtifactId}/graph?version=latest`
      );
      expect(graphResp.ok()).toBeTruthy();
      const graphData = await graphResp.json();
      expect(graphData.version?.buildCacheKey,
        'Player-published artifact must have buildCacheKey inherited from parent'
      ).toBeTruthy();
    });

    // ── Step 21: Play the published artifact and verify the creature exists ──
    await test.step('Play published artifact and verify creature in world state', async () => {
      const hub = new HubPage(page);

      // Clear the player-origin OPFS to eliminate cached L1 build data from Steps
      // 14–19. BuildAwareVfs runs in the player page (playerPort origin), not in the
      // sandbox SW, so we must wipe the player's OPFS (not the sandbox's).
      // This forces Step 21's player to fetch the build from R2 (L2), verifying
      // that the player-published artifact's inherited buildCacheKey is in R2.
      const clearPage = await page.context().newPage();
      try {
        await clearPage.goto(`${getPlayerUrl()}/`, { waitUntil: 'commit' });
        await clearPage.evaluate(async () => {
          try {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry('__build_cache__', { recursive: true });
          } catch { /* directory may not exist */ }
        });
      } finally {
        await clearPage.close();
      }

      const newPlayerPage = await hub.clickPlay();

      const player = new PlayerPage(newPlayerPage);
      await player.waitForReady();
      await player.waitForAppLog();
      expect(await player.hasError()).toBeFalsy();

      // Verify the remote build cache (L2) is used — not local recompilation (L3).
      // This confirms the player-published artifact's inherited buildCacheKey is valid.
      // OPFS was cleared above, so only R2 (L2) can produce a cache hit.
      player.assertRemoteBuildCacheUsed();

      const sandboxApp = newPlayerPage.frameLocator('iframe').frameLocator('iframe');

      // Skip welcome page if shown
      const skipBtn = sandboxApp.locator('.welcome-skip');
      const creaturesTab = sandboxApp.locator('.paper-tab-btn').filter({ hasText: '👥' });
      await expect(skipBtn.or(creaturesTab).first()).toBeVisible({ timeout: 60_000 });
      if (await skipBtn.isVisible().catch(() => false)) {
        await skipBtn.click();
        await expect(creaturesTab).toBeVisible({ timeout: 30_000 });
      }
      await creaturesTab.click();

      // Verify the creature we added exists (by name in the entity card)
      await expect(
        sandboxApp.locator('.paper-entity-card').filter({ hasText: creatureName })
      ).toBeVisible({ timeout: 30_000 });
    });
  });
});
