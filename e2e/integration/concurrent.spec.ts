import { test } from '../fixtures/test.js';

test.describe('Concurrent — Multi-session / multi-user', () => {
  test.skip('same user, two browser contexts, both sessions valid', async ({ browser: _browser }) => {
    // TODO:
    // 1. Create a user via API.
    // 2. Log in from two separate browser contexts.
    // 3. Both contexts can fetch the authenticated /me endpoint.
  });

  test.skip('two users edit same artifact → optimistic lock conflict', async ({ browser: _browser }) => {
    // TODO:
    // 1. User A creates an artifact.
    // 2. User A and User B both fetch the artifact metadata.
    // 3. User A updates → success.
    // 4. User B updates with stale version → expect 409 Conflict.
  });

  test.skip('logout in one tab does not invalidate other tab', async ({ browser: _browser }) => {
    // TODO:
    // 1. Same user logs in on two contexts.
    // 2. Context A logs out.
    // 3. Context B can still make authenticated requests (independent sessions).
  });
});
