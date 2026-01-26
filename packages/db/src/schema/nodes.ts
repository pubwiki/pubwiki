import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { artifacts, artifactVersions } from './artifacts';
import type { ArtifactNodeType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// artifact_nodes - 节点表
export const artifactNodes = sqliteTable(
  'artifact_nodes',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    type: text('type').$type<ArtifactNodeType>().notNull(), // PROMPT, INPUT, GENERATED, VFS, LOADER, SANDBOX, STATE
    name: text('name'),
    // Node position in the graph
    positionX: integer('position_x'),
    positionY: integer('position_y'),
    // Fork 来源：原始节点 ID（当此节点是从外部节点 fork 而来时）
    originalNodeId: text('original_node_id'),
    // Fork 来源：原始节点的 commit hash
    originalCommit: text('original_commit'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
    updatedAt: text('updated_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_artifact_nodes_artifact').on(table.artifactId),
    index('idx_artifact_nodes_type').on(table.type),
  ]
);

// artifact_node_versions - 节点版本表
// 现在包含节点内容（非 VFS 节点为 JSON，VFS 节点为文件摘要）
export const artifactNodeVersions = sqliteTable(
  'artifact_node_versions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    nodeId: text('node_id')
      .notNull()
      .references(() => artifactNodes.id, { onDelete: 'cascade' }),
    commitHash: text('commit_hash').notNull(), // SHA-256 前8位
    contentHash: text('content_hash').notNull(), // 用于去重
    // 节点内容 - JSON 格式
    // 非 VFS 节点：完整的结构化内容
    // VFS 节点：文件摘要列表 { files: [{ path, size, mimeType }] }
    content: text('content'),
    message: text('message'),
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_node_versions_node').on(table.nodeId),
    uniqueIndex('idx_node_versions_hash').on(table.nodeId, table.commitHash),
  ]
);

// artifact_node_refs - 外部节点引用表
// 记录 artifact 中引用的外部节点（来自其他项目），外部引用强制锁定版本
export const artifactNodeRefs = sqliteTable(
  'artifact_node_refs',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    artifactVersionId: text('artifact_version_id')
      .notNull()
      .references(() => artifactVersions.id, { onDelete: 'cascade' }),
    externalNodeId: text('external_node_id').notNull(), // 被引用的外部节点 ID
    externalArtifactId: text('external_artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    externalNodeVersionId: text('external_node_version_id').notNull(), // 引用的具体节点版本（强制锁定）
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    index('idx_node_refs_version').on(table.artifactVersionId),
    index('idx_node_refs_external_artifact').on(table.externalArtifactId),
  ]
);

// Type exports
export type ArtifactNode = typeof artifactNodes.$inferSelect;
export type NewArtifactNode = typeof artifactNodes.$inferInsert;
export type ArtifactNodeVersion = typeof artifactNodeVersions.$inferSelect;
export type NewArtifactNodeVersion = typeof artifactNodeVersions.$inferInsert;
export type ArtifactNodeRef = typeof artifactNodeRefs.$inferSelect;
export type NewArtifactNodeRef = typeof artifactNodeRefs.$inferInsert;
