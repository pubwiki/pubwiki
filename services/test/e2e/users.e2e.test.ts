import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { registerUser } from './helpers';

// 生成随机字符串用于用户名
function randomSuffix(): string {
  return Math.random().toString(36).substring(2, 10);
}

describe('E2E: Users API', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('GET /users/{userId}/artifacts', () => {
    it('should return 404 for non-existent user', async () => {
      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: {
            userId: '00000000-0000-0000-0000-000000000000',
          },
        },
      });

      expect(response.status).toBe(404);
      expect(error).toBeDefined();
      expect(error!.error).toBe('User not found');
    });

    it('should return artifact list with pagination for existing user', async () => {
      // 先注册一个用户获取其 ID
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `artifactuser_${suffix}`);
      const userId = result.userId;

      // 获取该用户的 artifacts
      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: { userId },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.artifacts).toBeDefined();
      expect(Array.isArray(data!.artifacts)).toBe(true);
      expect(data!.pagination).toBeDefined();
      expect(data!.pagination.page).toBeGreaterThanOrEqual(1);
      expect(data!.pagination.limit).toBeGreaterThanOrEqual(1);
    });

    it('should accept pagination parameters', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `artifactuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: { userId },
          query: {
            page: 1,
            limit: 10,
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.pagination.page).toBe(1);
      expect(data!.pagination.limit).toBe(10);
    });

    it('should accept type filter parameters', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `artifactuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: { userId },
          query: {
            'type.include': ['RECIPE'],
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should accept sort parameters', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `artifactuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: { userId },
          query: {
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should return 400 for invalid sortBy value', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `artifactuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/artifacts', {
        params: {
          path: { userId },
          query: {
            // @ts-expect-error - testing invalid value
            sortBy: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid sortBy');
    });
  });

  describe('GET /users/{userId}/projects', () => {
    it('should return 404 for non-existent user', async () => {
      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: {
            userId: '00000000-0000-0000-0000-000000000000',
          },
        },
      });

      expect(response.status).toBe(404);
      expect(error).toBeDefined();
      expect(error!.error).toBe('User not found');
    });

    it('should return project list with pagination for existing user', async () => {
      // 先注册一个用户获取其 ID
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      // 获取该用户的 projects
      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.projects).toBeDefined();
      expect(Array.isArray(data!.projects)).toBe(true);
      expect(data!.pagination).toBeDefined();
      expect(data!.pagination.page).toBeGreaterThanOrEqual(1);
      expect(data!.pagination.limit).toBeGreaterThanOrEqual(1);
    });

    it('should accept pagination parameters', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
          query: {
            page: 1,
            limit: 10,
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.pagination.page).toBe(1);
      expect(data!.pagination.limit).toBe(10);
    });

    it('should accept role filter parameter', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
          query: {
            role: 'owner',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should accept sort parameters', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
          query: {
            sortBy: 'updatedAt',
            sortOrder: 'desc',
          },
        },
      });

      expect(response.status).toBe(200);
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
    });

    it('should return 400 for invalid role value', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
          query: {
            // @ts-expect-error - testing invalid value
            role: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid role');
    });

    it('should return 400 for invalid sortBy value', async () => {
      // 注册用户
      const suffix = randomSuffix();
      const result = await registerUser(baseUrl, `projectuser_${suffix}`);
      const userId = result.userId;

      const { data, error, response } = await client.GET('/users/{userId}/projects', {
        params: {
          path: { userId },
          query: {
            // @ts-expect-error - testing invalid value
            sortBy: 'invalid',
          },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toBeDefined();
      expect(error!.error).toContain('Invalid sortBy');
    });
  });
});
