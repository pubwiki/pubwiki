import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { execSync } from 'child_process';
import { registerUser } from './helpers';

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

  describe('Deleted User Session Validation', () => {
    it('should reject session of deleted user when accessing protected routes', async () => {
      // 1. 注册一个新用户并获取 session cookie
      const username = `deleted_user_${Date.now()}`;
      const { sessionCookie, userId } = await registerUser(baseUrl, username);

      // 2. 确认 session 有效 - 可以访问 /me
      const meResponse = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: sessionCookie },
      });
      expect(meResponse.ok).toBe(true);
      const meData = await meResponse.json() as { user: { id: string } };
      expect(meData.user.id).toBe(userId);

      // 3. 通过 wrangler d1 execute 直接从数据库删除用户
      // 注意：使用 --local 标志操作本地数据库
      try {
        execSync(
          `npx wrangler d1 execute DB --local --command "DELETE FROM user WHERE id = '${userId}'"`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (error) {
        // wrangler 命令可能返回非零退出码但实际执行成功
        console.log('Delete command executed');
      }

      // 4. 使用旧 session 访问受保护的路由 - 应该返回 401
      const rejectedResponse = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: sessionCookie },
      });
      
      expect(rejectedResponse.status).toBe(401);
      const errorData = await rejectedResponse.json() as { error: string };
      expect(errorData.error).toBe('Authorization required');
    });

    it('should reject session of deleted user when creating artifact', async () => {
      // 1. 注册一个新用户并获取 session cookie
      const username = `deleted_creator_${Date.now()}`;
      const { sessionCookie, userId } = await registerUser(baseUrl, username);

      // 2. 从数据库删除用户
      try {
        execSync(
          `npx wrangler d1 execute DB --local --command "DELETE FROM user WHERE id = '${userId}'"`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (error) {
        console.log('Delete command executed');
      }

      // 3. 使用旧 session 尝试创建 artifact - 应该在 auth middleware 就被拒绝
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
          { id: crypto.randomUUID(), type: 'PROMPT', name: 'Test Node' },
        ],
        edges: [],
      }));

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
        },
        body: formData,
      });

      expect(response.status).toBe(401);
      const errorData = await response.json() as { error: string };
      expect(errorData.error).toBe('Authorization required');
    });
  });
});
