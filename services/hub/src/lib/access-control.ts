import type { Context } from 'hono';
import type { Env } from '../types';
import type { ApiError } from '@pubwiki/api';
import type { ResourceRef } from '@pubwiki/db/services';

/**
 * 访问控制辅助函数
 */

/**
 * 检查资源读取权限，如果无权限则返回错误响应
 *
 * @param c - Hono Context
 * @param ref - 资源引用
 * @returns 如果有权限返回 null，否则返回错误响应
 *
 * @example
 * ```typescript
 * const error = await checkResourceAccess(c, { type: 'artifact', id: artifactId });
 * if (error) return error;
 * // 继续处理...
 * ```
 */
export async function checkResourceAccess(
  c: Context<{ Bindings: Env }>,
  ref: ResourceRef
): Promise<Response | null> {
  const { canRead } = c.get('resourceAccess');
  const allowed = await canRead(ref);

  if (!allowed) {
    return c.json<ApiError>({ error: 'Access denied' }, 403);
  }

  return null;
}

/**
 * 检查资源写入权限，如果无权限则返回错误响应
 */
export async function checkResourceWriteAccess(
  c: Context<{ Bindings: Env }>,
  ref: ResourceRef
): Promise<Response | null> {
  const { canWrite } = c.get('resourceAccess');
  const allowed = await canWrite(ref);

  if (!allowed) {
    return c.json<ApiError>({ error: 'Access denied' }, 403);
  }

  return null;
}

/**
 * 检查资源管理权限，如果无权限则返回错误响应
 */
export async function checkResourceManageAccess(
  c: Context<{ Bindings: Env }>,
  ref: ResourceRef
): Promise<Response | null> {
  const { canManage, userId } = c.get('resourceAccess');

  if (!userId) {
    return c.json<ApiError>({ error: 'Authentication required' }, 401);
  }

  const allowed = await canManage(ref);

  if (!allowed) {
    return c.json<ApiError>({ error: 'Access denied' }, 403);
  }

  return null;
}

/**
 * 要求必须有管理权限（替代原来的 requireResourceOwner）
 *
 * @param c - Hono Context
 * @param ref - 资源引用
 * @returns 如果有管理权限返回 null，否则返回错误响应
 */
export async function requireResourceOwner(
  c: Context<{ Bindings: Env }>,
  ref: ResourceRef
): Promise<Response | null> {
  return checkResourceManageAccess(c, ref);
}
