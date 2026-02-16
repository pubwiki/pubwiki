// @ts-check
import eslint from '@eslint/js'
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
        ".wrangler",
        "dist",
        "*.ts",
        "*.mjs",
        "scripts/mock"
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
