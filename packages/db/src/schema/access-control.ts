// ========================================================================
// 资源类型枚举
// ========================================================================
export const RESOURCE_TYPES = ['artifact', 'node', 'project', 'article', 'save'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

