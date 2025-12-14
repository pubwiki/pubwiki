import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { playwright } from '@vitest/browser-playwright'

/**
 * Browser-based test configuration for end-to-end tests.
 * 
 * These tests run in a real browser environment with:
 * - Web Workers (required by BundlerService)
 * - window object (required by SandboxConnection)
 * - MessageChannel API
 * 
 * Run with: pnpm test:e2e
 */
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  test: {
    globals: true,
    // Use browser environment for tests that require Web Workers and window
    browser: {
      enabled: true,
      provider: playwright({
        launch: {
          headless: true
        }
      }),
      instances: [
        { browser: 'chromium' }
      ],
    },
    include: [
      'test/e2e/**/*.test.ts'
    ],
    // Longer timeout for browser initialization and async operations
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  optimizeDeps: {
    // Include esbuild-wasm so Vite can transform it properly
    include: ['esbuild-wasm']
  }
})
