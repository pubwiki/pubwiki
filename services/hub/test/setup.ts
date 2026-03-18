import { beforeAll } from 'vitest';
import { env } from 'cloudflare:test';

// 迁移文件由 vitest.config.ts 在构建时注入
declare const __MIGRATIONS__: Array<{ name: string; sql: string }>;

// 在所有测试开始前应用数据库迁移
beforeAll(async () => {
  for (const migration of __MIGRATIONS__) {
    // D1 需要分别执行每个语句
    const statements = migration.sql
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
      if (!errorMessage.includes('already exists') && !errorMessage.includes('duplicate column name')) {
        console.error(`Migration error in ${migration.name}:`, error);
      }
    }
  }
});
