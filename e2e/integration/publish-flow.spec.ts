import { test, expect } from '../fixtures/test.js';
import { HUB_URL, STUDIO_URL } from '../fixtures/constants.js';

test.describe('Integration — Publish flow (Studio → Hub)', () => {
  test.skip('create in Studio, publish, visible on Hub', async ({ page, context }) => {
    // TODO:
    // 1. Open Studio, create a simple graph (e.g. Input → Output).
    // 2. Trigger "Publish to Hub".
    // 3. Navigate to Hub and verify the artifact appears in the listing.
    //
    // Note: this test needs two different origins, so use `context.newPage()`
    // or navigate between them.
  });
});
