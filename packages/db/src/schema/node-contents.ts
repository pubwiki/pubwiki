import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// 节点内容分表存储（按 content_hash 去重）
// ========================================================================
// 设计原则：
// 1. 每种 NodeType 有独立的内容表，便于索引和查询
// 2. 所有表以 content_hash (SHA-256) 为主键，实现内容去重
// 3. UGC 平台特性：fork artifact 会产生大量相同内容，分离存储节省空间
// 4. node_versions.content_hash + node_versions.type 确定具体查哪张表
//
// 注意：实际数据库为 SQLite (D1)，使用 Drizzle ORM

// ────────────────────────────────────────────────────────────
// 1) INPUT 节点内容
// 内容：用户输入文本（ContentBlock[]）+ 生成配置
// ────────────────────────────────────────────────────────────
export const inputContents = sqliteTable('input_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // 结构化内容
  blocks: text('blocks', { mode: 'json' }).$type<unknown[]>().notNull(),  // ContentBlock[] (TextBlock | RefTagBlock)
  generationConfig: text('generation_config', { mode: 'json' }).$type<Record<string, unknown>>(), // { model?, temperature?, schema? }

  // 索引辅助字段（从 blocks 中提取，便于搜索）
  plainText: text('plain_text'),                               // 纯文本内容（从 blocks 提取，用于全文搜索）
  reftagNames: text('reftag_names', { mode: 'json' }).$type<string[]>(), // 引用的 reftag 名称列表

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 2) PROMPT 节点内容
// 内容：提示词文本（ContentBlock[]）
// 与 INPUT 结构类似但无 generation_config
// ────────────────────────────────────────────────────────────
export const promptContents = sqliteTable('prompt_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  blocks: text('blocks', { mode: 'json' }).$type<unknown[]>().notNull(),  // ContentBlock[]

  // 索引辅助字段
  plainText: text('plain_text'),                               // 纯文本（全文搜索）
  reftagNames: text('reftag_names', { mode: 'json' }).$type<string[]>(), // 引用的 reftag 名称列表

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 3) GENERATED 节点内容
// 内容：AI 生成的消息块
// 谱系引用（inputRef, promptRefs 等）是版本级别的关系，
// 存储在 node_version_refs 表中，不在内容表里。
// 这与 serialize() 一致：content_hash 只基于文本内容。
// ────────────────────────────────────────────────────────────
export const generatedContents = sqliteTable('generated_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // AI 生成内容
  blocks: text('blocks', { mode: 'json' }).$type<unknown[]>().notNull(),  // MessageBlock[] (from @pubwiki/chat)

  // 索引辅助字段
  plainText: text('plain_text'),                               // 纯文本（全文搜索）

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 4) VFS 节点内容
// 内容：虚拟文件系统配置 + 挂载信息
// 实际文件存储在 R2: r2://vfs/{content_hash}/files.tar.gz
// ────────────────────────────────────────────────────────────
export interface VfsFileEntry {
  path: string;
  size: number;
  mimeType?: string;
}

export const vfsContents = sqliteTable('vfs_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // VFS 配置
  projectId: text('project_id').notNull(),                     // 所属项目 ID
  mounts: text('mounts', { mode: 'json' }).$type<unknown[]>(), // VfsMountConfig[] 挂载配置

  // 文件目录信息（从 tar.gz 中提取，便于展示和搜索）
  fileCount: integer('file_count'),                            // 文件总数
  totalSize: integer('total_size'),                            // 总大小 (bytes)
  fileTree: text('file_tree', { mode: 'json' }).$type<VfsFileEntry[]>(), // 文件目录树

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 5) SANDBOX 节点内容
// 内容：沙盒预览配置（最简单的内容类型）
// ────────────────────────────────────────────────────────────
export const sandboxContents = sqliteTable('sandbox_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  entryFile: text('entry_file').notNull().default('index.html'), // 入口文件路径

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 6) LOADER 节点内容
// 内容：Lua VM 服务执行器配置
// 当前为空（资产 VFS 通过 VFSContent.mounts 管理）
// 保留表结构以便未来扩展
// ────────────────────────────────────────────────────────────
export const loaderContents = sqliteTable('loader_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // 当前无特定字段，预留未来扩展
  // 例如：lua_version, service_config 等

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 7) STATE 节点内容
// 内容：Artifact 中的状态节点，仅存储 SAVE 版本引用列表
// 实际存档元数据（title, description）存储在 save_contents 中
// ────────────────────────────────────────────────────────────
export const stateContents = sqliteTable('state_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // 引用的 SAVE commit 列表（Artifact STATE node 引用作者的存档版本）
  saves: text('saves', { mode: 'json' }).$type<string[]>(),

  refCount: integer('ref_count').default(1).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
});

// ────────────────────────────────────────────────────────────
// 8) SAVE 节点内容（存档元数据）
// 实际 quad 数据存储在 R2: nodes/{nodeId}/{commit}/quads.bin
// ────────────────────────────────────────────────────────────
export const saveContents = sqliteTable('save_contents', {
  contentHash: text('content_hash').primaryKey(),              // SHA-256

  // 关联的 STATE 节点信息
  stateNodeId: text('state_node_id').notNull(),                // 关联的 STATE 节点 ID
  stateNodeCommit: text('state_node_commit').notNull(),        // 关联的 STATE 节点版本 commit
  sourceArtifactCommit: text('source_artifact_commit').notNull(), // 创建此 Save 的 artifact 版本 commit

  title: text('title'),                                        // 存档标题
  description: text('description'),                            // 存档描述

  refCount: integer('ref_count').default(0).notNull(),
  createdAt: text('created_at').default(currentTimestamp).notNull(),
}, (table) => [
  index('idx_save_contents_state_node').on(table.stateNodeId),
]);

// ========================================================================
// R2 大文件存储约定（无需单独的表，URI 从 content_hash 确定性推导）
// ========================================================================
// VFS 文件:     r2://vfs/{content_hash}/files.tar.gz
// State quads:  r2://state/{content_hash}/quads.bin
//
// 使用 content_hash 作为路径天然支持去重：
// 相同内容的 node version 共享同一个 R2 对象，无需额外表记录映射。
// R2 对象的生命周期与对应内容表的 ref_count 一致。

// Type exports
export type InputContent = typeof inputContents.$inferSelect;
export type NewInputContent = typeof inputContents.$inferInsert;
export type PromptContent = typeof promptContents.$inferSelect;
export type NewPromptContent = typeof promptContents.$inferInsert;
export type GeneratedContent = typeof generatedContents.$inferSelect;
export type NewGeneratedContent = typeof generatedContents.$inferInsert;
export type VfsContent = typeof vfsContents.$inferSelect;
export type NewVfsContent = typeof vfsContents.$inferInsert;
export type SandboxContent = typeof sandboxContents.$inferSelect;
export type NewSandboxContent = typeof sandboxContents.$inferInsert;
export type LoaderContent = typeof loaderContents.$inferSelect;
export type NewLoaderContent = typeof loaderContents.$inferInsert;
export type StateContent = typeof stateContents.$inferSelect;
export type NewStateContent = typeof stateContents.$inferInsert;
export type SaveContent = typeof saveContents.$inferSelect;
export type NewSaveContent = typeof saveContents.$inferInsert;
