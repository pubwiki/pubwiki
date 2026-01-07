import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';

describe('E2E: Auth Flow', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false, // 不持久化数据，每次测试干净的数据库
    });
    // baseUrl 需要包含 /api 前缀，与 OpenAPI spec 中的 servers 配置对应
    baseUrl = `http://${worker.address}:${worker.port}/api`;
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

  describe('Registration', () => {
    it('should register a new user', async () => {
      const username = `user_${Date.now()}`;
      const { data, error } = await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}@example.com`,
          password: 'password123',
        },
      });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.message).toBe('Registration successful');
      expect(data!.user.username).toBe(username);
      expect(data!.token).toBeTruthy();
    });

    it('should reject invalid username', async () => {
      const { data, error, response } = await client.POST('/auth/register', {
        body: {
          username: 'ab', // too short
          email: 'test@example.com',
          password: 'password123',
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toBeTruthy();
    });

    it('should reject duplicate username', async () => {
      const username = `dup_${Date.now()}`;
      
      // 第一次注册
      await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}_1@example.com`,
          password: 'password123',
        },
      });

      // 第二次注册相同用户名
      const { error, response } = await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}_2@example.com`,
          password: 'password123',
        },
      });

      expect(response.status).toBe(409);
      expect(error).toBeDefined();
    });
  });

  describe('Login', () => {
    const testUser = {
      username: `login_test_${Date.now()}`,
      email: '',
      password: 'password123',
    };

    beforeAll(async () => {
      testUser.email = `${testUser.username}@example.com`;
      // 创建测试用户
      await client.POST('/auth/register', {
        body: testUser,
      });
    });

    it('should login with username', async () => {
      const { data, error } = await client.POST('/auth/login', {
        body: {
          usernameOrEmail: testUser.username,
          password: testUser.password,
        },
      });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.message).toBe('Login successful');
      expect(data!.token).toBeTruthy();
      expect(data!.user.username).toBe(testUser.username);
    });

    it('should login with email', async () => {
      const { data, error } = await client.POST('/auth/login', {
        body: {
          usernameOrEmail: testUser.email,
          password: testUser.password,
        },
      });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.message).toBe('Login successful');
    });

    it('should reject wrong password', async () => {
      const { error, response } = await client.POST('/auth/login', {
        body: {
          usernameOrEmail: testUser.username,
          password: 'wrongpassword',
        },
      });

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
    });

    it('should reject non-existent user', async () => {
      const { error, response } = await client.POST('/auth/login', {
        body: {
          usernameOrEmail: 'nonexistent_user_12345',
          password: 'password123',
        },
      });

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
    });
  });

  describe('Get Current User', () => {
    let token: string;
    let testUsername: string;

    beforeAll(async () => {
      testUsername = `me_test_${Date.now()}`;
      // 创建并登录测试用户
      const { data } = await client.POST('/auth/register', {
        body: {
          username: testUsername,
          email: `${testUsername}@example.com`,
          password: 'password123',
        },
      });
      token = data!.token;
    });

    it('should return current user with valid token', async () => {
      const authClient = createApiClient(baseUrl, token);
      const { data, error } = await authClient.GET('/me');

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.user.username).toBe(testUsername);
    });

    it('should reject request without token', async () => {
      const { error, response } = await client.GET('/me');

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
      expect(error!.error).toBe('Authorization token required');
    });

    it('should reject request with invalid token', async () => {
      const badClient = createApiClient(baseUrl, 'invalid-token');
      const { error, response } = await badClient.GET('/me');

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
      expect(error!.error).toBe('Invalid or expired token');
    });
  });

  describe('Full Auth Flow', () => {
    it('should complete register -> login -> get me flow', async () => {
      const username = `flow_${Date.now()}`;
      const email = `${username}@example.com`;
      const password = 'securePassword123';

      // 1. 注册
      const { data: registerData } = await client.POST('/auth/register', {
        body: { username, email, password },
      });
      expect(registerData).toBeDefined();
      expect(registerData!.user.username).toBe(username);

      // 2. 登录
      const { data: loginData } = await client.POST('/auth/login', {
        body: { usernameOrEmail: username, password },
      });
      expect(loginData).toBeDefined();
      const token = loginData!.token;

      // 3. 获取当前用户
      const authClient = createApiClient(baseUrl, token);
      const { data: meData } = await authClient.GET('/me');
      expect(meData).toBeDefined();
      expect(meData!.user.username).toBe(username);
      expect(meData!.user.email).toBe(email);
    });
  });

  describe('Update Profile', () => {
    let token: string;
    let testUsername: string;

    beforeAll(async () => {
      testUsername = `profile_test_${Date.now()}`;
      // 创建测试用户
      const { data } = await client.POST('/auth/register', {
        body: {
          username: testUsername,
          email: `${testUsername}@example.com`,
          password: 'password123',
        },
      });
      token = data!.token;
    });

    it('should update profile with all fields', async () => {
      const authClient = createApiClient(baseUrl, token);
      const { data, error } = await authClient.PATCH('/me', {
        body: {
          displayName: 'Updated Display Name',
          bio: 'This is my bio',
          website: 'https://example.com',
          location: 'Tokyo, Japan',
          avatarUrl: 'https://example.com/avatar.png',
        },
      });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.message).toBe('Profile updated successfully');
      expect(data!.user.displayName).toBe('Updated Display Name');
      expect(data!.user.bio).toBe('This is my bio');
      expect(data!.user.website).toBe('https://example.com');
      expect(data!.user.location).toBe('Tokyo, Japan');
      expect(data!.user.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should update profile with partial fields', async () => {
      const authClient = createApiClient(baseUrl, token);
      const { data, error } = await authClient.PATCH('/me', {
        body: {
          bio: 'Only bio updated',
        },
      });

      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.user.bio).toBe('Only bio updated');
      // 之前设置的字段应该保持不变
      expect(data!.user.displayName).toBe('Updated Display Name');
    });

    it('should reject update without token', async () => {
      const { error, response } = await client.PATCH('/me', {
        body: {
          displayName: 'Should Not Work',
        },
      });

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
      expect(error!.error).toBe('Authorization token required');
    });

    it('should reject update with invalid token', async () => {
      const badClient = createApiClient(baseUrl, 'invalid-token');
      const { error, response } = await badClient.PATCH('/me', {
        body: {
          displayName: 'Should Not Work',
        },
      });

      expect(response.status).toBe(401);
      expect(error).toBeDefined();
      expect(error!.error).toBe('Invalid or expired token');
    });
  });

  describe('Full Profile Flow', () => {
    it('should complete register -> update profile -> verify changes flow', async () => {
      const username = `profile_flow_${Date.now()}`;
      const email = `${username}@example.com`;
      const password = 'securePassword123';

      // 1. 注册
      const { data: registerData } = await client.POST('/auth/register', {
        body: { username, email, password },
      });
      expect(registerData).toBeDefined();
      const token = registerData!.token;

      // 2. 更新 profile
      const authClient = createApiClient(baseUrl, token);
      const { data: updateData } = await authClient.PATCH('/me', {
        body: {
          displayName: 'My Display Name',
          bio: 'Hello World',
          website: 'https://mysite.com',
          location: 'San Francisco',
        },
      });
      expect(updateData).toBeDefined();
      expect(updateData!.message).toBe('Profile updated successfully');

      // 3. 验证更改已保存
      const { data: meData } = await authClient.GET('/me');
      expect(meData).toBeDefined();
      expect(meData!.user.displayName).toBe('My Display Name');
      expect(meData!.user.bio).toBe('Hello World');
      expect(meData!.user.website).toBe('https://mysite.com');
      expect(meData!.user.location).toBe('San Francisco');
    });
  });
});
