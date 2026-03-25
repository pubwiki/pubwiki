import { test, expect } from '../fixtures/test.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';

test.describe('Studio — VFS mount mirroring', () => {
  test('mount VFS 1 into VFS 2 subfolder mirrors file operations bidirectionally', async ({ page }) => {
    test.setTimeout(120_000);
    const studio = new StudioPage(page);
    await studio.goto();
    await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

    // ── Step 1: Create two VFS nodes ──
    const vfs1Id = await studio.addNodeViaContextMenu('VFS');
    await page.keyboard.press('Escape');

    // Fit view between creations to avoid position collision
    await page.locator('button[title="Fit View"]').click();
    await page.waitForTimeout(500);

    const vfs2Id = await studio.addNodeViaContextMenu('VFS', { x: 800, y: 100 });
    await page.keyboard.press('Escape');

    // Fit view and expand sidebar
    await page.locator('button[title="Fit View"]').click();
    await page.waitForTimeout(500);

    // Sidebar panel locator
    const sidebar = page.locator('.absolute.top-4.left-4.bottom-4.z-20');

    // Helper: select a node by collapsing sidebar (so node is clickable),
    // clicking it, then expanding sidebar via DOM click (to avoid mousedown
    // on the canvas pane which would deselect the node).
    async function selectVfsNode(nodeId: string) {
      const shortId = nodeId.substring(0, 8);

      // Collapse sidebar so canvas nodes are fully accessible
      await studio.collapseSidebar();

      // Click the node on the canvas — real mouse click triggers xyflow selection
      const node = page.locator(`.svelte-flow__node[data-id="${nodeId}"]`);
      await expect(node).toBeVisible({ timeout: 10_000 });
      await node.click();
      await expect(node).toHaveClass(/selected/, { timeout: 5_000 });

      // Expand sidebar using DOM click (not Playwright mouse click) to avoid
      // the mouse event propagating to the canvas and deselecting the node.
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLElement>('button[title="Expand panel"]');
        btn?.click();
      });
      await page.waitForTimeout(500);

      // Switch to Properties tab
      await sidebar.locator('button', { hasText: 'Properties' }).click();
      await page.waitForTimeout(300);

      // Verify the sidebar shows this node's properties
      await expect(sidebar.getByText(shortId)).toBeVisible({ timeout: 10_000 });
      await expect(sidebar.locator('button[title="New file"]')).toBeVisible({ timeout: 10_000 });
    }

    // Helper: create a folder via the sidebar quick action button
    async function createFolder(nodeId: string, folderName: string) {
      await selectVfsNode(nodeId);
      await sidebar.locator('button[title="New folder"]').click();
      const input = sidebar.locator('input[placeholder="folder name"]');
      await expect(input).toBeFocused({ timeout: 5_000 });
      await page.keyboard.type(folderName);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }

    // Helper: create a file via the sidebar quick action button
    async function createFile(nodeId: string, fileName: string) {
      await selectVfsNode(nodeId);
      await sidebar.locator('button[title="New file"]').click();
      const input = sidebar.locator('input[placeholder="file name"]');
      await expect(input).toBeFocused({ timeout: 5_000 });
      await page.keyboard.type(fileName);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }

    // Helper: expand parent folders in the sidebar so a nested item is visible
    async function expandParents(itemPath: string) {
      const parts = itemPath.split('/').filter(Boolean);
      for (let i = 0; i < parts.length - 1; i++) {
        const folderPath = '/' + parts.slice(0, i + 1).join('/');
        const folder = sidebar.locator(`[data-path="${folderPath}"]`);
        if (await folder.isVisible({ timeout: 2_000 }).catch(() => false)) {
          const childPath = '/' + parts.slice(0, i + 2).join('/');
          const child = sidebar.locator(`[data-path="${childPath}"]`);
          if (!await child.isVisible({ timeout: 500 }).catch(() => false)) {
            await folder.click();
            await page.waitForTimeout(300);
          }
        }
      }
    }

    // Helper: assert a path exists in the sidebar file tree of a VFS node
    async function assertPathExists(nodeId: string, itemPath: string) {
      await selectVfsNode(nodeId);
      await expandParents(itemPath);
      await expect(sidebar.locator(`[data-path="${itemPath}"]`)).toBeVisible({ timeout: 10_000 });
    }

    // Helper: assert a path does NOT exist in the sidebar file tree
    async function assertPathNotExists(nodeId: string, itemPath: string) {
      await selectVfsNode(nodeId);
      await expandParents(itemPath);
      await page.waitForTimeout(500);
      await expect(sidebar.locator(`[data-path="${itemPath}"]`)).not.toBeVisible({ timeout: 5_000 });
    }

    // Helper: move a file to a folder via Playwright's native drag-and-drop in the sidebar
    async function moveItem(nodeId: string, sourcePath: string, targetFolderPath: string) {
      await selectVfsNode(nodeId);
      const srcItem = sidebar.locator(`[data-path="${sourcePath}"]`);
      const tgtItem = sidebar.locator(`[data-path="${targetFolderPath}"]`);
      await expect(srcItem).toBeVisible({ timeout: 5_000 });
      await expect(tgtItem).toBeVisible({ timeout: 5_000 });
      await srcItem.dragTo(tgtItem);
      await page.waitForTimeout(1000);
    }

    // Helper: delete an item via right-click context menu in the sidebar
    async function deleteItem(nodeId: string, itemPath: string) {
      await selectVfsNode(nodeId);
      await expandParents(itemPath);

      const item = sidebar.locator(`[data-path="${itemPath}"]`);
      await expect(item).toBeVisible({ timeout: 5_000 });

      // FileTree's handleDelete calls window.confirm() — accept it
      page.once('dialog', dialog => dialog.accept());

      await item.click({ button: 'right' });
      const ctxMenu = page.locator('.fixed.bg-white.rounded-lg.shadow-lg.border.border-gray-200');
      const deleteBtn = ctxMenu.locator('button', { hasText: 'Delete' });
      await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
      await deleteBtn.click();
      await page.waitForTimeout(500);
    }

    // ── Step 2: Create mount-target folder in VFS 2 ──
    await createFolder(vfs2Id, 'mount-target');
    await assertPathExists(vfs2Id, '/mount-target');

    // ── Step 3: Mount VFS 1 → VFS 2 /mount-target ──
    await studio.mountVfsToVfs(vfs1Id, vfs2Id, '/mount-target');
    // Wait for mount to settle
    await page.waitForTimeout(1000);

    // ── Step 4: Create folder in VFS 1, verify mirrored in VFS 2 ──
    await createFolder(vfs1Id, 'test-folder');
    await assertPathExists(vfs1Id, '/test-folder');
    await assertPathExists(vfs2Id, '/mount-target/test-folder');

    // ── Step 5: Create file in VFS 1, verify mirrored in VFS 2 ──
    await createFile(vfs1Id, 'test-file.txt');
    await assertPathExists(vfs1Id, '/test-file.txt');
    await assertPathExists(vfs2Id, '/mount-target/test-file.txt');

    // ── Step 6: Move file into folder in VFS 1, verify in VFS 2 ──
    await moveItem(vfs1Id, '/test-file.txt', '/test-folder');
    await assertPathExists(vfs1Id, '/test-folder/test-file.txt');
    await assertPathNotExists(vfs1Id, '/test-file.txt');
    await assertPathExists(vfs2Id, '/mount-target/test-folder/test-file.txt');
    await assertPathNotExists(vfs2Id, '/mount-target/test-file.txt');

    // ── Step 7: Delete file from VFS 2, verify deleted in VFS 1 ──
    await deleteItem(vfs2Id, '/mount-target/test-folder/test-file.txt');
    await assertPathNotExists(vfs2Id, '/mount-target/test-folder/test-file.txt');
    await assertPathNotExists(vfs1Id, '/test-folder/test-file.txt');
  });
});
