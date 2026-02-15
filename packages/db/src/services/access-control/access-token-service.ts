import { eq, and, sql } from 'drizzle-orm';
import type { Database } from '../../client';
import { resourceAccessTokens } from '../../schema/access-tokens';
import type { ResourceRef } from './acl-service';
import type { ResourceType } from './index';

/**
 * 创建 Token 参数
 */
export interface CreateTokenParams {
  ref: ResourceRef;
  createdBy: string;
  expiresAt?: Date;
  usageLimit?: number;
  label?: string;
}

/**
 * Token 信息
 */
export interface AccessTokenInfo {
  id: string;
  resourceType: ResourceType;
  resourceId: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  usageLimit: number | null;
  usageCount: number;
  label: string | null;
}``

/**
 * 生成安全的随机 token
 */
function generateSecureToken(): string {
  // 使用 crypto.randomUUID() 生成基础随机值
  // 然后转换为更紧凑的格式
  const uuid1 = crypto.randomUUID().replace(/-/g, '');
  const uuid2 = crypto.randomUUID().replace(/-/g, '');
  return `${uuid1}${uuid2}`.substring(0, 48);
}

/**
 * AccessTokenService - 访问令牌服务实现
 *
 * Token 只授予只读访问权限，无需复杂的权限系统
 *
 * 职责：
 * - Token 的 CRUD 操作
 * - Token 验证（包括过期和使用次数检查）
 * - Token 使用计数更新
 */
export class AccessTokenService {
  constructor(private db: Database) {}

  /**
   * 创建新的访问令牌
   */
  async create(params: CreateTokenParams): Promise<{ token: string; id: string }> {
    const id = crypto.randomUUID();
    const token = generateSecureToken();

    await this.db.insert(resourceAccessTokens).values({
      id,
      resourceType: params.ref.type,
      resourceId: params.ref.id,
      token,
      createdBy: params.createdBy,
      expiresAt: params.expiresAt?.toISOString() ?? null,
      usageLimit: params.usageLimit ?? null,
      usageCount: 0,
      label: params.label ?? null,
    });

    return { token, id };
  }

  /**
   * 验证 token 是否有效
   *
   * 检查项：
   * 1. Token 是否存在
   * 2. 是否匹配预期的资源（如果指定）
   * 3. 是否已过期
   * 4. 是否已超过使用次数限制
   *
   * 如果验证通过，会异步增加使用计数
   */
  async validate(tokenValue: string, expectedRef?: ResourceRef): Promise<AccessTokenInfo | null> {
    const [result] = await this.db
      .select()
      .from(resourceAccessTokens)
      .where(eq(resourceAccessTokens.token, tokenValue))
      .limit(1);

    if (!result) return null;

    // 检查资源匹配
    if (
      expectedRef &&
      (result.resourceType !== expectedRef.type || result.resourceId !== expectedRef.id)
    ) {
      return null;
    }

    // 检查过期
    if (result.expiresAt && new Date(result.expiresAt) < new Date()) {
      return null;
    }

    // 检查使用次数
    if (result.usageLimit && result.usageCount >= result.usageLimit) {
      return null;
    }

    // 更新使用计数（异步，不阻塞返回）
    this.incrementUsageCount(result.id).catch(console.error);

    return this.toTokenInfo(result);
  }

  /**
   * 增加使用计数
   */
  private async incrementUsageCount(tokenId: string): Promise<void> {
    await this.db
      .update(resourceAccessTokens)
      .set({
        usageCount: sql`${resourceAccessTokens.usageCount} + 1`,
      })
      .where(eq(resourceAccessTokens.id, tokenId));
  }

  /**
   * 撤销（删除）token
   * 只有创建者才能撤销 token
   */
  async revoke(tokenId: string, ownerId: string): Promise<boolean> {
    const result = await this.db
      .delete(resourceAccessTokens)
      .where(
        and(
          eq(resourceAccessTokens.id, tokenId),
          eq(resourceAccessTokens.createdBy, ownerId)
        )
      )
      .returning({ id: resourceAccessTokens.id });

    return result.length > 0;
  }

  /**
   * 列出某用户创建的所有 token
   */
  async listByOwner(ownerId: string): Promise<AccessTokenInfo[]> {
    const results = await this.db
      .select()
      .from(resourceAccessTokens)
      .where(eq(resourceAccessTokens.createdBy, ownerId));

    return results.map(this.toTokenInfo);
  }

  /**
   * 列出某资源的所有 token
   */
  async listByResource(ref: ResourceRef): Promise<AccessTokenInfo[]> {
    const results = await this.db
      .select()
      .from(resourceAccessTokens)
      .where(
        and(
          eq(resourceAccessTokens.resourceType, ref.type),
          eq(resourceAccessTokens.resourceId, ref.id)
        )
      );

    return results.map(this.toTokenInfo);
  }

  /**
   * 转换数据库记录为 TokenInfo
   */
  private toTokenInfo(row: typeof resourceAccessTokens.$inferSelect): AccessTokenInfo {
    return {
      id: row.id,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      token: row.token,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      usageLimit: row.usageLimit,
      usageCount: row.usageCount,
      label: row.label,
    };
  }
}
