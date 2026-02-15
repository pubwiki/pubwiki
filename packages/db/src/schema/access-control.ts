import { sql } from 'drizzle-orm';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// 资源类型枚举
// ========================================================================
export const RESOURCE_TYPES = ['artifact', 'node', 'project', 'article', 'save'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

