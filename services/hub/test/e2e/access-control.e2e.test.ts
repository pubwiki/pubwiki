import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import { createApiClient } from '@pubwiki/api/client';
import { registerUser, createArtifactFormData } from './helpers';
import { computeArtifactCommit } from '@pubwiki/api';

/**
 * E2E 测试：访问控制
 * 
 * 测试资源（artifacts, projects）的访问控制功能：
 * - ACL: 通过 resourceAcl 表控制谁可以读/写/管理资源
 * - isListed: 是否在公开列表中可见（通过 resourceDiscoveryControl）
 * 
 * 访问控制矩阵：
 * | Public ACL | isListed | 效果                                    |
 * |------------|----------|----------------------------------------|
 * | yes        | true     | 公开可读，出现在公开列表中（默认）       |
 * | yes        | false    | 公开可读，不出现在公开列表中（unlisted） |
 * | no         | false    | 仅授权用户可访问，不出现在公开列表中     |
 * | no         | true     | 仅授权用户可访问，仅授权用户在列表中可见 |
 */
describe('E2E: Access Control', () => {
  let worker: Unstable_DevWorker;
  let client: ReturnType<typeof createApiClient>;
  let baseUrl: string;

  // User A: 资源所有者
  let userASession: string;
  let userAId: string;

  // User B: 另一个用户（非所有者）
  let userBSession: string;

  beforeAll(async () => {
    // 启动 worker 服务器
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true },
      local: true,
      persist: false,
    });
    baseUrl = `http://${worker.address}:${worker.port}/api`;
    client = createApiClient(baseUrl);

    // 创建两个测试用户
    const userAResult = await registerUser(baseUrl, `access_owner_${Date.now()}`);
    userASession = userAResult.sessionCookie;
    userAId = userAResult.userId;

    const userBResult = await registerUser(baseUrl, `access_other_${Date.now()}`);
    userBSession = userBResult.sessionCookie;
  });

  afterAll(async () => {
    await worker.stop();
  });

  // =========================================================================
  // Artifact 访问控制测试
  // =========================================================================

  describe('Artifact Access Control', () => {
    // Helper: 创建 artifact
    // isPrivate 控制是否创建 PUBLIC_USER_ID 的 ACL 条目（通过 API 内部实现）
    async function createArtifact(
      sessionCookie: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<{ id: string; name: string }> {
      const { isListed = true } = options;

      const formData = await createArtifactFormData({
        name: `Test Artifact ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        isListed,
      });

      const response = await fetch(`${baseUrl}/artifacts`, {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to create artifact: ${response.status} - ${text}`);
      }

      const data = await response.json() as { artifact: { id: string; name: string } };
      return data.artifact;
    }

    describe('Public + Listed (default)', () => {
      let artifactId: string;

      beforeAll(async () => {
        const artifact = await createArtifact(userASession, { isListed: true });
        artifactId = artifact.id;
      });

      it('should be accessible by anyone (unauthenticated)', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });

      it('should be accessible by other authenticated users', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });

      it('should appear in public artifact list', async () => {
        const { response, data } = await client.GET('/artifacts');

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).toContain(artifactId);
      });

      it('should be accessible by owner', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });
    });

    describe('Public + Unlisted (isListed=false)', () => {
      let artifactId: string;

      beforeAll(async () => {
        const artifact = await createArtifact(userASession, { isListed: false });
        artifactId = artifact.id;
      });

      it('should be accessible by anyone with direct link (unauthenticated)', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });

      it('should be accessible by other authenticated users with direct link', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });

      it('should NOT appear in public artifact list', async () => {
        const { response, data } = await client.GET('/artifacts');

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).not.toContain(artifactId);
      });

      it('should appear in owner\'s artifact list', async () => {
        const { response, data } = await client.GET('/users/{userId}/artifacts', {
          params: { path: { userId: userAId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).toContain(artifactId);
      });
    });

    // NOTE: Private artifact tests are skipped because the new ACL system 
    // defaults all artifacts to public. Private artifacts require ACL management
    // APIs which are not yet implemented in the public API.
    describe.skip('Private (no public ACL)', () => {
      let artifactId: string;

      beforeAll(async () => {
        // Would need to create artifact without public ACL
        const artifact = await createArtifact(userASession, { isListed: false });
        artifactId = artifact.id;
      });

      it('should return 404 for unauthenticated users', async () => {
        const { response, error } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });

        // 返回 404 而不是 403，避免暴露资源存在性
        expect(response.status).toBe(404);
        expect(error?.error).toBe('Artifact not found');
      });

      it('should return 404 for other authenticated users', async () => {
        const { response, error } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(404);
        expect(error?.error).toBe('Artifact not found');
      });

      it('should NOT appear in public artifact list', async () => {
        const { response, data } = await client.GET('/artifacts');

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).not.toContain(artifactId);
      });

      it('should NOT appear in other user\'s view of owner\'s artifacts', async () => {
        const { response, data } = await client.GET('/users/{userId}/artifacts', {
          params: { path: { userId: userAId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).not.toContain(artifactId);
      });

      it('should be accessible by owner', async () => {
        const { response, data } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data).toBeDefined();
      });

      it('should appear in owner\'s own artifact list', async () => {
        const { response, data } = await client.GET('/users/{userId}/artifacts', {
          params: { path: { userId: userAId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        const artifactIds = data?.artifacts.map(a => a.id) ?? [];
        expect(artifactIds).toContain(artifactId);
      });
    });

    describe('Artifact modification access control', () => {
      let artifactId: string;

      beforeAll(async () => {
        const artifact = await createArtifact(userASession, { isListed: true });
        artifactId = artifact.id;
      });

      it('should allow owner to update artifact', async () => {
        const response = await fetch(`${baseUrl}/artifacts/${artifactId}/metadata`, {
          method: 'PUT',
          headers: {
            Cookie: userASession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Updated Name by Owner',
          }),
        });

        // PUT /metadata should succeed for owner
        expect(response.status).toBe(200);
      });

      it('should NOT allow other users to update artifact', async () => {
        const response = await fetch(`${baseUrl}/artifacts/${artifactId}/metadata`, {
          method: 'PUT',
          headers: {
            Cookie: userBSession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Hacked Name',
          }),
        });

        expect(response.status).toBe(403);
      });

      it('should NOT allow unauthenticated users to update artifact', async () => {
        const response = await fetch(`${baseUrl}/artifacts/${artifactId}/metadata`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Anonymous Hack',
          }),
        });

        expect(response.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // Project 访问控制测试
  // =========================================================================

  describe('Project Access Control', () => {
    // Helper: 创建 project
    // isPrivate 控制是否创建 PUBLIC_USER_ID 的 ACL 条目（通过 API 内部实现）
    async function createProject(
      sessionCookie: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<{ id: string; name: string; slug: string }> {
      const { isListed = true } = options;
      const slug = `test-project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const response = await fetch(`${baseUrl}/projects`, {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Test Project ${slug}`,
          slug,
          topic: 'testing',
          isListed,
          roles: [{ name: 'Default Role' }],
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to create project: ${response.status} - ${text}`);
      }

      const data = await response.json() as { project: { id: string; name: string; slug: string } };
      return data.project;
    }

    describe('Public + Listed (default)', () => {
      let projectId: string;

      beforeAll(async () => {
        const project = await createProject(userASession, { isListed: true });
        projectId = project.id;
      });

      it('should be accessible by anyone (unauthenticated)', async () => {
        const { response, data } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
        });

        expect(response.status).toBe(200);
        expect(data?.id).toBe(projectId);
      });

      it('should be accessible by other authenticated users', async () => {
        const { response, data } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data?.id).toBe(projectId);
      });

      it('should appear in public project list', async () => {
        const { response, data } = await client.GET('/projects');

        expect(response.status).toBe(200);
        const projectIds = data?.projects.map(p => p.id) ?? [];
        expect(projectIds).toContain(projectId);
      });
    });

    describe('Public + Unlisted (isListed=false)', () => {
      let projectId: string;

      beforeAll(async () => {
        const project = await createProject(userASession, { isListed: false });
        projectId = project.id;
      });

      it('should be accessible by anyone with direct link', async () => {
        const { response, data } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
        });

        expect(response.status).toBe(200);
        expect(data?.id).toBe(projectId);
      });

      it('should NOT appear in public project list', async () => {
        const { response, data } = await client.GET('/projects');

        expect(response.status).toBe(200);
        const projectIds = data?.projects.map(p => p.id) ?? [];
        expect(projectIds).not.toContain(projectId);
      });

      it('should appear in owner\'s project list', async () => {
        const { response, data } = await client.GET('/users/{userId}/projects', {
          params: { path: { userId: userAId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        const projectIds = data?.projects.map(p => p.id) ?? [];
        expect(projectIds).toContain(projectId);
      });
    });

    // NOTE: Private project tests are skipped because the new ACL system 
    // defaults all projects to public. Private projects require ACL management
    // APIs which are not yet implemented in the public API.
    describe.skip('Private (no public ACL)', () => {
      let projectId: string;

      beforeAll(async () => {
        // Would need to create project without public ACL
        const project = await createProject(userASession, { isListed: false });
        projectId = project.id;
      });

      it('should return 404 for unauthenticated users', async () => {
        const { response, error } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
        });

        expect(response.status).toBe(404);
        expect(error?.error).toBe('Project not found');
      });

      it('should return 404 for other authenticated users', async () => {
        const { response, error } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
          headers: { Cookie: userBSession } as Record<string, string>,
        });

        expect(response.status).toBe(404);
        expect(error?.error).toBe('Project not found');
      });

      it('should NOT appear in public project list', async () => {
        const { response, data } = await client.GET('/projects');

        expect(response.status).toBe(200);
        const projectIds = data?.projects.map(p => p.id) ?? [];
        expect(projectIds).not.toContain(projectId);
      });

      it('should be accessible by owner', async () => {
        const { response, data } = await client.GET('/projects/{projectId}', {
          params: { path: { projectId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        expect(data?.id).toBe(projectId);
      });

      it('should appear in owner\'s own project list', async () => {
        const { response, data } = await client.GET('/users/{userId}/projects', {
          params: { path: { userId: userAId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });

        expect(response.status).toBe(200);
        const projectIds = data?.projects.map(p => p.id) ?? [];
        expect(projectIds).toContain(projectId);
      });
    });

    // TODO: Project PATCH/DELETE 端点尚未实现，暂时跳过这些测试
    describe.skip('Project modification access control', () => {
      let projectId: string;

      beforeAll(async () => {
        const project = await createProject(userASession, { isListed: true });
        projectId = project.id;
      });

      it('should allow owner to update project', async () => {
        const response = await fetch(`${baseUrl}/projects/${projectId}`, {
          method: 'PATCH',
          headers: {
            Cookie: userASession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: 'Updated by owner',
          }),
        });

        expect(response.status).toBe(200);
      });

      it('should NOT allow other users to update project', async () => {
        const response = await fetch(`${baseUrl}/projects/${projectId}`, {
          method: 'PATCH',
          headers: {
            Cookie: userBSession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: 'Hacked description',
          }),
        });

        expect(response.status).toBe(403);
      });

      it('should NOT allow unauthenticated users to update project', async () => {
        const response = await fetch(`${baseUrl}/projects/${projectId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            description: 'Anonymous hack',
          }),
        });

        expect(response.status).toBe(401);
      });

      it('should allow owner to delete project', async () => {
        // Create a new project for deletion test
        const toDelete = await createProject(userASession);
        
        const response = await fetch(`${baseUrl}/projects/${toDelete.id}`, {
          method: 'DELETE',
          headers: { Cookie: userASession },
        });

        expect(response.status).toBe(204);
      });

      it('should NOT allow other users to delete project', async () => {
        const response = await fetch(`${baseUrl}/projects/${projectId}`, {
          method: 'DELETE',
          headers: { Cookie: userBSession },
        });

        expect(response.status).toBe(403);
      });
    });
  });

  // =========================================================================
  // 访问控制更新测试
  // =========================================================================

  describe('Access Control Updates', () => {
    describe('Artifact visibility changes', () => {
      it('should allow owner to make public artifact private', async () => {
        // Create public artifact
        const artifactId = crypto.randomUUID();
        const commit = await computeArtifactCommit(artifactId, null, [], []);
        
        const formData = new FormData();
        formData.append('metadata', JSON.stringify({
          artifactId,
          commit,
          name: 'Soon Private Artifact',
          isPrivate: false,
          isListed: true,
        }));
        formData.append('nodes', JSON.stringify([]));
        formData.append('edges', JSON.stringify([]));

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: { Cookie: userASession },
          body: formData,
        });
        expect(createResponse.status).toBe(200);

        // Verify it's public
        const { response: publicCheck } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });
        expect(publicCheck.status).toBe(200);

        // Update to private
        const updateResponse = await fetch(`${baseUrl}/artifacts/${artifactId}/metadata`, {
          method: 'PUT',
          headers: {
            Cookie: userASession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            isPrivate: true,
          }),
        });
        expect(updateResponse.status).toBe(200);

        // Verify it's now private (unauthenticated should get 403)
        const { response: privateCheck } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });
        expect(privateCheck.status).toBe(403);

        // But owner can still access
        const { response: ownerCheck } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
          headers: { Cookie: userASession } as Record<string, string>,
        });
        expect(ownerCheck.status).toBe(200);
      });

      it('should allow owner to make listed artifact unlisted', async () => {
        // Create listed artifact
        const artifactId = crypto.randomUUID();
        const commit = await computeArtifactCommit(artifactId, null, [], []);
        
        const formData = new FormData();
        formData.append('metadata', JSON.stringify({
          artifactId,
          commit,
          name: 'Soon Unlisted Artifact',
          isPrivate: false,
          isListed: true,
        }));
        formData.append('nodes', JSON.stringify([]));
        formData.append('edges', JSON.stringify([]));

        const createResponse = await fetch(`${baseUrl}/artifacts`, {
          method: 'POST',
          headers: { Cookie: userASession },
          body: formData,
        });
        expect(createResponse.status).toBe(200);

        // Verify it's in the list
        const { data: beforeList } = await client.GET('/artifacts');
        expect(beforeList?.artifacts.map(a => a.id)).toContain(artifactId);

        // Update to unlisted
        const updateResponse = await fetch(`${baseUrl}/artifacts/${artifactId}/metadata`, {
          method: 'PUT',
          headers: {
            Cookie: userASession,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            isListed: false,
          }),
        });
        expect(updateResponse.status).toBe(200);

        // Verify it's no longer in the list
        const { data: afterList } = await client.GET('/artifacts');
        expect(afterList?.artifacts.map(a => a.id)).not.toContain(artifactId);

        // But still accessible via direct link
        const { response: directAccess } = await client.GET('/artifacts/{artifactId}/graph', {
          params: { path: { artifactId } },
        });
        expect(directAccess.status).toBe(200);
      });
    });
  });
});
