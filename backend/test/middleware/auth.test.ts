import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { authMiddleware, optionalAuthMiddleware, adminMiddleware } from '../../src/middleware/auth';
import { createDb, UserService, users, generateToken } from '@pubwiki/db';
import type { JwtPayload, ApiError } from '@pubwiki/api';

// 受保护路由的响应类型
interface ProtectedResponse {
  message: string;
  user: JwtPayload;
}

interface OptionalAuthResponse {
  message: string;
  user: JwtPayload | null;
}

interface AdminResponse {
  message: string;
}

const TEST_JWT_SECRET = 'your-jwt-secret-change-in-production'; // 与 wrangler.jsonc 中的一致

// 创建测试应用
function createTestApp() {
  const app = new Hono<{ Bindings: typeof env }>();
  
  // 需要认证的路由
  app.get('/protected', authMiddleware, (c) => {
    const user = c.get('user');
    return c.json({ message: 'success', user });
  });

  // 可选认证的路由
  app.get('/optional', optionalAuthMiddleware, (c) => {
    const user = c.get('user');
    return c.json({ message: 'success', user: user || null });
  });

  // 需要管理员的路由
  app.get('/admin', authMiddleware, adminMiddleware, (c) => {
    return c.json({ message: 'admin access granted' });
  });

  return app;
}

describe('Auth Middleware', () => {
  let testToken: string;
  let adminToken: string;
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    app = createTestApp();
    const db = createDb(env.DB);
    
    // 清空数据库
    await db.delete(users);
    
    // 创建普通用户
    const userService = new UserService(db, TEST_JWT_SECRET);
    const userResult = await userService.register({
      username: 'testuser',
      email: 'test@example.com',
      password: 'password123',
    });
    if (userResult.success) {
      testToken = userResult.data.token;
    }

    // 创建管理员用户
    const [adminUser] = await db.insert(users).values({
      username: 'adminuser',
      email: 'admin@example.com',
      passwordHash: 'not-used',
      isAdmin: true,
    }).returning();
    
    adminToken = await generateToken(adminUser, TEST_JWT_SECRET);
  });

  describe('authMiddleware', () => {
    it('should allow access with valid token', async () => {
      const request = new Request('http://localhost/protected', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<ProtectedResponse>();
      expect(data.message).toBe('success');
      expect(data.user.username).toBe('testuser');
    });

    it('should return 401 without token', async () => {
      const request = new Request('http://localhost/protected');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization token required');
    });

    it('should return 401 with invalid token', async () => {
      const request = new Request('http://localhost/protected', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Invalid or expired token');
    });

    it('should return 401 with wrong authorization scheme', async () => {
      const request = new Request('http://localhost/protected', {
        headers: { Authorization: 'Basic some-credentials' },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
    });
  });

  describe('optionalAuthMiddleware', () => {
    it('should allow access and set user with valid token', async () => {
      const request = new Request('http://localhost/optional', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<OptionalAuthResponse>();
      expect(data.user).not.toBeNull();
      expect(data.user!.username).toBe('testuser');
    });

    it('should allow access without token (user is null)', async () => {
      const request = new Request('http://localhost/optional');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<OptionalAuthResponse>();
      expect(data.user).toBeNull();
    });

    it('should allow access with invalid token (user is null)', async () => {
      const request = new Request('http://localhost/optional', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<OptionalAuthResponse>();
      expect(data.user).toBeNull();
    });
  });

  describe('adminMiddleware', () => {
    it('should allow access for admin user', async () => {
      const request = new Request('http://localhost/admin', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<AdminResponse>();
      expect(data.message).toBe('admin access granted');
    });

    it('should return 403 for non-admin user', async () => {
      const request = new Request('http://localhost/admin', {
        headers: { Authorization: `Bearer ${testToken}` },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(403);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Admin access required');
    });

    it('should return 401 without token', async () => {
      const request = new Request('http://localhost/admin');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
    });
  });
});
