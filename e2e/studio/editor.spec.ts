import { test, expect } from '../fixtures/test.js';
import { STUDIO_URL } from '../fixtures/constants.js';

test.describe('Studio — Node editor', () => {
  test('landing page redirects to a project editor', async ({ page }) => {
    await page.goto(STUDIO_URL);

    // Studio root redirects to /[projectId] which renders the SvelteFlow canvas
    // The .svelte-flow container is rendered by @xyflow/svelte
    await expect(page.locator('.svelte-flow')).toBeVisible({ timeout: 15_000 });
  });

  test.skip('add a node to the canvas', async ({ page }) => {
    // TODO: Open node palette (right-click / sidebar), click to add a node,
    //       verify a .svelte-flow__node element appears on the canvas.
  });

  test.skip('connect two nodes with an edge', async ({ page }) => {
    // TODO: Create two nodes, drag from output handle to input handle,
    //       verify a .svelte-flow__edge element is rendered.
  });
});
