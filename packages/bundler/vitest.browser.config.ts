import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { playwright } from '@vitest/browser-playwright'

/**
 * Browser-based test configuration for end-to-end tests.
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
    // Use browser environment for esbuild-wasm tests
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
      'test/integration/e2e-build.test.ts',
      'test/integration/bundler-service-watch.test.ts',
      'test/integration/reproduce-lazy-binding.test.ts'
    ],
    // Longer timeout for WASM initialization and network requests
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  optimizeDeps: {
    // Include esbuild-wasm so Vite can transform it properly
    include: ['esbuild-wasm']
  }
})
