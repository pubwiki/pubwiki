// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';

// Layer definitions for boundary enforcement
const LAYER_0 = ['pkg-api', 'pkg-vfs', 'pkg-sandbox-client', 'pkg-world-editor'];
const LAYER_1 = ['pkg-bundler', 'pkg-chat', 'pkg-lua', 'pkg-reader', 'pkg-rdfstore', 'pkg-sandbox-service', 'pkg-ui'];
const LAYER_2 = ['pkg-flow-core', 'pkg-sandbox-host', 'pkg-svelte-chat'];
const LAYER_3 = ['pkg-db'];
const ALL_APPS = ['app-hub', 'app-studio', 'app-player', 'app-sandbox', 'app-homepage', 'app-docs', 'app-coming-soon'];
const ALL_SERVICES = ['service-hub'];

export default defineConfig(
  // ==================== Global ignores ====================
  {
    ignores: [
      '**/node_modules/**',
      '**/.svelte-kit/**',
      '**/dist/**',
      '**/build/**',
      '**/.wrangler/**',
      '**/target/**',
      '**/.turbo/**',
      // Declaration files
      '**/*.d.ts',
      // Config files at project roots
      '**/*.config.ts',
      '**/*.config.js',
      '**/*.config.mjs',
      // Codegen outputs
      'packages/api/src/generated/**',
      'packages/api/src/validate/schemas.ts',
      'packages/api/openapi.bundled.yaml',
      // Paraglide generated
      '**/paraglide/**',
      // Inlang
      '**/project.inlang/**',
      // Docs / non-code
      'llm-docs/**',
      '.github/**',
      // Sandbox build script
      'apps/sandbox/build-sw.js',
      // Mock data in services
      'services/hub/scripts/**',
      // WASM generated glue code
      'packages/lua/wasm/**',
    ]
  },

  // ==================== Base: JS + TS ====================
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // typescript-eslint handles undefined variables
      'no-undef': 'off',
      // Allow unused vars with _ prefix (common pattern for intentionally unused params)
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    }
  },

  // ==================== Svelte files ====================
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      }
    }
  },

  // ==================== Boundaries ====================
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        // Apps
        { type: 'app-hub',         pattern: ['apps/hub/src/**'] },
        { type: 'app-studio',      pattern: ['apps/studio/src/**'] },
        { type: 'app-player',      pattern: ['apps/player/src/**'] },
        { type: 'app-sandbox',     pattern: ['apps/sandbox/src/**'] },
        { type: 'app-homepage',    pattern: ['apps/homepage/src/**'] },
        { type: 'app-docs',        pattern: ['apps/docs/src/**'] },
        { type: 'app-coming-soon', pattern: ['apps/coming-soon/src/**'] },
        // Services
        { type: 'service-hub',  pattern: ['services/hub/src/**'] },
        // Packages - Layer 0 (no internal deps)
        { type: 'pkg-api',            pattern: ['packages/api/src/**'] },
        { type: 'pkg-vfs',            pattern: ['packages/vfs/src/**'] },
        { type: 'pkg-sandbox-client', pattern: ['packages/sandbox-client/src/**'] },
        { type: 'pkg-world-editor',   pattern: ['packages/world-editor/src/**'] },
        // Packages - Layer 1 (depends on Layer 0)
        { type: 'pkg-bundler',          pattern: ['packages/bundler/src/**'] },
        { type: 'pkg-chat',             pattern: ['packages/chat/src/**'] },
        { type: 'pkg-lua',              pattern: ['packages/lua/src/**'] },
        { type: 'pkg-reader',           pattern: ['packages/reader/src/**'] },
        { type: 'pkg-rdfstore',         pattern: ['packages/rdfstore/src/**'] },
        { type: 'pkg-sandbox-service',  pattern: ['packages/sandbox-service/src/**'] },
        { type: 'pkg-ui',               pattern: ['packages/ui/src/**'] },
        // Packages - Layer 2 (depends on Layer 0-1)
        { type: 'pkg-flow-core',    pattern: ['packages/flow-core/src/**'] },
        { type: 'pkg-sandbox-host', pattern: ['packages/sandbox-host/src/**'] },
        { type: 'pkg-svelte-chat',  pattern: ['packages/svelte-chat/src/**'] },
        // Packages - Layer 3
        { type: 'pkg-db', pattern: ['packages/db/src/**'] },
        // E2E
        { type: 'e2e', pattern: ['e2e/**'] },
      ],
    },
    rules: {
      'boundaries/dependencies': ['error', {
        default: 'allow',
        rules: [
          // ---- Layer 0 packages: cannot import other internal packages ----
          {
            from: { type: LAYER_0 },
            disallow: { to: { type: [...LAYER_0, ...LAYER_1, ...LAYER_2, ...LAYER_3, ...ALL_APPS, ...ALL_SERVICES] } },
          },

          // ---- Layer 1 packages: can only import Layer 0 ----
          {
            from: { type: LAYER_1 },
            disallow: { to: { type: [...LAYER_1, ...LAYER_2, ...LAYER_3, ...ALL_APPS, ...ALL_SERVICES] } },
          },

          // ---- Layer 2 packages: cannot import Layer 2+, apps, services ----
          {
            from: { type: LAYER_2 },
            disallow: { to: { type: [...LAYER_2, ...LAYER_3, ...ALL_APPS, ...ALL_SERVICES] } },
          },

          // ---- Layer 3 packages: cannot import apps or services ----
          {
            from: { type: LAYER_3 },
            disallow: { to: { type: [...LAYER_3, ...ALL_APPS, ...ALL_SERVICES] } },
          },

          // ---- Services: cannot import apps ----
          {
            from: { type: ALL_SERVICES },
            disallow: { to: { type: ALL_APPS } },
          },

          // ---- E2E: can only import pkg-api ----
          {
            from: { type: ['e2e'] },
            disallow: { to: { type: [...ALL_APPS, ...ALL_SERVICES, ...LAYER_1, ...LAYER_2, ...LAYER_3, 'pkg-vfs', 'pkg-sandbox-client', 'pkg-world-editor'] } },
          },
        ]
      }],
    }
  },

  // ==================== Homepage overrides ====================
  // The homepage is a static marketing site with many external links
  // and hash anchors that don't benefit from resolveRoute().
  {
    files: ['apps/homepage/**/*.svelte'],
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
    }
  },
);
