import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? 'html' : 'list',
  outputDir: './test-results',

  // globalSetup spawns backend + frontend servers on dynamic ports,
  // seeds the DB, and returns a teardown function that cleans everything up.
  globalSetup: './fixtures/global-setup.ts',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Accept self-signed certs from local dev servers
    ignoreHTTPSErrors: true,
    // Use system Chrome for proper GPU acceleration (avoids canvas tearing in headed mode)
    channel: 'chrome',
    launchOptions: {
      args: [
        '--enable-gpu',
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--enable-features=Vulkan',
      ],
    },
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
        storageState: '.auth/user.json',
      },
    },
    {
      name: 'studio',
      testDir: './studio',
      dependencies: ['setup'],
      use: {
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

  // Servers are managed by globalSetup — no webServer config needed.
});
