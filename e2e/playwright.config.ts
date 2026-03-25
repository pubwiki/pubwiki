import { defineConfig } from '@playwright/test';
import path from 'node:path';

const CI = !!process.env.CI;

const chromeArgs = [
  '--enable-gpu',
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=Vulkan',
];

// Chrome for Testing binaries (downloaded via @puppeteer/browsers)
const CHROME_130 = path.resolve(
  process.env.HOME ?? '~',
  '.cache/chrome-for-testing/chrome/linux-130.0.6723.116/chrome-linux64/chrome',
);

// Which browser set to run: 'current' (default) or 'compat' (includes old versions)
const COMPAT = !!process.env.E2E_COMPAT;

// Shared authenticated project config
const authUse = { storageState: '.auth/user.json' };

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
  },

  projects: [
    // Global auth setup — runs first, saves storageState for other projects
    {
      name: 'setup',
      testMatch: 'fixtures/auth.setup.ts',
      use: { channel: 'chrome', launchOptions: { args: chromeArgs } },
    },
    {
      name: 'hub',
      testDir: './hub',
      dependencies: ['setup'],
      use: { ...authUse, channel: 'chrome', launchOptions: { args: chromeArgs } },
    },
    {
      name: 'studio',
      testDir: './studio',
      dependencies: ['setup'],
      use: { ...authUse, channel: 'chrome', launchOptions: { args: chromeArgs } },
    },
    {
      name: 'integration',
      testDir: './integration',
      dependencies: ['setup'],
      use: { ...authUse, channel: 'chrome', launchOptions: { args: chromeArgs } },
    },

    // ── Firefox ───────────────────────────────────────────────
    {
      name: 'firefox-setup',
      testMatch: 'fixtures/auth.setup.ts',
      use: { browserName: 'firefox' },
    },
    {
      name: 'firefox-integration',
      testDir: './integration',
      dependencies: ['firefox-setup'],
      use: { ...authUse, browserName: 'firefox' },
    },

    // ── Compatibility: Chrome 130 ──────────────────────────────
    // Activated with E2E_COMPAT=1 or --project=chrome130-*
    ...(COMPAT
      ? [
          {
            name: 'chrome130-setup',
            testMatch: 'fixtures/auth.setup.ts',
            use: {
              channel: undefined as unknown as string,
              launchOptions: {
                executablePath: CHROME_130,
                args: chromeArgs,
              },
            },
          },
          {
            name: 'chrome130-hub',
            testDir: './hub',
            dependencies: ['chrome130-setup'],
            use: {
              ...authUse,
              channel: undefined as unknown as string,
              launchOptions: {
                executablePath: CHROME_130,
                args: chromeArgs,
              },
            },
          },
          {
            name: 'chrome130-studio',
            testDir: './studio',
            dependencies: ['chrome130-setup'],
            use: {
              ...authUse,
              channel: undefined as unknown as string,
              launchOptions: {
                executablePath: CHROME_130,
                args: chromeArgs,
              },
            },
          },
          {
            name: 'chrome130-integration',
            testDir: './integration',
            dependencies: ['chrome130-setup'],
            use: {
              ...authUse,
              channel: undefined as unknown as string,
              launchOptions: {
                executablePath: CHROME_130,
                args: chromeArgs,
              },
            },
          },
        ]
      : []),
  ],

  // Servers are managed by globalSetup — no webServer config needed.
});
