import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { ArtifactType, VisibilityType } from './enums';

// Stored edge 类型定义
export interface StoredEdge {
  source: string;        // 源节点 ID
  target: string;        // 目标节点 ID
  sourceHandle?: string; // 源节点连接点
  targetHandle?: string; // 目标节点连接点
}


// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifacts - 主内容表
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').$type<ArtifactType>().notNull(), // RECIPE, GAME, ASSET_PACK, PROMPT
    name: text('name', { length: 100 }).notNull(),
    slug: text('slug', { length: 100 }).notNull(),
    description: text('description'),
    visibility: text('visibility').$type<VisibilityType>().default('PUBLIC').notNull(),
    currentVersionId: text('current_version_id'), // 稍后设置引用
    thumbnailUrl: text('thumbnail_url', { length: 500 }),
    license: text('license', { length: 50 }),
    repositoryUrl: text('repository_url', { length: 500 }),
    isArchived: integer('is_archived', { mode: 'boolean' }).default(false).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_artifacts_author').on(table.authorId),
    index('idx_artifacts_type').on(table.type),
    index('idx_artifacts_slug').on(table.authorId, table.slug),
    index('idx_artifacts_visibility').on(table.visibility),
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
    version: text('version', { length: 50 }).notNull(), // semver: 1.0.0
    commitHash: text('commit_hash').notNull(), // SHA-256 前8位
    changelog: text('changelog'),
    isPrerelease: integer('is_prerelease', { mode: 'boolean' }).default(false).notNull(),
    publishedAt: text('published_at'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    // JSON 字段存储为文本
    metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
    edges: text('edges', { mode: 'json' }).$type<StoredEdge[]>(), // 节点间的边关系
    checksum: text('checksum', { length: 64 }),
  },
  (table) => [
    index('idx_artifact_versions_artifact').on(table.artifactId),
    index('idx_artifact_versions_version').on(table.artifactId, table.version),
    uniqueIndex('idx_artifact_versions_commit').on(table.artifactId, table.commitHash),
  ]
);

// tags - 标签表
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name', { length: 50 }).notNull().unique(),
    slug: text('slug', { length: 50 }).notNull().unique(),
    description: text('description'),
    color: text('color', { length: 7 }), // #RRGGBB
    usageCount: integer('usage_count').default(0).notNull(),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_tags_slug').on(table.slug),
    index('idx_tags_usage').on(table.usageCount),
  ]
);

// artifact_tags - 多对多关系
export const artifactTags = sqliteTable(
  'artifact_tags',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.tagId] }),
    index('idx_artifact_tags_artifact').on(table.artifactId),
    index('idx_artifact_tags_tag').on(table.tagId),
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
