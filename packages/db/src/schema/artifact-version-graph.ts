import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

// ========================================================================
// artifact_version_nodes - Artifact 版本的节点组成
// ========================================================================
// 记录 artifact 的某个版本中包含哪些 node 的哪个版本，以及节点在图中的位置
export const artifactVersionNodes = sqliteTable(
  'artifact_version_nodes',
  {
    commitHash: text('commit_hash')
      .notNull(),
    nodeId: text('node_id').notNull(),
    nodeCommit: text('node_commit').notNull(),

    // 节点在此 artifact 中的位置
    positionX: integer('position_x'),
    positionY: integer('position_y'),
  },
  (table) => [
    primaryKey({ columns: [table.commitHash, table.nodeId] }),
    index('idx_artifact_version_nodes_version').on(table.commitHash),
    index('idx_artifact_version_nodes_node').on(table.nodeId, table.nodeCommit),
  ]
);

// ========================================================================
// artifact_version_edges - Artifact 版本的边
// ========================================================================
// 记录 artifact 的某个版本中节点之间的连接关系
export const artifactVersionEdges = sqliteTable(
  'artifact_version_edges',
  {
    commitHash: text('commit_hash')
      .notNull(),
    sourceNodeId: text('source_node_id').notNull(),
    targetNodeId: text('target_node_id').notNull(),
    sourceHandle: text('source_handle'),
    targetHandle: text('target_handle'),
  },
  (table) => [
    primaryKey({
      columns: [
        table.commitHash,
        table.sourceNodeId,
        table.targetNodeId,
      ],
    }),
    index('idx_artifact_version_edges_version').on(table.commitHash),
  ]
);

// Type exports
export type ArtifactVersionNode = typeof artifactVersionNodes.$inferSelect;
export type NewArtifactVersionNode = typeof artifactVersionNodes.$inferInsert;
export type ArtifactVersionEdge = typeof artifactVersionEdges.$inferSelect;
export type NewArtifactVersionEdge = typeof artifactVersionEdges.$inferInsert;
