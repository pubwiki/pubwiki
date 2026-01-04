import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { execSync } from 'child_process';

describe('E2E: Auth Middleware - User Validation', () => {
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
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);
  });

  afterAll(async () => {
    await worker.stop();
  });

  describe('Deleted User Token Validation', () => {
    it('should reject token of deleted user when accessing protected routes', async () => {
      // 1. 注册一个新用户并获取 token
      const username = `deleted_user_${Date.now()}`;
      const { data: registerData } = await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}@example.com`,
          password: 'password123',
        },
      });

      expect(registerData).toBeDefined();
      const token = registerData!.token;
      const userId = registerData!.user.id;

      // 2. 确认 token 有效 - 可以访问 /me
      const authClient = createApiClient(baseUrl, token);
      const { data: meData, error: meError } = await authClient.GET('/me');
      expect(meError).toBeUndefined();
      expect(meData?.user.id).toBe(userId);

      // 3. 通过 wrangler d1 execute 直接从数据库删除用户
      // 注意：使用 --local 标志操作本地数据库
      try {
        execSync(
          `npx wrangler d1 execute DB --local --command "DELETE FROM users WHERE id = '${userId}'"`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (error) {
        // wrangler 命令可能返回非零退出码但实际执行成功
        console.log('Delete command executed');
      }

      // 4. 使用旧 token 访问受保护的路由 - 应该返回 401
      const { error: rejectedError, response } = await authClient.GET('/me');
      
      expect(response.status).toBe(401);
      expect(rejectedError).toBeDefined();
      expect(rejectedError!.error).toBe('User not found or has been deleted');
    });

    it('should reject token of deleted user when creating artifact', async () => {
      // 1. 注册一个新用户并获取 token
      const username = `deleted_creator_${Date.now()}`;
      const { data: registerData } = await client.POST('/auth/register', {
        body: {
          username,
          email: `${username}@example.com`,
          password: 'password123',
        },
      });

      expect(registerData).toBeDefined();
      const token = registerData!.token;
      const userId = registerData!.user.id;

      // 2. 从数据库删除用户
      try {
        execSync(
          `npx wrangler d1 execute DB --local --command "DELETE FROM users WHERE id = '${userId}'"`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (error) {
        console.log('Delete command executed');
      }

      // 3. 使用旧 token 尝试创建 artifact - 应该在 auth middleware 就被拒绝
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        type: 'PROMPT',
        name: 'Test Artifact',
        slug: 'test-artifact',
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [
          { id: crypto.randomUUID(), type: 'PROMPT', name: 'Test Node', external: false },
        ],
        edges: [],
      }));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      expect(response.status).toBe(401);
      const errorData = await response.json() as { error: string };
      expect(errorData.error).toBe('User not found or has been deleted');
    });
  });
});
