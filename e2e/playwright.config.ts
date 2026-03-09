import { defineConfig } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const CI = !!process.env.CI;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// Local dev servers use HTTPS with self-signed certs.
// CI starts fresh HTTP servers (no certs available).
const protocol = CI ? 'http' : 'https';

// Override API URL to always point to localhost (the .env files may use a LAN IP
// that causes certificate hostname mismatch in the browser).
const TEST_ENV = {
  PUBLIC_API_BASE_URL: `${protocol}://localhost:8787/api`,
};

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? 'html' : 'list',
  outputDir: './test-results',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Accept self-signed certs from local dev servers
    ignoreHTTPSErrors: true,
  },

  projects: [
    // Global auth setup — runs first, saves storageState for other projects
    {
      name: 'setup',
      testMatch: 'fixtures/auth.setup.ts',
    },
    {
      name: 'hub',
      testDir: './hub',
      dependencies: ['setup'],
      use: {
        baseURL: `${protocol}://localhost:5173`,
        storageState: '.auth/user.json',
      },
    },
    {
      name: 'studio',
      testDir: './studio',
      dependencies: ['setup'],
      use: {
        baseURL: `${protocol}://localhost:5174`,
        storageState: '.auth/user.json',
      },
    },
    {
      name: 'integration',
      testDir: './integration',
      dependencies: ['setup'],
      use: {
        storageState: '.auth/user.json',
      },
    },
  ],

  webServer: [
    {
      // CI: start fresh HTTP wrangler dev (no certs)
      // Local: reuseExistingServer picks up the already-running HTTPS server
      command: 'cd services/hub && npx wrangler dev',
      url: `${protocol}://localhost:8787/api`,
      reuseExistingServer: !CI,
      timeout: 60_000,
      cwd: WORKSPACE_ROOT,
      ignoreHTTPSErrors: true,
    },
    {
      command: 'pnpm --filter pubwiki dev -- --port 5173',
      url: `${protocol}://localhost:5173`,
      reuseExistingServer: !CI,
      timeout: 30_000,
      cwd: WORKSPACE_ROOT,
      env: TEST_ENV,
      ignoreHTTPSErrors: true,
    },
    {
      command: 'pnpm --filter @pubwiki/studio dev -- --port 5174',
      url: `${protocol}://localhost:5174`,
      reuseExistingServer: !CI,
      timeout: 30_000,
      cwd: WORKSPACE_ROOT,
      env: TEST_ENV,
      ignoreHTTPSErrors: true,
    },
  ],
});
