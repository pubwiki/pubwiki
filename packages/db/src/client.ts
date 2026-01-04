import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

// 使用 D1 创建数据库连接（Cloudflare Workers）
export function createDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}
