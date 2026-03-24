import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { getStudioUrl } from '../constants.js';

export class StudioPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait until the page URL stops changing and the flow canvas is visible.
   * Guards against mid-test SvelteKit navigations triggered by $effects.
   */
  private async waitForStableUrl(timeout = 15_000) {
    const deadline = Date.now() + timeout;
    let previousUrl = this.page.url();
    // Poll until the URL is unchanged for 500ms
    while (Date.now() < deadline) {
      await this.page.waitForTimeout(500);
      const currentUrl = this.page.url();
      if (currentUrl === previousUrl) break;
      previousUrl = currentUrl;
      await this.page.waitForLoadState('load');
    }
    await expect(this.page.locator('.svelte-flow')).toBeVisible({ timeout: 30_000 });
  }

  /** Navigate to Studio root — redirects to a new project */
  async goto() {
    await this.page.goto(getStudioUrl());
    await expect(this.page.locator('.svelte-flow')).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Import a project from a local ZIP file via the hamburger menu.
   * Returns the new project URL path (e.g. "/<projectId>").
   */
  async importFromFile(filePath: string): Promise<string> {
    // Open hamburger menu
    const hamburger = this.page.locator('button[title]', {
      has: this.page.locator('svg path[d*="M4 6h16M4 12h16M4 18h16"]'),
    });
    await hamburger.click();

    // Set up file chooser handler BEFORE clicking Import
    const fileChooserPromise = this.page.waitForEvent('filechooser');

    // Click Import menu item
    const importBtn = this.page.locator('button', { hasText: 'Import' });
    await importBtn.click();

    const fileChooser = await fileChooserPromise;

    // Record URL before import — we need to wait for a DIFFERENT UUID after
    // the import completes, since we may already be on a UUID-based URL.
    const urlBeforeImport = this.page.url();
    await fileChooser.setFiles(filePath);

    // Import processes the ZIP (async), then does window.location.href = /<newProjectId>
    // Wait for the URL to change to a DIFFERENT path than the current one.
    await this.page.waitForURL((url) => {
      const path = new URL(url).pathname;
      const prevPath = new URL(urlBeforeImport).pathname;
      return /^\/[a-f0-9-]{36}$/.test(path) && path !== prevPath;
    }, { timeout: 60_000 });
    await this.page.waitForLoadState('load');

    // Wait for the graph canvas and nodes to load (ensures IndexedDB stores are ready)
    await expect(this.page.locator('.svelte-flow')).toBeVisible({ timeout: 30_000 });
    await expect(this.page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

    // Wait for any further cascading navigations to settle
    await this.waitForStableUrl();

    return new URL(this.page.url()).pathname;
  }

  /** Collapse the sidebar if it's open, freeing the canvas for graph operations. */
  async collapseSidebar() {
    const collapseBtn = this.page.locator('button[title="Collapse panel"]');
    if (await collapseBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await collapseBtn.click();
      // Wait for the sidebar to collapse (badge appears)
      await expect(this.page.locator('button[title="Expand panel"]')).toBeVisible({ timeout: 5_000 });
    }
  }

  /** Expand the sidebar if it's collapsed. */
  async expandSidebar() {
    const expandBtn = this.page.locator('button[title="Expand panel"]');
    if (await expandBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await expandBtn.click();
      await expect(this.page.locator('button[title="Collapse panel"]')).toBeVisible({ timeout: 5_000 });
    }
  }

  /** Ensure the Project tab is active and #project-form is visible. */
  async ensureProjectTab() {
    // Wait for any pending navigations to settle first
    await this.waitForStableUrl();

    // If sidebar is collapsed, expand it first
    await this.expandSidebar();

    const form = this.page.locator('#project-form');
    if (await form.isVisible()) return;

    const projectButton = this.page.getByRole('button', { name: 'Project', exact: true });
    await expect(projectButton).toBeVisible({ timeout: 30_000 });

    // Use force click — Svelte 5 event delegation + sidebar's onpointerdown
    // stopPropagation() interferes with normal Playwright clicks
    await projectButton.click({ force: true });
    await expect(form).toBeVisible({ timeout: 30_000 });
  }

  /** Fill in project metadata fields */
  async configureProject(opts: {
    name?: string;
    description?: string;
    tags?: string;
    version?: string;
  }) {
    await this.ensureProjectTab();

    if (opts.name !== undefined) {
      const nameInput = this.page.locator('#artifact-edit-name');
      // Wait for server data to populate the field before overwriting
      await expect(nameInput).not.toHaveValue('', { timeout: 15_000 });
      await nameInput.clear();
      await nameInput.fill(opts.name);
    }
    if (opts.description !== undefined) {
      const descInput = this.page.locator('#artifact-edit-description');
      await descInput.clear();
      await descInput.fill(opts.description);
    }
    if (opts.tags !== undefined) {
      const tagsInput = this.page.locator('#artifact-edit-tags');
      await tagsInput.clear();
      await tagsInput.fill(opts.tags);
    }
    if (opts.version !== undefined) {
      const versionInput = this.page.locator('#version');
      await versionInput.clear();
      await versionInput.fill(opts.version);
    }
  }

  /** Upload a cover/thumbnail image */
  async uploadCover(imagePath: string) {
    await this.ensureProjectTab();
    const fileInput = this.page.locator('#project-form input[type="file"][accept*="image"]');
    await fileInput.setInputFiles(imagePath);
  }

  /**
   * Select an entrypoint sandbox by label from the Entrypoint dropdown.
   * The dropdown is within the EntrypointSection component inside #project-form.
   */
  async setEntrypoint(sandboxLabel: string) {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');

    // The EntrypointSection has a label "Entrypoint"
    const entrypointLabel = form.getByText('Entrypoint', { exact: true });
    await expect(entrypointLabel).toBeVisible({ timeout: 15_000 });

    // The Dropdown trigger is inside the EntrypointSection's rounded border container.
    const section = form.locator('div.rounded-lg.border').filter({
      has: this.page.getByText('Entrypoint', { exact: true }),
    });
    const dropdownTrigger = section.locator('button[type="button"]').first();
    await expect(dropdownTrigger).toBeVisible({ timeout: 15_000 });
    await dropdownTrigger.scrollIntoViewIfNeeded();

    // Open the dropdown via click
    await dropdownTrigger.click();

    // The dropdown panel is position:absolute inside overflow-y-auto, so options
    // may be clipped and not visually "visible". Use keyboard to navigate instead.
    // First verify the panel rendered (items exist in DOM even if clipped).
    const panel = section.locator('.absolute.z-10');
    await expect(panel).toBeAttached({ timeout: 5_000 });

    // Find which option index matches the sandbox label
    const optionButtons = panel.locator('button[type="button"]');
    const count = await optionButtons.count();
    let targetIndex = -1;
    for (let i = 0; i < count; i++) {
      const text = await optionButtons.nth(i).textContent();
      if (text?.trim().includes(sandboxLabel)) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      // Dump available options for debugging
      const allTexts = await optionButtons.allTextContents();
      throw new Error(`Sandbox "${sandboxLabel}" not found in dropdown. Available: ${JSON.stringify(allTexts)}`);
    }

    // Click the dropdown default opens with highlighted index at current selection (index 0).
    // Navigate to the target option using ArrowDown and select with Enter.
    // Close and reopen with keyboard for consistent state.
    await dropdownTrigger.press('Escape');
    await dropdownTrigger.press('Enter'); // opens with highlightedIndex = current (0)
    for (let i = 0; i < targetIndex; i++) {
      await dropdownTrigger.press('ArrowDown');
    }
    await dropdownTrigger.press('Enter'); // select
  }

  /** Click the "Build" button and wait for build to complete */
  async build() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');

    // The build button is inside EntrypointSection; may say "Build", "Rebuild", or "Retry"
    const buildBtn = form.locator('button', { hasText: /^Build$|^Rebuild$|^Retry$/ });
    await expect(buildBtn).toBeVisible({ timeout: 10_000 });
    await buildBtn.click({ force: true });

    // Wait for "Building..." state
    await expect(form.locator('text=Building...')).toBeVisible({ timeout: 10_000 });

    // Wait for build to complete — "Build ready" appears
    await expect(form.locator('text=Build ready')).toBeVisible({ timeout: 120_000 });
  }

  /** Click Publish and wait for success */
  async publish() {
    await this.ensureProjectTab();
    const publishBtn = this.page.locator('#project-form button[type="submit"]');
    await expect(publishBtn).toBeEnabled({ timeout: 10_000 });
    await publishBtn.click({ force: true });

    // Wait for success message
    await expect(this.page.locator('text=Published successfully')).toBeVisible({ timeout: 30_000 });
  }

  /** Click Update and wait for success (same button as Publish, shown after first publish) */
  async update() {
    await this.ensureProjectTab();
    const updateBtn = this.page.locator('#project-form button[type="submit"]');
    await expect(updateBtn).toBeEnabled({ timeout: 30_000 });
    await updateBtn.click({ force: true });

    // Wait for success message
    await expect(this.page.locator('text=Updated successfully')).toBeVisible({ timeout: 30_000 });
  }

  /** Assert the Update/Publish submit button is disabled */
  async assertUpdateDisabled() {
    await this.ensureProjectTab();
    const updateBtn = this.page.locator('#project-form button[type="submit"]');
    await expect(updateBtn).toBeDisabled({ timeout: 10_000 });
  }

  /** Assert build is still ready (not stale) */
  async assertBuildReady() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');
    await expect(form.locator('text=Build ready')).toBeVisible({ timeout: 10_000 });
    // Ensure no stale or rebuild indicators
    await expect(form.locator('text=Build stale')).not.toBeVisible();
    await expect(form.locator('button', { hasText: /^Rebuild$/ })).not.toBeVisible();
  }

  /**
   * Delete a node by its data-id. Clicks the node to select it, then presses Delete.
   * STATE nodes are deleted immediately (no confirmation dialog).
   */
  async deleteNodeById(nodeId: string) {
    // Collapse sidebar first to avoid overlapping the node
    await this.collapseSidebar();

    const node = this.page.locator(`.svelte-flow__node[data-id="${nodeId}"]`);
    await expect(node).toBeVisible({ timeout: 10_000 });

    // In Firefox, overlapping nodes (e.g. VFS file tree) intercept pointer events on the canvas.
    // Dispatch pointer/mouse events directly on the DOM element so SvelteFlow registers the selection
    // regardless of what's visually on top.
    await node.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const init = { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, clientX: cx, clientY: cy };
      el.dispatchEvent(new PointerEvent('pointerover', init));
      el.dispatchEvent(new PointerEvent('pointerenter', { ...init, bubbles: false }));
      el.dispatchEvent(new PointerEvent('pointerdown', init));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent('pointerup', init));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    });

    // Verify node got the "selected" class before pressing Delete
    await expect(node).toHaveClass(/selected/, { timeout: 5_000 });
    await this.page.keyboard.press('Delete');
    // Wait for the node to be removed from DOM
    await expect(node).not.toBeAttached({ timeout: 10_000 });
  }

  /**
   * Add a State node via right-click context menu on the canvas.
   * Returns the data-id of the newly created node.
   */
  async addStateNode(): Promise<string> {
    // Collect existing node IDs before adding
    const existingIds = new Set<string>();
    const existingNodes = this.page.locator('.svelte-flow__node');
    const count = await existingNodes.count();
    for (let i = 0; i < count; i++) {
      const id = await existingNodes.nth(i).getAttribute('data-id');
      if (id) existingIds.add(id);
    }

    // Collapse the sidebar so it doesn't block the canvas
    await this.collapseSidebar();
    await this.page.waitForTimeout(500);

    // Zoom out so the nodes are small and there's plenty of empty canvas
    const zoomOut = this.page.locator('button[title="Zoom Out"], button:has-text("Zoom Out")').first();
    await expect(zoomOut).toBeVisible({ timeout: 5_000 });
    for (let i = 0; i < 5; i++) {
      await zoomOut.click({ force: true });
      await this.page.waitForTimeout(100);
    }

    // Right-click on the canvas pane — use the upper-left area
    // which should be empty after zooming out, giving room for
    // the context menu and submenu to render within viewport
    const pane = this.page.locator('.svelte-flow__pane');
    const box = await pane.boundingBox();
    if (!box) throw new Error('Canvas not visible');
    await pane.click({ button: 'right', position: { x: box.width * 0.3, y: box.height * 0.3 } });

    // Hover "Add Node" to open submenu
    const addNodeBtn = this.page.locator('button', { hasText: 'Add Node' });
    await expect(addNodeBtn).toBeVisible({ timeout: 5_000 });
    await addNodeBtn.hover();

    // Click "State" in the submenu
    const stateBtn = this.page.locator('button', { hasText: 'State' }).last();
    await expect(stateBtn).toBeVisible({ timeout: 5_000 });
    await stateBtn.click();

    // Wait for a new node to appear in DOM
    await expect(this.page.locator('.svelte-flow__node')).toHaveCount(count + 1, { timeout: 10_000 });

    // Find the new node ID
    const allNodes = this.page.locator('.svelte-flow__node');
    const newCount = await allNodes.count();
    for (let i = 0; i < newCount; i++) {
      const id = await allNodes.nth(i).getAttribute('data-id');
      if (id && !existingIds.has(id)) {
        // Press Escape to dismiss the auto-focus name editing
        await this.page.keyboard.press('Escape');
        return id;
      }
    }
    throw new Error('Could not find newly created State node');
  }

  /**
   * Connect two nodes by dragging from a source handle to a target handle.
   * Uses fitView first to ensure all nodes are visible, then performs the drag.
   */
  async connectNodes(
    sourceNodeId: string,
    sourceHandleId: string,
    targetNodeId: string,
    targetHandleId: string,
  ) {
    // Fit view so all nodes (including the newly added one) are visible
    const fitViewBtn = this.page.locator('button[title="Fit View"], button:has-text("Fit View")').first();
    if (await fitViewBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await fitViewBtn.click({ force: true });
      await this.page.waitForTimeout(500);
    }

    const sourceHandle = this.page.locator(
      `.svelte-flow__handle[data-nodeid="${sourceNodeId}"][data-handleid="${sourceHandleId}"]`
    );
    const targetHandle = this.page.locator(
      `.svelte-flow__handle[data-nodeid="${targetNodeId}"][data-handleid="${targetHandleId}"]`
    );
    await expect(sourceHandle).toBeVisible({ timeout: 10_000 });
    await expect(targetHandle).toBeVisible({ timeout: 10_000 });
    await sourceHandle.dragTo(targetHandle);

    // Verify the edge was created
    await this.page.waitForTimeout(500);
    const edgeSelector = `g[aria-label*="Edge from ${sourceNodeId}"][aria-label*="to ${targetNodeId}"]`;
    await expect(this.page.locator(edgeSelector)).toBeAttached({ timeout: 10_000 });
  }

  /**
   * Select a node on the canvas by clicking it, which auto-switches to the Properties tab.
   * Then ensures the sidebar is expanded so the properties are visible.
   */
  async selectNodeOnCanvas(nodeId: string) {
    // First click on empty canvas to deselect any previously selected node.
    // This ensures the selection change event fires when we click the target node,
    // which triggers the sidebar auto-switch to Properties tab.
    const pane = this.page.locator('.svelte-flow__pane');
    const box = await pane.boundingBox();
    if (box) {
      await pane.click({ position: { x: box.width * 0.9, y: box.height * 0.1 } });
      await this.page.waitForTimeout(300);
    }

    const node = this.page.locator(`.svelte-flow__node[data-id="${nodeId}"]`);
    await expect(node).toBeVisible({ timeout: 10_000 });
    await node.click();
    await expect(node).toHaveClass(/selected/, { timeout: 5_000 });
    // Clicking a node auto-switches the sidebar to Properties tab.
    // Ensure sidebar is expanded so we can interact with properties.
    await this.expandSidebar();
  }

  /**
   * Open a VFS file in the floating Monaco editor by navigating through the sidebar FileTree.
   * Clicks the VFS node to select it, expands parent folders if needed, then clicks the file.
   */
  async openVfsFile(nodeId: string, filePath: string) {
    await this.selectNodeOnCanvas(nodeId);

    // Wait for the VFSProperties file tree to finish loading.
    // The file tree is in the sidebar panel (right side of the sidebar).
    // We wait for some data-path elements to be present.
    await this.page.waitForFunction(
      () => document.querySelectorAll('[data-path]').length > 0,
      { timeout: 15_000 },
    );

    // The sidebar FileTree is the last container with file items.
    // Both the canvas node card and the sidebar have data-path items.
    // We need to click in the sidebar one (triggered by VFSProperties.handleFileClick).
    // Find all data-path elements matching our file, and click the last one (sidebar's).
    const parts = filePath.split('/').filter(Boolean);
    for (let i = 0; i < parts.length - 1; i++) {
      const folderPath = '/' + parts.slice(0, i + 1).join('/');
      const folders = this.page.locator(`[data-path="${folderPath}"]`);
      const count = await folders.count();
      if (count > 0) {
        // Click the last matching folder (the sidebar one)
        const folder = folders.last();
        if (await folder.isVisible({ timeout: 2_000 }).catch(() => false)) {
          const nextPath = '/' + parts.slice(0, i + 2).join('/');
          const nextItems = this.page.locator(`[data-path="${nextPath}"]`);
          // Check if the next level item already exists (folder already expanded)
          const nextCount = await nextItems.count();
          if (nextCount === 0 || !await nextItems.last().isVisible({ timeout: 1_000 }).catch(() => false)) {
            await folder.click();
            await this.page.waitForTimeout(500);
          }
        }
      }
    }

    // Click the target file — use the last matching element (sidebar's)
    const fileItems = this.page.locator(`[data-path="${filePath}"]`);
    await expect(fileItems.last()).toBeVisible({ timeout: 5_000 });
    await fileItems.last().click();

    // Wait for the floating editor panel to appear
    await expect(this.page.locator('.fixed.top-4.right-4.bottom-4.z-30')).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Replace the entire content of the currently open Monaco editor with new text.
   * Uses Ctrl+A to select all, then insertText to bypass Monaco auto-indentation.
   */
  async replaceEditorContent(newContent: string) {
    const editorPanel = this.page.locator('.fixed.top-4.right-4.bottom-4.z-30');
    await expect(editorPanel).toBeVisible({ timeout: 5_000 });

    // Monaco is loaded dynamically (modern-monaco init + LSP + import maps).
    // Wait for the loading spinner to disappear first, then for the editor element.
    await expect(editorPanel.locator('.animate-spin')).not.toBeVisible({ timeout: 60_000 });
    const monacoEditor = editorPanel.locator('.monaco-editor').first();
    await expect(monacoEditor).toBeVisible({ timeout: 10_000 });
    await monacoEditor.click();

    // Select all and replace using insertText — this avoids Monaco auto-indentation
    await this.page.keyboard.press('Control+A');
    await this.page.waitForTimeout(100);
    await this.page.keyboard.insertText(newContent);

    // Verify dirty indicator appears (the ● amber dot in the file tab bar)
    await expect(editorPanel.locator('span.text-amber-600')).toBeVisible({ timeout: 5_000 });
  }

  /** Save the currently open file in the Monaco editor via Ctrl+S */
  async saveFileInEditor() {
    const editorPanel = this.page.locator('.fixed.top-4.right-4.bottom-4.z-30');
    await expect(editorPanel).toBeVisible({ timeout: 5_000 });

    // Focus the editor first
    const monacoEditor = editorPanel.locator('.monaco-editor').first();
    await monacoEditor.click();

    await this.page.keyboard.press('Control+S');

    // Wait for dirty indicator to disappear
    await expect(editorPanel.locator('span.text-amber-600:has-text("●")')).not.toBeVisible({ timeout: 10_000 });
  }

  /** Close the floating VFS file editor */
  async closeEditor() {
    const editorPanel = this.page.locator('.fixed.top-4.right-4.bottom-4.z-30');
    if (await editorPanel.isVisible({ timeout: 1_000 }).catch(() => false)) {
      // Click the close button in the header
      const closeBtn = editorPanel.locator('.bg-indigo-500 button').first();
      await closeBtn.click();
      await expect(editorPanel).not.toBeVisible({ timeout: 5_000 });
    }
  }

  /** Assert build status shows a build/rebuild is required (either "Build stale" or "No build yet") */
  async assertNeedsBuild() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');
    // Either "Build stale" (Rebuild button) or "No build yet" (Build button)
    const buildBtn = form.locator('button', { hasText: /^Build$|^Rebuild$|^Retry$/ });
    await expect(buildBtn).toBeVisible({ timeout: 15_000 });
  }

  /** Assert build status shows "Build stale" with a Rebuild button */
  async assertBuildStale() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');
    await expect(form.locator('text=Build stale')).toBeVisible({ timeout: 15_000 });
    await expect(form.locator('button', { hasText: /^Rebuild$/ })).toBeVisible({ timeout: 5_000 });
  }

  /** Assert build has failed with an error */
  async assertBuildFailed() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');
    await expect(form.locator('text=Build failed')).toBeVisible({ timeout: 10_000 });
    await expect(form.locator('button', { hasText: /^Retry$/ })).toBeVisible({ timeout: 5_000 });
  }

  /** Click Build/Rebuild and wait for build failure */
  async buildExpectFailure() {
    await this.ensureProjectTab();
    const form = this.page.locator('#project-form');

    const buildBtn = form.locator('button', { hasText: /^Build$|^Rebuild$|^Retry$/ });
    await expect(buildBtn).toBeVisible({ timeout: 10_000 });
    await buildBtn.click({ force: true });

    // Wait for building state
    await expect(form.locator('text=Building...')).toBeVisible({ timeout: 10_000 });

    // Wait for build to fail
    await expect(form.locator('text=Build failed')).toBeVisible({ timeout: 120_000 });
  }

  /** Get the current project ID from the URL */
  getProjectId(): string {
    const match = this.page.url().match(/\/([a-f0-9-]{36})/);
    if (!match) throw new Error(`Could not extract project ID from URL: ${this.page.url()}`);
    return match[1];
  }
}
