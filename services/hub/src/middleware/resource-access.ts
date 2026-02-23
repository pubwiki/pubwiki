import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { createAuth } from '../lib/auth';
import { createDb, AclService, BatchContext, AccessTokenService } from '@pubwiki/db';
import type { ResourceRef } from '@pubwiki/db/services';
import type { SessionUser, SessionData } from './auth';

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
 * - 设置 user 和 session 上下文变量（同时包含 optionalAuthMiddleware 功能）
 * - 创建访问控制服务实例
 * - 提供便捷的 canRead/canWrite/canManage 方法
 *
 * 注意：此中间件内部包含了 optionalAuthMiddleware 的功能，
 * 使用此中间件时不需要额外添加 optionalAuthMiddleware。
 *
 * 使用方式：
 * ```typescript
 * route.get('/:id', resourceAccessMiddleware, async (c) => {
 *   const { canRead } = c.get('resourceAccess');
 *   const allowed = await canRead({ type: 'artifact', id: c.req.param('id') });
 *   if (!allowed) {
 *     return c.json({ error: 'Access denied' }, 403);
 *   }
 *   // user is also available if logged in
 *   const user = c.get('user'); // may be undefined
 *   // ...
 * });
 * ```
 */
export const resourceAccessMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = createAuth(c.env);
  const db = createDb(c.env.DB);
  const batchCtx = new BatchContext(db);
  const aclService = new AclService(batchCtx);
  const accessTokenService = new AccessTokenService(db);

  // 1. 提取用户信息（同时实现 optionalAuthMiddleware 的功能）
  let userId: string | null = null;
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (session?.user) {
    userId = session.user.id;
    // Also set user and session for routes that need them
    // This makes optionalAuthMiddleware redundant when using resourceAccessMiddleware
    c.set('user', session.user as SessionUser);
    c.set('session', session.session as SessionData);
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
      // 先检查用户 ACL 权限
      const hasAclPermission = await aclService.canRead(ref, userId ?? undefined);
      if (hasAclPermission) return true;

      // 如果没有 ACL 权限，检查 access token
      // Access token 只授予读取权限
      if (tokenValue) {
        const tokenInfo = await accessTokenService.validate(tokenValue, ref);
        if (tokenInfo) return true;
      }

      return false;
    },
    async canWrite(ref: ResourceRef) {
      // Access token 不授予写入权限，只检查 ACL
      return aclService.canWrite(ref, userId ?? undefined);
    },
    async canManage(ref: ResourceRef) {
      // Access token 不授予管理权限，只检查 ACL
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
