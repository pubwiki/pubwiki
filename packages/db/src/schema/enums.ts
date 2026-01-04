// D1 (SQLite) 不支持原生枚举类型，使用 text 字段配合 TypeScript 类型
// 这些类型用于类型检查，实际存储为字符串

// Artifact 类型
export const ARTIFACT_TYPES = ['RECIPE', 'GAME', 'ASSET_PACK', 'PROMPT'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// 可见性类型
export const VISIBILITY_TYPES = ['PUBLIC', 'PRIVATE', 'UNLISTED'] as const;
export type VisibilityType = (typeof VISIBILITY_TYPES)[number];

// Lineage 类型
export const LINEAGE_TYPES = ['DEPENDS_ON', 'FORKED_FROM', 'INSPIRED_BY', 'GENERATED_BY'] as const;
export type LineageType = (typeof LINEAGE_TYPES)[number];

// 讨论分类
export const DISCUSSION_CATEGORIES = ['QUESTION', 'FEEDBACK', 'BUG_REPORT', 'FEATURE_REQUEST', 'GENERAL'] as const;
export type DiscussionCategory = (typeof DISCUSSION_CATEGORIES)[number];

// 讨论目标类型 (多态关联)
export const DISCUSSION_TARGET_TYPES = ['ARTIFACT', 'PROJECT', 'POST'] as const;
export type DiscussionTargetType = (typeof DISCUSSION_TARGET_TYPES)[number];

// 运行状态
export const RUN_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

// 通知类型
export const NOTIFICATION_TYPES = ['STAR', 'FORK', 'COMMENT', 'REPLY', 'MENTION', 'FOLLOW', 'SYSTEM'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// 协作者角色
export const COLLABORATOR_ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

// Artifact Node 类型
export const ARTIFACT_NODE_TYPES = ['PROMPT', 'INPUT', 'GENERATED', 'VFS', 'STATE', 'LOADER', 'SANDBOX'] as const;
export type ArtifactNodeType = (typeof ARTIFACT_NODE_TYPES)[number];
