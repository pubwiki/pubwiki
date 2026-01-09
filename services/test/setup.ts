import { beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
// 使用 Vite 的 ?raw 后缀将 SQL 文件作为字符串导入
import migrationSQL from '../packages/db/drizzle/0000_nasty_virginia_dare.sql?raw';

// 在所有测试开始前应用数据库迁移
beforeAll(async () => {
  // D1 需要分别执行每个语句
  const statements = migrationSQL
    .split('--> statement-breakpoint')
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  
  // 使用 batch 执行所有语句
  const preparedStatements = statements.map(sql => env.DB.prepare(sql));

  try {
    await env.DB.batch(preparedStatements);
  } catch (error) {
    // 忽略 "table already exists" 错误
    const errorMessage = String(error);
    if (!errorMessage.includes('already exists')) {
      console.error('Migration error:', error);
    }
  }
});
