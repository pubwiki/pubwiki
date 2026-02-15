import { defineConfig } from 'orval';

export default defineConfig({
  pubwiki: {
    input: {
      target: './openapi.bundled.yaml',
    },
    output: {
      client: 'zod',
      target: './src/validate/schemas.ts',
    },
  },
});
