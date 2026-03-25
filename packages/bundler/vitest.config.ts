import { defineConfig } from 'vitest/config'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  test: {
    globals: true,
    // Use node for unit tests, browser tests go in separate config
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // These tests require browser environment (esbuild-wasm)
    exclude: [
      'test/integration/e2e-build.test.ts',
      'test/integration/bundler-service-watch.test.ts',
      'test/integration/reproduce-lazy-binding.test.ts'
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 30000,
  },
  optimizeDeps: {
    exclude: ['esbuild-wasm']
  }
})
