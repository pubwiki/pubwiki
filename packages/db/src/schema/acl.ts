import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';
import type { ResourceType } from '../services/access-control';

// 当前时间戳 (ISO 格式字符串)
const currentTimestamp = sql`(datetime('now'))`;

// ========================================================================
// 常量
// ========================================================================

/**
 * 公开用户 ID 常量
 * 当 userId = '*' 时，表示公开访问权限（所有人）
 * 等价于原 isPrivate = false
 */
export const PUBLIC_USER_ID = '*';

// ========================================================================
// resource_acl - 资源访问控制列表
// ========================================================================
// ACL 统一管理所有资源的访问权限
//
// 权限位：
//   canRead: 访问资源内容（查看私有 artifact、读取内容）
//   canWrite: 编辑资源（更新 artifact、发布新版本）
//   canManage: 管理资源（删除资源、修改 ACL、修改 isListed）
//
// 特殊 userId:
//   '*': 公开（所有人），等价于原 isPrivate = false
//   具体 UUID: 特定用户
//
// 角色映射（前端展示用）:
//   Owner: manage + write + read（创建者，创建时自动授予）
//   Admin: manage + write + read（管理员，无法撤销 owner）
//   Editor: write + read（可编辑）
//   Viewer: read（只读）
export const resourceAcl = sqliteTable(
  'resource_acl',
  {
    // 复合主键：资源类型 + 资源ID + 用户ID
    resourceType: text('resource_type').$type<ResourceType>().notNull(),
    // FIXME: Make sure that for versioned content, this refers to a specific commit rather than
    // its id, for example, nodes, saves and artifacts
    resourceId: text('resource_id').notNull(),
    userId: text('user_id').notNull(),  // '*' = public

    // 权限位：可独立授予
    canRead: integer('can_read', { mode: 'boolean' }).default(false).notNull(),
    canWrite: integer('can_write', { mode: 'boolean' }).default(false).notNull(),
    canManage: integer('can_manage', { mode: 'boolean' }).default(false).notNull(),

    // 授权者（谁授予了这个权限）
    grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' }),
    
    // 元数据
    createdAt: text('created_at').default(currentTimestamp).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.resourceType, table.resourceId, table.userId] }),
    index('idx_acl_user').on(table.userId),
    index('idx_acl_resource').on(table.resourceType, table.resourceId),
  ]
);

// Type exports
export type ResourceAclRecord = typeof resourceAcl.$inferSelect;
export type NewResourceAclRecord = typeof resourceAcl.$inferInsert;

// ========================================================================
// 辅助类型
// ========================================================================

/**
 * ACL 权限类型
 */
export type AclPermission = 'read' | 'write' | 'manage';

/**
 * 权限组合（用于授权）
 */
export interface AclPermissions {
  read?: boolean;
  write?: boolean;
  manage?: boolean;
}
