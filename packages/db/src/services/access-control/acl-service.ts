import { eq, and } from 'drizzle-orm';
import type { BatchContext } from '../../batch-context';
import { resourceAcl, PUBLIC_USER_ID, type AclPermission, type AclPermissions } from '../../schema/acl';
import { resourceDiscoveryControl } from '../../schema/discovery-control';
import type { ResourceType } from './index';

// ========================================================================
// 类型定义
// ========================================================================

/**
 * 资源引用
 */
export interface ResourceRef {
  type: ResourceType;
  id: string;
}

/**
 * 访问检查结果
 */
export interface AccessCheckResult {
  allowed: boolean;
  reason: 'public' | 'acl' | 'inherited' | 'denied';
}

/**
 * ACL 记录（查询结果）
 */
export interface AclRecord {
  userId: string;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
  grantedBy: string | null;
  createdAt: string;
}

// ========================================================================
// AclService - ACL 访问控制服务
// ========================================================================

/**
 * ACL 服务实现
 *
 * 职责：
 * - ACL 记录的 CRUD
 * - 权限检查（包括公开权限和继承权限）
 * - 公开/私有状态管理
 */
export class AclService {
  constructor(private ctx: BatchContext) {}

  // ========================================================================
  // 公开/私有管理
  // ========================================================================

  /**
   * 设置公开读取权限（等价于原 isPrivate = false）
   */
  // FIXME: if an artifact is set to public, its nodes should be set to public
  // accordingly
  setPublic(ref: ResourceRef, grantedBy: string): void {
    this.ctx.modify()
      .insert(resourceAcl)
      .values({
        resourceType: ref.type,
        resourceId: ref.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy,
      })
      .onConflictDoUpdate({
        target: [resourceAcl.resourceType, resourceAcl.resourceId, resourceAcl.userId],
        set: { canRead: true },
      });
  }

  /**
   * 移除公开读取权限（等价于原 isPrivate = true）
   */
  setPrivate(ref: ResourceRef): void {
    this.ctx.modify()
      .delete(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id),
          eq(resourceAcl.userId, PUBLIC_USER_ID)
        )
      );
  }

  /**
   * 检查是否公开
   */
  async isPublic(ref: ResourceRef): Promise<boolean> {
    const result = await this.ctx
      .select({ canRead: resourceAcl.canRead })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id),
          eq(resourceAcl.userId, PUBLIC_USER_ID)
        )
      )
      .limit(1);

    return result.length > 0 && result[0].canRead;
  }

  // ========================================================================
  // ACL CRUD
  // ========================================================================

  /**
   * 授予用户权限
   */
  grant(
    ref: ResourceRef,
    userId: string,
    permissions: AclPermissions,
    grantedBy: string
  ): void {
    this.ctx.modify()
      .insert(resourceAcl)
      .values({
        resourceType: ref.type,
        resourceId: ref.id,
        userId,
        canRead: permissions.read ?? false,
        canWrite: permissions.write ?? false,
        canManage: permissions.manage ?? false,
        grantedBy,
      })
      .onConflictDoUpdate({
        target: [resourceAcl.resourceType, resourceAcl.resourceId, resourceAcl.userId],
        set: {
          canRead: permissions.read ?? false,
          canWrite: permissions.write ?? false,
          canManage: permissions.manage ?? false,
        },
      });
  }

  /**
   * 授予 owner 权限（创建资源时使用）
   */
  grantOwner(ref: ResourceRef, userId: string): void {
    this.grant(ref, userId, { read: true, write: true, manage: true }, userId);
  }

  /**
   * 撤销用户权限
   */
  revoke(ref: ResourceRef, userId: string): void {
    this.ctx.modify()
      .delete(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id),
          eq(resourceAcl.userId, userId)
        )
      );
  }

  /**
   * 获取用户的 ACL 记录
   */
  async getAcl(ref: ResourceRef, userId: string): Promise<AclRecord | null> {
    const result = await this.ctx
      .select({
        userId: resourceAcl.userId,
        canRead: resourceAcl.canRead,
        canWrite: resourceAcl.canWrite,
        canManage: resourceAcl.canManage,
        grantedBy: resourceAcl.grantedBy,
        createdAt: resourceAcl.createdAt,
      })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id),
          eq(resourceAcl.userId, userId)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * 获取资源的所有 ACL 记录
   */
  async listAcls(ref: ResourceRef): Promise<AclRecord[]> {
    return this.ctx
      .select({
        userId: resourceAcl.userId,
        canRead: resourceAcl.canRead,
        canWrite: resourceAcl.canWrite,
        canManage: resourceAcl.canManage,
        grantedBy: resourceAcl.grantedBy,
        createdAt: resourceAcl.createdAt,
      })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id)
        )
      );
  }

  /**
   * 删除资源的所有 ACL 记录
   */
  deleteAllAcls(ref: ResourceRef): void {
    this.ctx.modify()
      .delete(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, ref.type),
          eq(resourceAcl.resourceId, ref.id)
        )
      );
  }

  // ========================================================================
  // 权限检查
  // ========================================================================

  /**
   * 检查用户是否有指定权限
   */
  async checkPermission(
    ref: ResourceRef,
    userId: string | undefined,
    permission: AclPermission
  ): Promise<AccessCheckResult> {
    // 1. 检查公开权限（user_id = '*'）
    const publicAcl = await this.getAcl(ref, PUBLIC_USER_ID);
    if (publicAcl && this.hasPermission(publicAcl, permission)) {
      return { allowed: true, reason: 'public' };
    }

    // 2. 检查用户直接权限
    if (userId) {
      const userAcl = await this.getAcl(ref, userId);
      if (userAcl && this.hasPermission(userAcl, permission)) {
        return { allowed: true, reason: 'acl' };
      }
    }

    return { allowed: false, reason: 'denied' };
  }

  /**
   * 检查用户是否有读取权限
   */
  async canRead(ref: ResourceRef, userId: string | undefined): Promise<boolean> {
    const result = await this.checkPermission(ref, userId, 'read');
    return result.allowed;
  }

  /**
   * 检查用户是否有写入权限
   */
  async canWrite(ref: ResourceRef, userId: string | undefined): Promise<boolean> {
    const result = await this.checkPermission(ref, userId, 'write');
    return result.allowed;
  }

  /**
   * 检查用户是否有管理权限
   */
  async canManage(ref: ResourceRef, userId: string | undefined): Promise<boolean> {
    const result = await this.checkPermission(ref, userId, 'manage');
    return result.allowed;
  }

  // ========================================================================
  // 私有辅助方法
  // ========================================================================

  private hasPermission(acl: AclRecord, permission: AclPermission): boolean {
    switch (permission) {
      case 'read':
        return acl.canRead;
      case 'write':
        return acl.canWrite;
      case 'manage':
        return acl.canManage;
    }
  }
}

// ========================================================================
// DiscoveryService - 资源可发现性服务
// ========================================================================

/**
 * 资源可发现性服务
 *
 * 职责：
 * - 管理 isListed 状态
 * - 与 ACL 完全分离，列表操作只关心 isListed
 */
export class DiscoveryService {
  constructor(private ctx: BatchContext) {}

  /**
   * 创建资源发现控制记录
   */
  create(ref: ResourceRef, isListed: boolean = false): void {
    this.ctx.modify()
      .insert(resourceDiscoveryControl)
      .values({
        resourceType: ref.type,
        resourceId: ref.id,
        isListed,
      })
      .onConflictDoNothing();
  }

  /**
   * 获取资源发现控制记录
   */
  async get(ref: ResourceRef): Promise<{ isListed: boolean } | null> {
    const result = await this.ctx
      .select({ isListed: resourceDiscoveryControl.isListed })
      .from(resourceDiscoveryControl)
      .where(
        and(
          eq(resourceDiscoveryControl.resourceType, ref.type),
          eq(resourceDiscoveryControl.resourceId, ref.id)
        )
      )
      .limit(1);

    return result[0] ?? null;
  }

  /**
   * 设置 isListed 状态
   */
  setListed(ref: ResourceRef, isListed: boolean): void {
    this.ctx.modify()
      .update(resourceDiscoveryControl)
      .set({ isListed, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(resourceDiscoveryControl.resourceType, ref.type),
          eq(resourceDiscoveryControl.resourceId, ref.id)
        )
      );
  }

  /**
   * 删除资源发现控制记录
   */
  delete(ref: ResourceRef): void {
    this.ctx.modify()
      .delete(resourceDiscoveryControl)
      .where(
        and(
          eq(resourceDiscoveryControl.resourceType, ref.type),
          eq(resourceDiscoveryControl.resourceId, ref.id)
        )
      );
  }

  /**
   * 检查资源是否列出
   */
  async isListed(ref: ResourceRef): Promise<boolean> {
    const record = await this.get(ref);
    return record?.isListed ?? false;
  }
}
