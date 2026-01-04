import createClient from 'openapi-fetch';
import type { paths } from './generated/openapi';

export type { paths };

/**
 * 创建 PubWiki API 客户端
 * 
 * @example
 * ```ts
 * import { createApiClient } from '@pubwiki/api/client';
 * 
 * const client = createApiClient('https://api.pubwiki.com');
 * 
 * // 健康检查
 * const { data, error } = await client.GET('/');
 * 
 * // 注册
 * const { data, error } = await client.POST('/auth/register', {
 *   body: {
 *     username: 'testuser',
 *     email: 'test@example.com',
 *     password: 'password123',
 *   },
 * });
 * 
 * // 登录
 * const { data, error } = await client.POST('/auth/login', {
 *   body: {
 *     usernameOrEmail: 'testuser',
 *     password: 'password123',
 *   },
 * });
 * 
 * // 获取当前用户（需要认证）
 * const authenticatedClient = createApiClient('https://api.pubwiki.com', token);
 * const { data, error } = await authenticatedClient.GET('/me');
 * ```
 */
export function createApiClient(baseUrl: string, token?: string) {
  return createClient<paths>({
    baseUrl,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

/**
 * 创建带认证的 API 客户端
 */
export function createAuthenticatedClient(baseUrl: string, token: string) {
  return createApiClient(baseUrl, token);
}

// 导出 openapi-fetch 的类型
export type { Client } from 'openapi-fetch';
