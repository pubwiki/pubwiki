import createClient from 'openapi-fetch';
import { createAuthClient as createBetterAuthClient } from 'better-auth/client';
import { usernameClient } from 'better-auth/client/plugins';
import type { paths } from './generated/openapi';

export type { paths };

/**
 * 创建 PubWiki 认证客户端
 * 
 * 使用 Better-Auth 进行认证操作（注册、登录、会话管理）。
 * 登录后 session cookie 会自动管理，OpenAPI 客户端请求 API 时会自动携带认证信息。
 * 
 * @param baseURL - API 基础 URL（不包含 /api 路径），例如 'https://api.pubwiki.com'
 * 
 * @example
 * ```ts
 * import { createAuthClient, createApiClient } from '@pubwiki/api/client';
 * 
 * const authClient = createAuthClient('https://api.pubwiki.com');
 * 
 * // 注册
 * await authClient.signUp.email({
 *   email: 'user@example.com',
 *   password: 'password123',
 *   name: 'User Name',
 *   username: 'username',
 * });
 * 
 * // 使用邮箱登录
 * await authClient.signIn.email({
 *   email: 'user@example.com',
 *   password: 'password123',
 * });
 * 
 * // 使用用户名登录
 * await authClient.signIn.username({
 *   username: 'username',
 *   password: 'password123',
 * });
 * 
 * // 获取当前会话
 * const session = await authClient.getSession();
 * 
 * // 登出
 * await authClient.signOut();
 * ```
 */
export function createAuthClient(baseURL: string) {
  return createBetterAuthClient({
    baseURL,
    basePath: '/api/auth',
    plugins: [
      usernameClient(), // 支持用户名登录
    ],
  });
}

/**
 * 创建 PubWiki API 客户端
 * 
 * 用于调用 PubWiki API（除认证外的所有端点）。
 * 认证请使用 `createAuthClient()`，登录后 session cookie 会自动携带。
 * 
 * @param baseUrl - API 基础 URL（包含 /api 路径），例如 'https://api.pubwiki.com/api'
 * 
 * @example
 * ```ts
 * import { createAuthClient, createApiClient } from '@pubwiki/api/client';
 * 
 * // 1. 先使用 authClient 登录
 * const authClient = createAuthClient('https://api.pubwiki.com');
 * await authClient.signIn.email({ email: 'user@example.com', password: 'password123' });
 * 
 * // 2. 登录后使用 apiClient 调用其他 API
 * const apiClient = createApiClient('https://api.pubwiki.com/api');
 * 
 * // 健康检查（无需认证）
 * const { data, error } = await apiClient.GET('/');
 * 
 * // 获取当前用户（需要已登录）
 * const { data: meData } = await apiClient.GET('/me');
 * 
 * // 创建项目（需要已登录）
 * const { data: project } = await apiClient.POST('/projects', {
 *   body: { name: 'My Project', slug: 'my-project', topic: 'general' },
 * });
 * ```
 */
export function createApiClient(baseUrl: string) {
  return createClient<paths>({
    baseUrl,
    credentials: 'include', // 自动发送 session cookie
  });
}

// 导出 openapi-fetch 的类型
export type { Client } from 'openapi-fetch';
