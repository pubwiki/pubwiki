import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'sqlite',
  // 对于 D1，不需要指定 dbCredentials
  // 迁移使用 wrangler d1 migrations apply 命令
});
