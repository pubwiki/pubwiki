import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

/**
 * build_cache — 构建缓存元数据表
 *
 * 以 buildCacheKey（基于输入 hash）为 PK，存储构建产物的校验元数据。
 * 与 artifact_versions 解耦 — 多个版本可共享同一缓存。
 *
 * - cache_key:    SHA-256(canonicalize({ filesHash, entryFiles, ... }))，基于输入寻址
 * - release_hash: SHA-256(tar.gz)，基于输出内容 hash，同时作为 R2 存储 key
 * - file_hashes:  每个产物文件的 SHA-256，消费者可用于本地校验
 */
export const buildCache = sqliteTable('build_cache', {
  cacheKey: text('cache_key').primaryKey(),
  releaseHash: text('release_hash').notNull(),
  fileHashes: text('file_hashes', { mode: 'json' })
    .notNull()
    .$type<Record<string, string>>(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// Type exports
export type BuildCache = typeof buildCache.$inferSelect;
export type NewBuildCache = typeof buildCache.$inferInsert;
