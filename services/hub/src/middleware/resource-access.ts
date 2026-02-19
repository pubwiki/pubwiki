import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { createAuth } from '../lib/auth';
import { createDb, AclService, BatchContext } from '@pubwiki/db';
import type { ResourceRef } from '@pubwiki/db/services';

/**
 * 资源访问控制上下文
 */
export interface ResourceAccessContext {
  /** 当前用户 ID（已登录则有值） */
  userId: string | null;
  /** 请求中的 access token 值 */
  tokenValue: string | null;
  /** ACL 服务实例 */
  aclService: AclService;

  /**
   * 便捷方法：检查单个资源的读取权限
   *
   * @param ref - 资源引用
   * @returns 访问检查结果
   *
   * @example
   * ```typescript
   * const result = await ctx.canRead({ type: 'artifact', id: artifactId });
   * if (!result) {
   *   return c.json({ error: 'Access denied' }, 403);
   * }
   * ```
   */
  canRead(ref: ResourceRef): Promise<boolean>;
  canWrite(ref: ResourceRef): Promise<boolean>;
  canManage(ref: ResourceRef): Promise<boolean>;
}

// 扩展 Hono Context 的类型
declare module 'hono' {
  interface ContextVariableMap {
    resourceAccess: ResourceAccessContext;
  }
}

/**
 * 资源访问控制中间件
 *
 * 职责：
 * - 从请求中提取认证信息（用户 ID、access token）
 * - 创建访问控制服务实例
 * - 提供便捷的 check() 方法
 *
 * 使用方式：
 * ```typescript
 * route.get('/:id', resourceAccessMiddleware, async (c) => {
 *   const { check } = c.get('resourceAccess');
 *   const result = await check({ type: 'artifact', id: c.req.param('id') });
 *   if (!result.allowed) {
 *     return c.json({ error: 'Access denied' }, 403);
 *   }
 *   // ...
 * });
 * ```
 */
export const resourceAccessMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = createAuth(c.env);
  const db = createDb(c.env.DB);
  const batchCtx = new BatchContext(db);
  const aclService = new AclService(batchCtx);

  // 1. 提取用户 ID
  let userId: string | null = null;
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    userId = session.user.id;
  }

  // 2. 提取 access token
  // 支持两种方式：
  // - Query parameter: ?access_token=xxx
  // - Header: X-Access-Token: xxx
  const tokenValue =
    c.req.query('access_token') || c.req.header('X-Access-Token') || null;

  // 3. 构建上下文
  const resourceAccessContext: ResourceAccessContext = {
    userId,
    tokenValue,
    aclService,

    async canRead(ref: ResourceRef) {
      return aclService.canRead(ref, userId ?? undefined);
    },
    async canWrite(ref: ResourceRef) {
      return aclService.canWrite(ref, userId ?? undefined);
    },
    async canManage(ref: ResourceRef) {
      return aclService.canManage(ref, userId ?? undefined);
    },
  };

  c.set('resourceAccess', resourceAccessContext);
  await next();
});

/**
 * 从请求上下文中获取访问控制上下文
 * 用于需要手动处理的场景
 */
export function getResourceAccessContext(c: { get: (key: 'resourceAccess') => ResourceAccessContext }): ResourceAccessContext {
  return c.get('resourceAccess');
}
