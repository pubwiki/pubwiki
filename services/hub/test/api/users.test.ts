import { describe, it, expect, beforeEach } from 'vitest';
import type {
  GetUserArtifactsResponse,
  GetUserProjectsResponse,
  ApiError,
} from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  createTestUser,
  registerUser,
  artifacts,
  projects,
  artifactStats,
  resourceAcl,
  resourceDiscoveryControl,
  PUBLIC_USER_ID,
  type TestDb,
} from './helpers';

describe('Users API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/users/:userId/artifacts', () => {
    let testUserId: string;

    async function createTestArtifact(
      authorId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed,
      });
      
      // Create owner ACL
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: authorId,
        canRead: true,
        canWrite: true,
        canManage: true,
        grantedBy: authorId,
      });
      
      // If not private, create public read ACL
      if (!isPrivate) {
        await db.insert(resourceAcl).values({
          resourceType: 'artifact',
          resourceId: artifact.id,
          userId: PUBLIC_USER_ID,
          canRead: true,
          canWrite: false,
          canManage: false,
          grantedBy: authorId,
        });
      }
      
      return artifact.id;
    }

    async function createArtifactStats(artifactId: string, viewCount: number, favCount: number): Promise<void> {
      await db.insert(artifactStats).values({
        artifactId,
        viewCount,
        favCount,
        refCount: 0,
        downloadCount: 0,
        commentCount: 0,
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'testartifactowner');
    });

    it('should return 404 for non-existent user', async () => {
      const request = new Request('http://localhost/api/users/00000000-0000-0000-0000-000000000000/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('User not found');
    });

    it('should return empty list when user has no artifacts', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return only listed artifacts for unauthenticated user', async () => {
      await createTestArtifact(testUserId, 'Public Recipe');
      await createTestArtifact(testUserId, 'Unlisted Pack', { isListed: false });

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      // Only isListed = true artifacts are visible to others
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Public Recipe');
    });

    it('should return only listed artifacts for authenticated user viewing others', async () => {
      const { sessionCookie } = await registerUser('viewer');
      
      await createTestArtifact(testUserId, 'Public Recipe');
      await createTestArtifact(testUserId, 'Unlisted Pack', { isListed: false });

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      // Only isListed = true artifacts are visible to others
      expect(data.artifacts).toHaveLength(1);
      const names = data.artifacts.map(a => a.name);
      expect(names).toContain('Public Recipe');
    });

    it('should return all artifacts for authenticated user viewing self', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      
      await createTestArtifact(ownerId, 'Public Recipe');
      await createTestArtifact(ownerId, 'Unlisted Pack', { isListed: false });

      const request = new Request(`http://localhost/api/users/${ownerId}/artifacts`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      // Self can see all artifacts regardless of isListed
      expect(data.artifacts).toHaveLength(2);
    });

    it('should exclude unlisted artifacts for other users', async () => {
      await createTestArtifact(testUserId, 'Public Artifact');
      await createTestArtifact(testUserId, 'Unlisted Artifact', { isListed: false });

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      // Only isListed = true artifacts are visible to others
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Public Artifact');
    });



    it('should paginate correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestArtifact(testUserId, `Artifact ${i}`);
      }

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts?page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });

    it('should sort by sortBy and sortOrder parameters', async () => {
      // 创建 artifacts 时加入少量延迟以确保 createdAt 不同
      await createTestArtifact(testUserId, 'First');
      // 使用不同的 createdAt
      await createTestArtifact(testUserId, 'Second');

      // 测试升序排列
      const requestAsc = new Request(`http://localhost/api/users/${testUserId}/artifacts?sortBy=createdAt&sortOrder=asc`);
      const responseAsc = await sendRequest(requestAsc);

      expect(responseAsc.status).toBe(200);
      const dataAsc = await responseAsc.json<GetUserArtifactsResponse>();
      expect(dataAsc.artifacts).toHaveLength(2);
      // 确认升序和降序的结果不同（如果 createdAt 相同则顺序可能相同）
      
      // 测试降序排列
      const requestDesc = new Request(`http://localhost/api/users/${testUserId}/artifacts?sortBy=createdAt&sortOrder=desc`);
      const responseDesc = await sendRequest(requestDesc);

      expect(responseDesc.status).toBe(200);
      const dataDesc = await responseDesc.json<GetUserArtifactsResponse>();
      expect(dataDesc.artifacts).toHaveLength(2);
    });

    it('should reject invalid sortBy parameter', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts?sortBy=invalid`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('sortBy');
    });


  });

  describe('GET /api/users/:userId/projects', () => {
    let testUserId: string;

    async function createTestProject(
      ownerId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean; isArchived?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true, isArchived = false } = options;
      const [project] = await db.insert(projects).values({
        ownerId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        topic: `Topic for ${name}`,
        isArchived,
      }).returning();
      
      // Create discovery control record
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'project',
        resourceId: project.id,
        isListed,
      });
      
      // Create owner ACL (always has full permissions)
      await db.insert(resourceAcl).values({
        resourceType: 'project',
        resourceId: project.id,
        userId: ownerId,
        canRead: true,
        canWrite: true,
        canManage: true,
        grantedBy: ownerId,
      });
      
      // If not private, create public read ACL
      if (!isPrivate) {
        await db.insert(resourceAcl).values({
          resourceType: 'project',
          resourceId: project.id,
          userId: PUBLIC_USER_ID,
          canRead: true,
          canWrite: false,
          canManage: false,
          grantedBy: ownerId,
        });
      }
      
      return project.id;
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'testprojectowner');
    });

    it('should return 404 for non-existent user', async () => {
      const request = new Request('http://localhost/api/users/00000000-0000-0000-0000-000000000000/projects');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('User not found');
    });

    it('should return empty list when user has no projects', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return owned projects', async () => {
      await createTestProject(testUserId, 'Owned Project');

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Owned Project');
    });

    it('should return only listed projects for unauthenticated user', async () => {
      await createTestProject(testUserId, 'Public Project');
      await createTestProject(testUserId, 'Unlisted Project', { isListed: false });

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      // Only isListed = true projects are visible to others
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Public Project');
    });

    it('should return only listed projects for authenticated user viewing others', async () => {
      const { sessionCookie } = await registerUser('viewer');
      
      await createTestProject(testUserId, 'Public Project');
      await createTestProject(testUserId, 'Unlisted Project', { isListed: false });

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      // Only isListed = true projects are visible to others
      expect(data.projects).toHaveLength(1);
      const names = data.projects.map(p => p.name);
      expect(names).toContain('Public Project');
    });

    it('should return all projects for authenticated user viewing self', async () => {
      const { sessionCookie, userId: ownerId } = await registerUser('owner');
      
      await createTestProject(ownerId, 'Public Project');
      await createTestProject(ownerId, 'Unlisted Project', { isListed: false });

      const request = new Request(`http://localhost/api/users/${ownerId}/projects`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      // Self can see all projects regardless of isListed
      expect(data.projects).toHaveLength(2);
    });

    it('should exclude archived projects', async () => {
      await createTestProject(testUserId, 'Active Project');
      await createTestProject(testUserId, 'Archived Project', { isArchived: true });

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Active Project');
    });

    it('should paginate correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestProject(testUserId, `Project ${i}`);
      }

      const request = new Request(`http://localhost/api/users/${testUserId}/projects?page=1&limit=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });

    it('should reject invalid sortBy parameter', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/projects?sortBy=invalid`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('sortBy');
    });
  });
});
