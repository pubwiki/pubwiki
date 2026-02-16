import { sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { NodeType } from './enums';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// node_versions - 节点版本表 (核心)
// ========================================================================
// 版本历史为树结构：每个 commit 有单个 parent，但可以有多个 children（fork）
// 导入时保留原 node_id，parent 直接指向原 commit，版本树跨 artifact 连续
//
// commit 是全局唯一的（通过确定性算法 hash(nodeId, parent, contentHash, type) 生成），
// 因此可以仅通过 commit 定位一个版本，无需 nodeId 配合。
//
// content_hash + type 组合确定去哪张内容表查询：
//   INPUT -> input_contents, PROMPT -> prompt_contents,
//   GENERATED -> generated_contents, VFS -> vfs_contents,
//   SANDBOX -> sandbox_contents, LOADER -> loader_contents,
//   STATE -> state_contents
//
// 访问控制通过 resource_access_control 表管理 (isPrivate + isListed)
export const nodeVersions = sqliteTable(
  'node_versions',
  {
    nodeId: text('node_id').notNull(),
    commit: text('commit').notNull(),                       // 全局唯一，hash(nodeId, parent, contentHash, type) 前16位hex

    // 版本关系（树结构，跨 artifact 连续）
    parent: text('parent'),                                 // 父 commit（可为空表示根节点）

    // 作者
    authorId: text('author_id')
      .notNull()
      .references(() => user.id),

    authoredAt: text('authored_at').default(currentTimestamp).notNull(),

    // 内容引用（根据 type 字段查对应的 xxx_contents 表）
    type: text('type').$type<NodeType>().notNull(),  // NodeType: INPUT|PROMPT|GENERATED|VFS|SANDBOX|LOADER|STATE|SAVE
    name: text('name'),
    contentHash: text('content_hash').notNull(),             // 引用 {type}_contents 表的 content_hash

    // 谱系追踪
    sourceArtifactId: text('source_artifact_id').notNull(),   // 创建该版本的 artifact ID
    derivativeOf: text('derivative_of'),                      // 跳表指针：版本树中首个 sourceArtifact 不同的祖先 commit

    // 元数据
    message: text('message'),
    tag: text('tag'),                                        // Semver tag (可选)
  },
  (table) => [
    primaryKey({ columns: [table.commit] }),
    index('idx_node_versions_node').on(table.nodeId),
    index('idx_node_versions_author').on(table.authorId),
    index('idx_node_versions_content').on(table.type, table.contentHash),
    index('idx_node_versions_tag').on(table.nodeId, table.tag),
    index('idx_node_versions_parent').on(table.parent),
    index('idx_node_versions_source_artifact').on(table.sourceArtifactId),
  ]
);

// ========================================================================
// node_version_refs - 节点版本间引用关系表（谱系追踪）
// ========================================================================
// 记录版本之间的引用关系，主要用于 GENERATED 节点的生成谱系。
// 一个版本可以引用多个其他版本（如同时引用 input + 多个 prompt）。
//
// 这些引用是版本级别的关系，不属于内容（不参与 content_hash 计算），
// 因为相同的 AI 生成文本可能出现在不同的谱系上下文中。
//
// ref_type 枚举说明：
//   input          - GENERATED 的触发输入（INPUT 节点版本）
//   prompt         - GENERATED 直接引用的提示词（PROMPT 节点版本）
//   indirect_prompt - GENERATED 间接引用的提示词
//   input_vfs      - 生成前的 VFS 快照引用（文件修改场景）
//   output_vfs     - 生成后关联的 VFS 节点版本（文件创建/修改输出）
export const NODE_VERSION_REF_TYPES = ['input', 'prompt', 'indirect_prompt', 'input_vfs', 'output_vfs'] as const;
export type NodeVersionRefType = (typeof NODE_VERSION_REF_TYPES)[number];

export const nodeVersionRefs = sqliteTable(
  'node_version_refs',
  {
    // 引用的发起方 commit（通常是 GENERATED 节点的某个版本）
    sourceCommit: text('source_commit').notNull(),

    // 被引用的版本 commit
    targetCommit: text('target_commit').notNull(),

    // 引用类型
    refType: text('ref_type').$type<NodeVersionRefType>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceCommit, table.targetCommit, table.refType],
    }),
    index('idx_node_version_refs_source').on(table.sourceCommit),
    index('idx_node_version_refs_target').on(table.targetCommit),
  ]
);

// Type exports
export type NodeVersion = typeof nodeVersions.$inferSelect;
export type NewNodeVersion = typeof nodeVersions.$inferInsert;
export type NodeVersionRef = typeof nodeVersionRefs.$inferSelect;
export type NewNodeVersionRef = typeof nodeVersionRefs.$inferInsert;
