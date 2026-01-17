import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient, createAuthClient } from '@pubwiki/api/client';
import { registerUser, loginUser } from './helpers';

describe('E2E: Auth Flow (Better-Auth)', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;
  let origin: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    origin = `http://${worker.address}:${worker.port}`;
    client = createApiClient(baseUrl);
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('Health Check', () => {
    it('should return API status', async () => {
      const { data, error } = await client.GET('/');
      
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.message).toBe('PubWiki API is running');
      expect(data!.version).toBe('1.0.0');
    });
  });

  describe('Registration (Better-Auth)', () => {
    it('should register a new user', async () => {
      const username = `user_${Date.now()}`;
      const { sessionCookie, userId } = await registerUser(baseUrl, username);

      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).toContain('better-auth.session_token');
      expect(userId).toBeTruthy();
    });

    it('should reject invalid email', async () => {
      const response = await fetch(`${baseUrl}/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          name: 'test',
          username: 'test',
          email: 'invalid-email',
          password: 'password123',
        }),
      });

      expect(response.ok).toBe(false);
    });

    it('should reject duplicate email', async () => {
      const username1 = `dup_email_${Date.now()}`;
      const email = `${username1}@example.com`;
      
      // 第一次注册
      await fetch(`${baseUrl}/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          name: username1,
          username: username1,
          email,
          password: 'password123',
        }),
      });

      // 第二次注册相同邮箱
      const response = await fetch(`${baseUrl}/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          name: 'another',
          username: `${username1}_2`,
          email, // 相同邮箱
          password: 'password123',
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('Login (Better-Auth)', () => {
    const testUser = {
      username: `login_test_${Date.now()}`,
      email: '',
      password: 'password123',
    };

    beforeAll(async () => {
      testUser.email = `${testUser.username}@example.com`;
      // 创建测试用户
      await registerUser(baseUrl, testUser.username);
    });

    it('should login with email', async () => {
      const { sessionCookie, userId } = await loginUser(
        baseUrl,
        testUser.email,
        testUser.password
      );

      expect(sessionCookie).toBeTruthy();
      expect(sessionCookie).toContain('better-auth.session_token');
      expect(userId).toBeTruthy();
    });

    it('should reject wrong password', async () => {
      const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          email: testUser.email,
          password: 'wrongpassword',
        }),
      });

      expect(response.ok).toBe(false);
    });

    it('should reject non-existent user', async () => {
      const response = await fetch(`${baseUrl}/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          email: 'nonexistent_12345@example.com',
          password: 'password123',
        }),
      });

      expect(response.ok).toBe(false);
    });
  });

  describe('Get Current User', () => {
    let sessionCookie: string;
    let testUsername: string;

    beforeAll(async () => {
      testUsername = `me_test_${Date.now()}`;
      const result = await registerUser(baseUrl, testUsername);
      sessionCookie = result.sessionCookie;
    });

    it('should return current user with valid session', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: sessionCookie },
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as { user: { username: string } };
      expect(data.user.username).toBe(testUsername);
    });

    it('should reject request without session', async () => {
      const response = await fetch(`${baseUrl}/me`);

      expect(response.status).toBe(401);
      const data = await response.json() as { error: string };
      expect(data.error).toBe('Authorization required');
    });

    it('should reject request with invalid session', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: 'better-auth.session_token=invalid-token' },
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Full Auth Flow', () => {
    it('should complete register -> login -> get me flow', async () => {
      const username = `flow_${Date.now()}`;
      const email = `${username}@example.com`;
      const password = 'securePassword123';

      // 1. 注册
      const signUpResponse = await fetch(`${baseUrl}/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Origin': origin },
        body: JSON.stringify({
          name: username,
          username,
          email,
          password,
        }),
      });
      expect(signUpResponse.ok).toBe(true);

      // 2. 登录
      const { sessionCookie } = await loginUser(baseUrl, email, password);
      expect(sessionCookie).toBeTruthy();

      // 3. 获取当前用户
      const meResponse = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: sessionCookie },
      });
      expect(meResponse.ok).toBe(true);
      const meData = await meResponse.json() as { user: { username: string; email: string } };
      expect(meData.user.username).toBe(username);
      expect(meData.user.email).toBe(email);
    });
  });

  describe('Update Profile', () => {
    let sessionCookie: string;
    let testUsername: string;

    beforeAll(async () => {
      testUsername = `profile_test_${Date.now()}`;
      const result = await registerUser(baseUrl, testUsername);
      sessionCookie = result.sessionCookie;
    });

    it('should update profile with all fields', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Updated Display Name',
          bio: 'This is my bio',
          website: 'https://example.com',
          location: 'Tokyo, Japan',
          avatarUrl: 'https://example.com/avatar.png',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as {
        message: string;
        user: {
          displayName: string;
          bio: string;
          website: string;
          location: string;
          avatarUrl: string;
        };
      };
      expect(data.message).toBe('Profile updated successfully');
      expect(data.user.displayName).toBe('Updated Display Name');
      expect(data.user.bio).toBe('This is my bio');
      expect(data.user.website).toBe('https://example.com');
      expect(data.user.location).toBe('Tokyo, Japan');
      expect(data.user.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should update profile with partial fields', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bio: 'Only bio updated',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json() as {
        user: { bio: string; displayName: string };
      };
      expect(data.user.bio).toBe('Only bio updated');
      // 之前设置的字段应该保持不变
      expect(data.user.displayName).toBe('Updated Display Name');
    });

    it('should reject update without session', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: 'Should Not Work',
        }),
      });

      expect(response.status).toBe(401);
      const data = await response.json() as { error: string };
      expect(data.error).toBe('Authorization required');
    });

    it('should reject update with invalid session', async () => {
      const response = await fetch(`${baseUrl}/me`, {
        method: 'PATCH',
        headers: {
          Cookie: 'better-auth.session_token=invalid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Should Not Work',
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Full Profile Flow', () => {
    it('should complete register -> update profile -> verify changes flow', async () => {
      const username = `profile_flow_${Date.now()}`;

      // 1. 注册
      const { sessionCookie } = await registerUser(baseUrl, username);
      expect(sessionCookie).toBeTruthy();

      // 2. 更新 profile
      const updateResponse = await fetch(`${baseUrl}/me`, {
        method: 'PATCH',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'My Display Name',
          bio: 'Hello World',
          website: 'https://mysite.com',
          location: 'San Francisco',
        }),
      });
      expect(updateResponse.ok).toBe(true);
      const updateData = await updateResponse.json() as { message: string };
      expect(updateData.message).toBe('Profile updated successfully');

      // 3. 验证更改已保存
      const meResponse = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: sessionCookie },
      });
      expect(meResponse.ok).toBe(true);
      const meData = await meResponse.json() as {
        user: {
          displayName: string;
          bio: string;
          website: string;
          location: string;
        };
      };
      expect(meData.user.displayName).toBe('My Display Name');
      expect(meData.user.bio).toBe('Hello World');
      expect(meData.user.website).toBe('https://mysite.com');
      expect(meData.user.location).toBe('San Francisco');
    });
  });
});
