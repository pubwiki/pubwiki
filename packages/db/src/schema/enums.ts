// D1 (SQLite) 不支持原生枚举类型，使用 text 字段配合 TypeScript 类型
// 这些类型用于类型检查，实际存储为字符串

/**
 * @deprecated 使用 resource_access_control 表中的 isPrivate + isListed 替代
 * - PUBLIC → isPrivate=false, isListed=true
 * - PRIVATE → isPrivate=true, isListed=false
 * - UNLISTED → isPrivate=false, isListed=false
 */
export const VISIBILITY_TYPES = ['PUBLIC', 'PRIVATE', 'UNLISTED'] as const;
/** @deprecated Use AccessControl (isPrivate + isListed) instead */
export type VisibilityType = (typeof VISIBILITY_TYPES)[number];

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

// Artifact Node 类型（仅用于 artifact 创建时的类型校验）
export const ARTIFACT_NODE_TYPES = ['PROMPT', 'INPUT', 'GENERATED', 'VFS', 'STATE', 'LOADER', 'SANDBOX'] as const;
export type ArtifactNodeType = (typeof ARTIFACT_NODE_TYPES)[number];

// Node 类型（node_versions.type 字段的类型约束，包含 SAVE）
export const NODE_TYPES = [...ARTIFACT_NODE_TYPES, 'SAVE'] as const;
export type NodeType = (typeof NODE_TYPES)[number];
