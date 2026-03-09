import { test, expect } from '../fixtures/test.js';
import { HUB_URL, STUDIO_URL } from '../fixtures/constants.js';

test.describe('Integration — Import flow (Hub → Studio)', () => {
  test.skip('import an artifact from Hub into Studio', async ({ page }) => {
    // TODO:
    // 1. Seed an artifact via API.
    // 2. Open Studio with ?import={artifactId}.
    // 3. Verify the graph loads correctly in the editor.
  });
});
