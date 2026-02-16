// @ts-check
import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
        "*.ts",
        // codegen files 
        "src/generated/openapi.ts",
        "src/validate/schemas.ts",
        "*.mjs",
    ]
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      }
    }
  }
);
