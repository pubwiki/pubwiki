import { describe, it, expect, beforeEach } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { Hono } from 'hono';
import { authMiddleware, optionalAuthMiddleware, adminMiddleware } from '../../src/middleware/auth';
import { createDb, user, session, account, verification, eq } from '@pubwiki/db';
import { sendRequest, clearDatabase, getTestDb, registerAndGetSession } from '../api/helpers';
import type { ApiError } from '@pubwiki/api';

// 受保护路由的响应类型
interface ProtectedResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
    isAdmin: boolean;
  };
}

interface OptionalAuthResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
  } | null;
}

interface AdminResponse {
  message: string;
}

// 创建测试应用
function createTestApp() {
  const app = new Hono<{ Bindings: typeof env }>();
  
  // 需要认证的路由
  app.get('/protected', authMiddleware, (c) => {
    const userData = c.get('user');
    return c.json({ message: 'success', user: userData });
  });

  // 可选认证的路由
  app.get('/optional', optionalAuthMiddleware, (c) => {
    const userData = c.get('user');
    return c.json({ message: 'success', user: userData || null });
  });

  // 需要管理员的路由
  app.get('/admin', authMiddleware, adminMiddleware, (c) => {
    return c.json({ message: 'admin access granted' });
  });

  return app;
}

describe('Auth Middleware', () => {
  let testSessionCookie: string;
  let adminSessionCookie: string;
  let app: ReturnType<typeof createTestApp>;
  let db: ReturnType<typeof getTestDb>;

  beforeEach(async () => {
    app = createTestApp();
    db = getTestDb();
    
    // 清空数据库 (按外键顺序)
    await clearDatabase(db);
    
    // 创建普通用户 via Better-Auth API
    testSessionCookie = await registerAndGetSession('testuser');

    // 创建管理员用户 via Better-Auth API
    adminSessionCookie = await registerAndGetSession('adminuser');
    // 将管理员用户设置为 admin
    await db.update(user)
      .set({ isAdmin: true, isVerified: true })
      .where(eq(user.username, 'adminuser'));
  });

  describe('authMiddleware', () => {
    it('should allow access with valid session cookie', async () => {
      const request = new Request('http://localhost/protected', {
        headers: { Cookie: testSessionCookie },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<ProtectedResponse>();
      expect(data.message).toBe('success');
      expect(data.user.username).toBe('testuser');
    });

    it('should return 401 without cookie', async () => {
      const request = new Request('http://localhost/protected');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization required');
    });

    it('should return 401 with invalid session token', async () => {
      const request = new Request('http://localhost/protected', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Authorization required');
    });

    it('should return 401 with expired session', async () => {
      const db = createDb(env.DB);
      // 创建过期的 session
      const expiredUserId = crypto.randomUUID();
      await db.insert(user).values({
        id: expiredUserId,
        name: 'Expired User',
        username: 'expireduser',
        email: 'expired@example.com',
        emailVerified: true,
        isAdmin: false,
        isVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      const expiredToken = crypto.randomUUID();
      await db.insert(session).values({
        id: crypto.randomUUID(),
        token: expiredToken,
        userId: expiredUserId,
        expiresAt: new Date(Date.now() - 1000), // 已过期
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const request = new Request('http://localhost/protected', {
        headers: { Cookie: `better-auth.session_token=${expiredToken}` },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
    });
  });

  describe('optionalAuthMiddleware', () => {
    it('should allow access and set user with valid session cookie', async () => {
      const request = new Request('http://localhost/optional', {
        headers: { Cookie: testSessionCookie },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<OptionalAuthResponse>();
      expect(data.user).not.toBeNull();
      expect(data.user!.username).toBe('testuser');
    });

    it('should allow access without cookie (user is null)', async () => {
      const request = new Request('http://localhost/optional');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json<OptionalAuthResponse>();
      expect(data.user).toBeNull();
    });

    it('should allow access with invalid session token (user is null)', async () => {
      const request = new Request('http://localhost/optional', {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
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
        headers: { Cookie: adminSessionCookie },
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
        headers: { Cookie: testSessionCookie },
      });
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(403);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Admin access required');
    });

    it('should return 401 without cookie', async () => {
      const request = new Request('http://localhost/admin');
      const ctx = createExecutionContext();
      const response = await app.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(401);
    });
  });
});
