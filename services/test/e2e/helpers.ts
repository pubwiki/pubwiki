/**
 * E2E 测试辅助函数
 * 使用 @pubwiki/api 的 createAuthClient 进行认证
 */

import { createAuthClient } from '@pubwiki/api/client';

// 存储 cookies 的简单实现
let storedCookies: Map<string, string> = new Map();

/**
 * 自定义 fetch，用于在 Node.js 环境中管理 cookies
 */
function createCookieFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    
    // 添加存储的 cookies
    if (storedCookies.size > 0) {
      const cookieStr = Array.from(storedCookies.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      headers.set('Cookie', cookieStr);
    }
    
    const response = await fetch(input, { ...init, headers });
    
    // 保存响应中的 Set-Cookie
    const setCookie = response.headers.get('Set-Cookie');
    if (setCookie) {
      // 解析 Set-Cookie header
      const cookieParts = setCookie.split(';')[0];
      const [name, value] = cookieParts.split('=');
      if (name && value) {
        storedCookies.set(name.trim(), value.trim());
      }
    }
    
    return response;
  };
}

/**
 * 清除存储的 cookies
 */
export function clearCookies() {
  storedCookies = new Map();
}

/**
 * 获取当前存储的 session cookie 字符串
 */
export function getSessionCookie(): string {
  const sessionToken = storedCookies.get('better-auth.session_token');
  return sessionToken ? `better-auth.session_token=${sessionToken}` : '';
}

/**
 * 通过 Better-Auth 注册用户并返回 session cookie
 * @param baseUrl API 基础 URL (例如 http://localhost:8787/api)
 * @param username 用户名
 * @returns session cookie 字符串和 userId
 */
export async function registerUser(
  baseUrl: string,
  username: string
): Promise<{ sessionCookie: string; userId: string }> {
  // 清除之前的 cookies
  clearCookies();
  
  // 提取 origin（不包含 /api）
  const origin = new URL(baseUrl).origin;
  
  // 创建带自定义 fetch 的 auth client
  const authClient = createAuthClient(origin);
  
  // 使用 better-auth 客户端注册
  // 由于 better-auth/client 在 Node.js 环境中不会自动处理 cookies，
  // 我们直接使用 fetch API
  const response = await fetch(`${baseUrl}/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({
      name: username,
      username,
      email: `${username}@example.com`,
      password: 'password123',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register user: ${response.status} - ${text}`);
  }

  const setCookie = response.headers.get('Set-Cookie') || '';
  const sessionCookie = setCookie.split(';')[0];
  
  // 保存 cookie
  const [name, value] = sessionCookie.split('=');
  if (name && value) {
    storedCookies.set(name.trim(), value.trim());
  }
  
  const data = (await response.json()) as { user: { id: string } };
  
  return {
    sessionCookie,
    userId: data.user.id,
  };
}

/**
 * 通过 Better-Auth 登录并返回 session cookie
 * @param baseUrl API 基础 URL
 * @param email 邮箱
 * @param password 密码
 * @returns session cookie 字符串和 userId
 */
export async function loginUser(
  baseUrl: string,
  email: string,
  password: string
): Promise<{ sessionCookie: string; userId: string }> {
  // 清除之前的 cookies
  clearCookies();
  
  const origin = new URL(baseUrl).origin;
  
  const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to login: ${response.status} - ${text}`);
  }

  const setCookie = response.headers.get('Set-Cookie') || '';
  const sessionCookie = setCookie.split(';')[0];
  
  // 保存 cookie
  const [name, value] = sessionCookie.split('=');
  if (name && value) {
    storedCookies.set(name.trim(), value.trim());
  }
  
  const data = (await response.json()) as { user: { id: string } };
  
  return {
    sessionCookie,
    userId: data.user.id,
  };
}

/**
 * 创建带认证的 fetch 函数
 * @param sessionCookie session cookie 字符串
 * @returns 带 Cookie header 的 fetch 函数
 */
export function createAuthenticatedFetch(sessionCookie: string) {
  return (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Cookie', sessionCookie);
    return fetch(url, { ...init, headers });
  };
}
