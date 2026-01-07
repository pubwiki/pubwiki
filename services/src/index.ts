import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { auth } from './routes/auth';
import { artifactsRoute } from './routes/artifacts';
import { projectsRoute } from './routes/projects';
import { usersRoute } from './routes/users';
import { discussionsRoute } from './routes/discussions';
import { authMiddleware } from './middleware/auth';
import { createDb, UserService } from '@pubwiki/db';
import type { HealthCheckResponse, GetMeResponse, UpdateProfileRequest, UpdateProfileResponse, ApiError } from '@pubwiki/api';

const app = new Hono<{ Bindings: Env }>();

// 全局中间件
app.use('*', logger());
app.use('*', cors({
  origin: '*', // 生产环境应该设置具体的域名
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 600,
}));

// 健康检查 - 同时支持 /api 和 /api/
app.get('/api', (c) => {
  return c.json<HealthCheckResponse>({ message: 'PubWiki API is running', version: '1.0.0' });
});
app.get('/api/', (c) => {
  return c.json<HealthCheckResponse>({ message: 'PubWiki API is running', version: '1.0.0' });
});

// 认证路由
app.route('/api/auth', auth);

// Artifacts 路由（公开）
app.route('/api/artifacts', artifactsRoute);

// Projects 路由（公开）
app.route('/api/projects', projectsRoute);

// Users 路由（公开）
app.route('/api/users', usersRoute);

// Discussions 路由（讨论区）
app.route('/api/discussions', discussionsRoute);

// 需要认证的路由示例 - 获取当前用户信息
app.get('/api/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = createDb(c.env.DB);
  const userService = new UserService(db, c.env.JWT_SECRET);
  
  const result = await userService.getUserById(user.sub);
  
  if (!result.success) {
    return c.json<ApiError>({ error: result.error.message }, 404);
  }
  
  return c.json<GetMeResponse>({ user: result.data });
});

// 更新当前用户 Profile
app.patch('/api/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const db = createDb(c.env.DB);
  const userService = new UserService(db, c.env.JWT_SECRET);

  const body = await c.req.json<UpdateProfileRequest>();
  
  // 提取允许更新的字段
  const updates: Parameters<typeof userService.updateUser>[1] = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.website !== undefined) updates.website = body.website;
  if (body.location !== undefined) updates.location = body.location;

  const result = await userService.updateUser(user.sub, updates);

  if (!result.success) {
    const status = result.error.code === 'USER_NOT_FOUND' ? 404 : 400;
    return c.json<ApiError>({ error: result.error.message }, status);
  }

  return c.json<UpdateProfileResponse>({
    message: 'Profile updated successfully',
    user: result.data,
  });
});

export default app;

