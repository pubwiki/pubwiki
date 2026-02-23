import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { createAuth } from '../lib/auth';
import type { ApiError } from '@pubwiki/api';

// Better-Auth session 中的 user 类型
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  username: string;
  bio: string | null;
  website: string | null;
  location: string | null;
  isVerified: boolean;
};

// Better-Auth session 类型
export type SessionData = {
  id: string;
  expiresAt: Date;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
};

// 扩展 Hono Context 的类型
declare module 'hono' {
  interface ContextVariableMap {
    user: SessionUser;
    session: SessionData;
  }
}

// 认证中间件 - 必须登录
export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (!session) {
    return c.json<ApiError>({ error: 'Authorization required' }, 401);
  }
  
  c.set('user', session.user as SessionUser);
  c.set('session', session.session as SessionData);
  
  await next();
});

// 可选认证中间件 - 登录则设置用户信息，不登录也允许继续
export const optionalAuthMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  
  if (session) {
    c.set('user', session.user as SessionUser);
    c.set('session', session.session as SessionData);
  }
  
  await next();
});

