import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import fs from 'node:fs';
import path from 'node:path';

// 在 Node.js 环境中读取所有迁移文件
const migrationsDir = path.resolve(__dirname, '../packages/db/drizzle');
const migrationFiles = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort();
const migrations = migrationFiles.map(file => ({
  name: file,
  sql: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
}));

export default defineWorkersConfig({
  define: {
    // 将迁移 SQL 注入到 Workers 环境
    '__MIGRATIONS__': JSON.stringify(migrations),
  },
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
    // 单元测试文件目录 - 排除 e2e 测试
    include: ['test/**/*.test.ts'],
    exclude: ['test/e2e/**'],
    // 全局设置
    globals: true,
    // 设置文件 - 用于在测试前初始化数据库
    setupFiles: ['./test/setup.ts'],
    watch: false,
  },
});
