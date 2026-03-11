import { sqliteTable, text, integer, index, primaryKey, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { ArtifactEntrypoint } from '@pubwiki/api'

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifacts - 主内容表
// 访问控制通过 resource_access_control 表管理 (isPrivate + isListed)
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name', { length: 100 }).notNull(),
    description: text('description'),
    latestVersion: text('latest_version'), // commit hash of the latest version
    thumbnailUrl: text('thumbnail_url', { length: 500 }),
    license: text('license', { length: 50 }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
    // FTS indexing flag: set to true after optimistic lock check passes
    // This allows FTS triggers to fire without affecting changes() count
    searchable: integer('searchable', { mode: 'boolean' }).default(false).notNull(),
  },
  (table) => [
    index('idx_artifacts_author').on(table.authorId),
  ]
);

// artifact_versions - 版本控制
export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: text('version', { length: 50 }), // optional semver
    commitHash: text('commit_hash').notNull(), // SHA-256 hex string (64 chars)
    changelog: text('changelog'),
    publishedAt: text('published_at'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    // JSON 字段存储为文本
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    checksum: text('checksum', { length: 64 }),
    // 入口点：指定启动流图时的初始程序状态
    entrypoint: text('entrypoint', { mode: 'json' }).$type<ArtifactEntrypoint>(),
    // 构建缓存 key（独立列，便于索引）— 逻辑外键指向 build_cache.cache_key
    buildCacheKey: text('build_cache_key'),
  },
  (table) => [
    index('idx_artifact_versions_artifact').on(table.artifactId),
    index('idx_artifact_versions_version').on(table.artifactId, table.version),
    uniqueIndex('idx_artifact_versions_commit').on(table.artifactId, table.commitHash),
    index('idx_artifact_versions_build_cache').on(table.buildCacheKey),
    check('chk_entrypoint_requires_build_cache', sql`entrypoint IS NULL OR build_cache_key IS NOT NULL`),
  ]
);

// artifact_commit_tags - commitTag 多对一关联表
// 一个 commit 可以有多个 tag，但每个 tag 在同一 artifact 内唯一
export const artifactCommitTags = sqliteTable(
  'artifact_commit_tags',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    commitHash: text('commit_hash')
      .notNull(),
    tag: text('tag').notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    // 同一 artifact 内 tag 名唯一（tag 只能指向一个版本）
    uniqueIndex('idx_artifact_commit_tags_unique').on(table.artifactId, table.tag),
    index('idx_artifact_commit_tags_version').on(table.commitHash),
  ]
);

// tags - 标签表 (slug 作为主键)
export const tags = sqliteTable(
  'tags',
  {
    slug: text('slug', { length: 50 }).primaryKey(),
    name: text('name', { length: 50 }).notNull().unique(),
    description: text('description'),
    color: text('color', { length: 7 }), // #RRGGBB
    usageCount: integer('usage_count').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_tags_usage').on(table.usageCount),
  ]
);

// artifact_tags - 多对多关系 (使用 tagSlug 代替 tagId)
export const artifactTags = sqliteTable(
  'artifact_tags',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    tagSlug: text('tag_slug')
      .notNull()
      .references(() => tags.slug, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.tagSlug] }),
    index('idx_artifact_tags_artifact').on(table.artifactId),
    index('idx_artifact_tags_tag').on(table.tagSlug),
  ]
);

// Type exports
export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ArtifactVersion = typeof artifactVersions.$inferSelect;
export type NewArtifactVersion = typeof artifactVersions.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type ArtifactTag = typeof artifactTags.$inferSelect;
export type NewArtifactTag = typeof artifactTags.$inferInsert;
export type ArtifactCommitTag = typeof artifactCommitTags.$inferSelect;
export type NewArtifactCommitTag = typeof artifactCommitTags.$inferInsert;
