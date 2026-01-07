import { beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
// 使用 Vite 的 ?raw 后缀将 SQL 文件作为字符串导入
import migrationSQL from '../packages/db/drizzle/0000_salty_ultimates.sql?raw';
import migrationSQL2 from '../packages/db/drizzle/0001_bumpy_puck.sql?raw';
import migrationSQL3 from '../packages/db/drizzle/0002_spooky_stingray.sql?raw';
import migrationSQL4 from '../packages/db/drizzle/0003_harsh_bloodstorm.sql?raw';
import migrationSQL5 from '../packages/db/drizzle/0004_salty_nightmare.sql?raw';
import migrationSQL6 from '../packages/db/drizzle/0005_awesome_paper_doll.sql?raw';
import migrationSQL7 from '../packages/db/drizzle/0006_charming_ultimatum.sql?raw';
import migrationSQL8 from '../packages/db/drizzle/0007_real_squirrel_girl.sql?raw';
import migrationSQL9 from '../packages/db/drizzle/0008_rare_alex_power.sql?raw';
import migrationSQL10 from '../packages/db/drizzle/0009_bitter_fat_cobra.sql?raw';
import migrationSQL11 from '../packages/db/drizzle/0010_married_khan.sql?raw';
import migrationSQL12 from '../packages/db/drizzle/0011_odd_whizzer.sql?raw';

// 在所有测试开始前应用数据库迁移
beforeAll(async () => {
  // D1 需要分别执行每个语句
  const allMigrations = [migrationSQL, migrationSQL2, migrationSQL3, migrationSQL4, migrationSQL5, migrationSQL6, migrationSQL7, migrationSQL8, migrationSQL9, migrationSQL10, migrationSQL11, migrationSQL12].join('\n--> statement-breakpoint\n');
  const statements = allMigrations
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

