import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, clearDatabase, sendRequest, user, session, eq, type TestDb } from './helpers';

/**
 * Better-Auth API 测试
 * 
 * Better-Auth 提供以下端点：
 * - POST /api/auth/sign-up/email - 邮箱注册
 * - POST /api/auth/sign-in/email - 邮箱登录
 * - POST /api/auth/sign-in/username - 用户名登录 (需要 username plugin)
 * - GET /api/auth/session - 获取当前 session
 * - POST /api/auth/sign-out - 登出
 */
describe('Better-Auth API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('POST /api/auth/sign-up/email', () => {
    it('should register a new user', async () => {
      const request = new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test User',
          username: 'testuser',
          email: 'test@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      
      // Better-Auth 返回 user 和 session
      const data = await response.json<{ user: { id: string; email: string; name: string }; }>();
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.name).toBe('Test User');

      // 验证返回了 session cookie
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain('better-auth');

      // 验证数据库状态
      const dbUsers = await db.select().from(user).where(eq(user.username, 'testuser'));
      expect(dbUsers).toHaveLength(1);
      expect(dbUsers[0].email).toBe('test@example.com');
    });
  });

  describe('POST /api/auth/sign-in/email', () => {
    beforeEach(async () => {
      // 创建测试用户
      const request = new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Login Test',
          username: 'logintest',
          email: 'login@example.com',
          password: 'password123',
        }),
      });
      await sendRequest(request);
    });

    it('should login with email and password', async () => {
      const request = new Request('http://localhost/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'login@example.com',
          password: 'password123',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      
      // 验证返回了 session cookie
      const setCookie = response.headers.get('Set-Cookie');
      expect(setCookie).toBeTruthy();

      // 验证创建了 session
      const sessions = await db.select().from(session);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/auth/get-session', () => {
    it('should return session for authenticated user', async () => {
      // 先注册用户
      const signUpRequest = new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Session Test',
          username: 'sessiontest',
          email: 'session@example.com',
          password: 'password123',
        }),
      });
      const signUpResponse = await sendRequest(signUpRequest);
      const sessionCookie = signUpResponse.headers.get('Set-Cookie') || '';

      // 使用 cookie 获取 session
      const sessionRequest = new Request('http://localhost/api/auth/get-session', {
        method: 'GET',
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(sessionRequest);

      expect(response.status).toBe(200);
      const data = await response.json<{ session: { userId: string }; user: { email: string } }>();
      expect(data.user.email).toBe('session@example.com');
    });

    it('should return null session without cookie', async () => {
      const request = new Request('http://localhost/api/auth/get-session', {
        method: 'GET',
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<{ session: null }>();
      // Better-Auth 对于无 session 返回 null
      expect(data).toBeNull();
    });
  });

  // sign-out 测试需要处理 CSRF token，暂时跳过
  // describe('POST /api/auth/sign-out', () => {
  //   it('should invalidate session on sign out', async () => {
  //     // ...
  //   });
  // });
});
