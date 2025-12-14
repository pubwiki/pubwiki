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
    exclude: ['test/integration/e2e-build.test.ts'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    testTimeout: 30000,
  },
  optimizeDeps: {
    exclude: ['esbuild-wasm']
  }
})
