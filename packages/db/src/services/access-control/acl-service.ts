import { eq, and } from 'drizzle-orm';
import type { Database } from '../../client';
import { resourceAcl, PUBLIC_USER_ID, type AclPermission, type AclPermissions } from '../../schema/acl';
import { resourceDiscoveryControl } from '../../schema/discovery-control';
import type { ResourceType } from './index';
import { projectArtifacts } from '../../schema/projects';
import { articles } from '../../schema/articles';
import { nodeVersions } from '../../schema/node-versions';

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
  constructor(private db: Database) {}

  // ========================================================================
  // 公开/私有管理
  // ========================================================================

  /**
   * 设置公开读取权限（等价于原 isPrivate = false）
   */
  async setPublic(ref: ResourceRef, grantedBy: string): Promise<void> {
    await this.db
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
  async setPrivate(ref: ResourceRef): Promise<void> {
    await this.db
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
    const result = await this.db
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
  async grant(
    ref: ResourceRef,
    userId: string,
    permissions: AclPermissions,
    grantedBy: string
  ): Promise<void> {
    await this.db
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
  async grantOwner(ref: ResourceRef, userId: string): Promise<void> {
    await this.grant(ref, userId, { read: true, write: true, manage: true }, userId);
  }

  /**
   * 撤销用户权限
   */
  async revoke(ref: ResourceRef, userId: string): Promise<void> {
    await this.db
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
    const result = await this.db
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
    return this.db
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
  async deleteAllAcls(ref: ResourceRef): Promise<void> {
    await this.db
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

      // 3. 检查继承权限
      const inheritedResult = await this.checkInheritedPermission(ref, userId, permission);
      if (inheritedResult.allowed) {
        return inheritedResult;
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

  /**
   * 获取用户在资源上的有效权限
   */
  async getEffectivePermissions(
    ref: ResourceRef,
    userId: string | undefined
  ): Promise<{ canRead: boolean; canWrite: boolean; canManage: boolean }> {
    // 公开权限
    const publicAcl = await this.getAcl(ref, PUBLIC_USER_ID);
    let canRead = publicAcl?.canRead ?? false;
    let canWrite = publicAcl?.canWrite ?? false;
    let canManage = publicAcl?.canManage ?? false;

    // 用户直接权限
    if (userId) {
      const userAcl = await this.getAcl(ref, userId);
      if (userAcl) {
        canRead = canRead || userAcl.canRead;
        canWrite = canWrite || userAcl.canWrite;
        canManage = canManage || userAcl.canManage;
      }

      // 继承权限
      const inherited = await this.getInheritedPermissions(ref, userId);
      canRead = canRead || inherited.canRead;
      canWrite = canWrite || inherited.canWrite;
      canManage = canManage || inherited.canManage;
    }

    return { canRead, canWrite, canManage };
  }

  // ========================================================================
  // 权限继承
  // ========================================================================

  /**
   * 检查继承权限
   *
   * 继承链：
   * - Article → Artifact
   * - Node → Artifact
   * - Save → Artifact
   * - Artifact → Project (通过 project_artifacts)
   */
  private async checkInheritedPermission(
    ref: ResourceRef,
    userId: string,
    permission: AclPermission
  ): Promise<AccessCheckResult> {
    const parentRef = await this.getParentResource(ref);
    if (!parentRef) {
      return { allowed: false, reason: 'denied' };
    }

    // 检查父资源权限
    const parentResult = await this.checkPermission(parentRef, userId, permission);
    if (parentResult.allowed) {
      return { allowed: true, reason: 'inherited' };
    }

    return { allowed: false, reason: 'denied' };
  }

  /**
   * 获取继承的权限
   */
  private async getInheritedPermissions(
    ref: ResourceRef,
    userId: string
  ): Promise<{ canRead: boolean; canWrite: boolean; canManage: boolean }> {
    const parentRef = await this.getParentResource(ref);
    if (!parentRef) {
      return { canRead: false, canWrite: false, canManage: false };
    }

    return this.getEffectivePermissions(parentRef, userId);
  }

  /**
   * 获取父资源引用（用于权限继承）
   */
  private async getParentResource(ref: ResourceRef): Promise<ResourceRef | null> {
    switch (ref.type) {
      case 'article':
        return this.getArticleParent(ref.id);
      case 'node':
        return this.getNodeParent(ref.id);
      case 'save':
        return this.getSaveParent(ref.id);
      case 'artifact':
        return this.getArtifactParent(ref.id);
      default:
        return null;
    }
  }

  /**
   * 获取 Article 的父 Artifact
   */
  private async getArticleParent(articleId: string): Promise<ResourceRef | null> {
    const result = await this.db
      .select({ artifactId: articles.artifactId })
      .from(articles)
      .where(eq(articles.id, articleId))
      .limit(1);

    if (result.length === 0 || !result[0].artifactId) {
      return null;
    }

    return { type: 'artifact', id: result[0].artifactId };
  }

  /**
   * 获取 Node 的父 Artifact
   * Node 通过 node_versions.sourceArtifactId 关联到 artifact
   */
  private async getNodeParent(nodeId: string): Promise<ResourceRef | null> {
    const result = await this.db
      .select({ sourceArtifactId: nodeVersions.sourceArtifactId })
      .from(nodeVersions)
      .where(eq(nodeVersions.nodeId, nodeId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return { type: 'artifact', id: result[0].sourceArtifactId };
  }

  /**
   * 获取 Save 的父 Artifact
   * Save 表中有 artifactId 字段
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async getSaveParent(saveId: string): Promise<ResourceRef | null> {
    // Save 表结构需要确认，这里假设有 saves 表
    // 如果没有，返回 null
    return null;
  }

  /**
   * 获取 Artifact 的父 Project
   */
  private async getArtifactParent(artifactId: string): Promise<ResourceRef | null> {
    const result = await this.db
      .select({ projectId: projectArtifacts.projectId })
      .from(projectArtifacts)
      .where(eq(projectArtifacts.artifactId, artifactId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return { type: 'project', id: result[0].projectId };
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
  constructor(private db: Database) {}

  /**
   * 创建资源发现控制记录
   */
  async create(ref: ResourceRef, isListed: boolean = false): Promise<void> {
    await this.db
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
    const result = await this.db
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
  async setListed(ref: ResourceRef, isListed: boolean): Promise<void> {
    await this.db
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
  async delete(ref: ResourceRef): Promise<void> {
    await this.db
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
