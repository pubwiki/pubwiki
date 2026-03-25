import { test, expect } from '../fixtures/test.js';
import { StudioPage } from '../fixtures/pages/studio-page.js';

test.describe('Studio — Node name auto-focus on creation', () => {
  test('adding a VFS node focuses name input with default text selected', async ({ page }) => {
    const studio = new StudioPage(page);
    await studio.goto();

    // Wait for the canvas to be fully loaded with existing nodes
    await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

    // ── Step 1: Add a VFS node (name input should auto-focus) ──
    const nodeId = await studio.addNodeViaContextMenu('VFS');
    const node = page.locator(`.svelte-flow__node[data-id="${nodeId}"]`);
    await expect(node).toBeVisible({ timeout: 5_000 });

    // ── Step 2: Verify name input is visible and focused ──
    const nameInput = node.locator('input[type="text"]');
    await expect(nameInput).toBeFocused({ timeout: 5_000 });

    // ── Step 3: Verify default name text is selected ──
    // The default name for a VFS node is "Files" (or "Files N" if duplicates exist).
    // When text is selected, window.getSelection() or input.selectionStart/End reflect it.
    const inputValue = await nameInput.inputValue();
    expect(inputValue.length).toBeGreaterThan(0);

    const selectionLength = await nameInput.evaluate((el: HTMLInputElement) => {
      return (el.selectionEnd ?? 0) - (el.selectionStart ?? 0);
    });
    expect(selectionLength).toBe(inputValue.length);

    // ── Step 4: Press Enter to confirm the default name ──
    await page.keyboard.press('Enter');

    // After Enter, the input should disappear and the name label should show
    await expect(nameInput).not.toBeVisible({ timeout: 5_000 });
    const nameLabel = node.locator('span.truncate');
    await expect(nameLabel).toBeVisible({ timeout: 5_000 });
    const confirmedName = await nameLabel.textContent();
    expect(confirmedName?.trim()).toBe(inputValue);
  });

  test('typing replaces the selected default name', async ({ page }) => {
    const studio = new StudioPage(page);
    await studio.goto();

    await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 30_000 });

    // Add a VFS node — name input auto-focuses with text selected
    const nodeId = await studio.addNodeViaContextMenu('VFS');
    const node = page.locator(`.svelte-flow__node[data-id="${nodeId}"]`);
    const nameInput = node.locator('input[type="text"]');
    await expect(nameInput).toBeFocused({ timeout: 5_000 });

    // Type a custom name — since default text is selected, typing replaces it
    const customName = 'My Custom Node';
    await page.keyboard.type(customName);

    // Verify the input now contains the custom name
    await expect(nameInput).toHaveValue(customName);

    // Press Enter to confirm
    await page.keyboard.press('Enter');

    // Verify the label shows the custom name
    await expect(nameInput).not.toBeVisible({ timeout: 5_000 });
    const nameLabel = node.locator('span.truncate');
    await expect(nameLabel).toBeVisible({ timeout: 5_000 });
    expect(await nameLabel.textContent()).toContain(customName);
  });
});
