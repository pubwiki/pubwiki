import { test, expect } from '../fixtures/test.js';
import { HUB_URL, API_BASE_URL } from '../fixtures/constants.js';
import { createUser, createArtifact } from '../fixtures/test-data-factory.js';

test.describe('Concurrent — Multi-session / multi-user', () => {
  test.skip('same user, two browser contexts, both sessions valid', async ({ browser }) => {
    // TODO:
    // 1. Create a user via API.
    // 2. Log in from two separate browser contexts.
    // 3. Both contexts can fetch the authenticated /me endpoint.
  });

  test.skip('two users edit same artifact → optimistic lock conflict', async ({ browser }) => {
    // TODO:
    // 1. User A creates an artifact.
    // 2. User A and User B both fetch the artifact metadata.
    // 3. User A updates → success.
    // 4. User B updates with stale version → expect 409 Conflict.
  });

  test.skip('logout in one tab does not invalidate other tab', async ({ browser }) => {
    // TODO:
    // 1. Same user logs in on two contexts.
    // 2. Context A logs out.
    // 3. Context B can still make authenticated requests (independent sessions).
  });
});
