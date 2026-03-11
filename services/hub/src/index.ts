import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { createAuth } from './lib/auth';
import { artifactsRoute } from './routes/artifacts';
import { buildCacheRoute } from './routes/build-cache';
import { projectsRoute } from './routes/projects';
import { usersRoute } from './routes/users';
import { discussionsRoute } from './routes/discussions';
import { articlesRoute } from './routes/articles';
import { nodesRoute } from './routes/nodes';
import { savesRoute } from './routes/saves';
import { tagsRoute } from './routes/tags';
import { imagesRoute } from './routes/images';
import { authMiddleware } from './middleware/auth';
import { createDb, eq, user as userTable } from '@pubwiki/db';
import type { HealthCheckResponse, GetMeResponse, UpdateProfileRequest, UpdateProfileResponse, ApiError } from '@pubwiki/api';

const app = new Hono<{ Bindings: Env }>();

// 全局中间件
app.use('*', logger());
app.use('*', cors({
  origin: (origin) => origin || '*', // 动态返回请求的 origin，支持 credentials
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposeHeaders: ['Content-Length', 'Set-Cookie'],
  credentials: true, // 允许发送 cookies
  maxAge: 600,
}));

// 健康检查 - 同时支持 /api 和 /api/
app.get('/api', (c) => {
  return c.json<HealthCheckResponse>({ message: 'PubWiki API is running', version: '1.0.0' });
});
app.get('/api/', (c) => {
  return c.json<HealthCheckResponse>({ message: 'PubWiki API is running', version: '1.0.0' });
});

// Better-Auth handler
app.on(['GET', 'POST'], '/api/auth/*', (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Artifacts 路由（公开）
app.route('/api/artifacts', artifactsRoute);

// Build cache 路由（公开）
app.route('/api/build-cache', buildCacheRoute);

// Tags 路由（公开）
app.route('/api/tags', tagsRoute);

// Projects 路由（公开）
app.route('/api/projects', projectsRoute);

// Users 路由（公开）
app.route('/api/users', usersRoute);

// Discussions 路由（讨论区）
app.route('/api/discussions', discussionsRoute);

// Articles 路由（文章）
app.route('/api/articles', articlesRoute);

// Nodes 路由（版本控制一等公民）
app.route('/api/nodes', nodesRoute);

// Saves 路由（存档）
app.route('/api/saves', savesRoute);

// Images 路由（图片上传）
app.route('/api/images', imagesRoute);

// 需要认证的路由 - 获取当前用户信息
app.get('/api/me', authMiddleware, async (c) => {
  const sessionUser = c.get('user');
  const db = createDb(c.env.DB);
  
  const [userData] = await db.select().from(userTable).where(eq(userTable.id, sessionUser.id)).limit(1);
  
  if (!userData) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }
  
  return c.json<GetMeResponse>({
    user: {
      id: userData.id,
      username: userData.username,
      email: userData.email,
      displayName: userData.displayName,
      avatarUrl: userData.avatarUrl,
      bio: userData.bio,
      website: userData.website,
      location: userData.location,
      createdAt: userData.createdAt.toISOString(),
      updatedAt: userData.updatedAt.toISOString(),
    },
  });
});

// 更新当前用户 Profile
app.patch('/api/me', authMiddleware, async (c) => {
  const sessionUser = c.get('user');
  const db = createDb(c.env.DB);

  const body = await c.req.json<UpdateProfileRequest>();
  
  // 提取允许更新的字段
  const updates: Partial<{
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    website: string | null;
    location: string | null;
    updatedAt: Date;
  }> = {
    updatedAt: new Date(),
  };
  
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;
  if (body.bio !== undefined) updates.bio = body.bio;
  if (body.website !== undefined) updates.website = body.website;
  if (body.location !== undefined) updates.location = body.location;

  const [updated] = await db.update(userTable)
    .set(updates)
    .where(eq(userTable.id, sessionUser.id))
    .returning();

  if (!updated) {
    return c.json<ApiError>({ error: 'User not found' }, 404);
  }

  return c.json<UpdateProfileResponse>({
    message: 'Profile updated successfully',
    user: {
      id: updated.id,
      username: updated.username,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      bio: updated.bio,
      website: updated.website,
      location: updated.location,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
});

export default app;

