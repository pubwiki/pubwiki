import { test, expect } from '../fixtures/test.js';
import { STUDIO_URL } from '../fixtures/constants.js';

test.describe('Studio — Save & Load', () => {
  test.skip('save project to IndexedDB and reload', async ({ page }) => {
    // TODO: Create a node, trigger save, reload the page,
    //       verify the node is still present (persisted in IndexedDB).
  });
});
