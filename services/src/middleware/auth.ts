import { createMiddleware } from 'hono/factory';
import type { Env } from '../types';
import { verifyToken, extractToken, createDb, UserService } from '@pubwiki/db';
import type { JwtPayload, ApiError } from '@pubwiki/api';

// 扩展 Hono Context 的类型
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

// 认证中间件 - 必须登录
export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? null;
  const token = extractToken(authHeader);
  
  if (!token) {
    return c.json<ApiError>({ error: 'Authorization token required' }, 401);
  }
  
  const payload = await verifyToken(token, c.env.JWT_SECRET);
  
  if (!payload) {
    return c.json<ApiError>({ error: 'Invalid or expired token' }, 401);
  }
  
  // 验证用户是否存在于数据库中
  const db = createDb(c.env.DB);
  const userService = new UserService(db, c.env.JWT_SECRET);
  const userResult = await userService.getUserById(payload.sub);
  
  if (!userResult.success || !userResult.data) {
    return c.json<ApiError>({ error: 'User not found or has been deleted' }, 401);
  }
  
  // 将用户信息存储到 context 中
  c.set('user', payload);
  
  await next();
});

// 可选认证中间件 - 登录则设置用户信息，不登录也允许继续
export const optionalAuthMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? null;
  const token = extractToken(authHeader);
  
  if (token) {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload) {
      c.set('user', payload);
    }
  }
  
  await next();
});

// 管理员中间件 - 必须是管理员
export const adminMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const user = c.get('user');
  
  if (!user) {
    return c.json<ApiError>({ error: 'Authorization required' }, 401);
  }
  
  if (!user.isAdmin) {
    return c.json<ApiError>({ error: 'Admin access required' }, 403);
  }
  
  await next();
});
