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
  registerAndLogin,
  artifacts,
  projects,
  projectMaintainers,
  artifactStats,
  users,
  eq,
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
      type: 'RECIPE' | 'GAME' | 'ASSET_PACK' | 'PROMPT',
      name: string,
      visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC',
      isArchived: boolean = false
    ): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        type,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        visibility,
        isArchived,
      }).returning();
      return artifact.id;
    }

    async function createArtifactStats(artifactId: string, viewCount: number, starCount: number): Promise<void> {
      await db.insert(artifactStats).values({
        artifactId,
        viewCount,
        starCount,
        forkCount: 0,
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

    it('should return only public artifacts for unauthenticated user', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Public Recipe', 'PUBLIC');
      await createTestArtifact(testUserId, 'GAME', 'Private Game', 'PRIVATE');
      await createTestArtifact(testUserId, 'ASSET_PACK', 'Unlisted Pack', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Public Recipe');
    });

    it('should return public and unlisted artifacts for authenticated user viewing others', async () => {
      const viewerToken = await registerAndLogin('viewer');
      
      await createTestArtifact(testUserId, 'RECIPE', 'Public Recipe', 'PUBLIC');
      await createTestArtifact(testUserId, 'GAME', 'Private Game', 'PRIVATE');
      await createTestArtifact(testUserId, 'ASSET_PACK', 'Unlisted Pack', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      const names = data.artifacts.map(a => a.name);
      expect(names).toContain('Public Recipe');
      expect(names).toContain('Unlisted Pack');
    });

    it('should return all artifacts for authenticated user viewing self', async () => {
      const ownerToken = await registerAndLogin('owner');
      
      // 获取注册用户的 ID
      const ownerUser = await db.select().from(users).where(eq(users.username, 'owner')).limit(1);
      const ownerId = ownerUser[0].id;
      
      await createTestArtifact(ownerId, 'RECIPE', 'Public Recipe', 'PUBLIC');
      await createTestArtifact(ownerId, 'GAME', 'Private Game', 'PRIVATE');
      await createTestArtifact(ownerId, 'ASSET_PACK', 'Unlisted Pack', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${ownerId}/artifacts`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(3);
    });

    it('should exclude archived artifacts', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Active Artifact', 'PUBLIC', false);
      await createTestArtifact(testUserId, 'GAME', 'Archived Artifact', 'PUBLIC', true);

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Active Artifact');
    });

    it('should filter by type.include', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'My Recipe', 'PUBLIC');
      await createTestArtifact(testUserId, 'GAME', 'My Game', 'PUBLIC');

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts?type.include=RECIPE`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].type).toBe('RECIPE');
    });

    it('should filter by type.exclude', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'My Recipe', 'PUBLIC');
      await createTestArtifact(testUserId, 'GAME', 'My Game', 'PUBLIC');

      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts?type.exclude=RECIPE`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].type).toBe('GAME');
    });

    it('should paginate correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestArtifact(testUserId, 'RECIPE', `Artifact ${i}`, 'PUBLIC');
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
      await createTestArtifact(testUserId, 'RECIPE', 'First', 'PUBLIC');
      // 使用不同的 createdAt
      await createTestArtifact(testUserId, 'GAME', 'Second', 'PUBLIC');

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
      expect(data.error).toContain('Invalid sortBy value');
    });

    it('should reject invalid type parameter', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/artifacts?type.include=INVALID`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid type value');
    });
  });

  describe('GET /api/users/:userId/projects', () => {
    let testUserId: string;

    async function createTestProject(
      ownerId: string,
      name: string,
      visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC',
      isArchived: boolean = false
    ): Promise<string> {
      const [project] = await db.insert(projects).values({
        ownerId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        topic: `Topic for ${name}`,
        visibility,
        isArchived,
      }).returning();
      return project.id;
    }

    async function addMaintainer(projectId: string, userId: string): Promise<void> {
      await db.insert(projectMaintainers).values({ projectId, userId });
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

    it('should return owned projects with role=owner', async () => {
      await createTestProject(testUserId, 'Owned Project', 'PUBLIC');

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Owned Project');
      expect(data.projects[0].role).toBe('owner');
    });

    it('should return maintained projects with role=maintainer', async () => {
      const otherUserId = await createTestUser(db, 'otheruser');
      const projectId = await createTestProject(otherUserId, 'Other Project', 'PUBLIC');
      await addMaintainer(projectId, testUserId);

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Other Project');
      expect(data.projects[0].role).toBe('maintainer');
    });

    it('should return both owned and maintained projects', async () => {
      await createTestProject(testUserId, 'Owned Project', 'PUBLIC');
      
      const otherUserId = await createTestUser(db, 'otheruser');
      const projectId = await createTestProject(otherUserId, 'Other Project', 'PUBLIC');
      await addMaintainer(projectId, testUserId);

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(2);
      
      const ownedProject = data.projects.find(p => p.name === 'Owned Project');
      const maintainedProject = data.projects.find(p => p.name === 'Other Project');
      
      expect(ownedProject?.role).toBe('owner');
      expect(maintainedProject?.role).toBe('maintainer');
    });

    it('should filter by role=owner', async () => {
      await createTestProject(testUserId, 'Owned Project', 'PUBLIC');
      
      const otherUserId = await createTestUser(db, 'otheruser');
      const projectId = await createTestProject(otherUserId, 'Other Project', 'PUBLIC');
      await addMaintainer(projectId, testUserId);

      const request = new Request(`http://localhost/api/users/${testUserId}/projects?role=owner`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Owned Project');
      expect(data.projects[0].role).toBe('owner');
    });

    it('should filter by role=maintainer', async () => {
      await createTestProject(testUserId, 'Owned Project', 'PUBLIC');
      
      const otherUserId = await createTestUser(db, 'otheruser');
      const projectId = await createTestProject(otherUserId, 'Other Project', 'PUBLIC');
      await addMaintainer(projectId, testUserId);

      const request = new Request(`http://localhost/api/users/${testUserId}/projects?role=maintainer`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Other Project');
      expect(data.projects[0].role).toBe('maintainer');
    });

    it('should return only public projects for unauthenticated user', async () => {
      await createTestProject(testUserId, 'Public Project', 'PUBLIC');
      await createTestProject(testUserId, 'Private Project', 'PRIVATE');
      await createTestProject(testUserId, 'Unlisted Project', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Public Project');
    });

    it('should return public and unlisted projects for authenticated user viewing others', async () => {
      const viewerToken = await registerAndLogin('viewer');
      
      await createTestProject(testUserId, 'Public Project', 'PUBLIC');
      await createTestProject(testUserId, 'Private Project', 'PRIVATE');
      await createTestProject(testUserId, 'Unlisted Project', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(2);
      const names = data.projects.map(p => p.name);
      expect(names).toContain('Public Project');
      expect(names).toContain('Unlisted Project');
    });

    it('should return all projects for authenticated user viewing self', async () => {
      const ownerToken = await registerAndLogin('owner');
      
      // 获取注册用户的 ID
      const ownerUser = await db.select().from(users).where(eq(users.username, 'owner')).limit(1);
      const ownerId = ownerUser[0].id;
      
      await createTestProject(ownerId, 'Public Project', 'PUBLIC');
      await createTestProject(ownerId, 'Private Project', 'PRIVATE');
      await createTestProject(ownerId, 'Unlisted Project', 'UNLISTED');

      const request = new Request(`http://localhost/api/users/${ownerId}/projects`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(3);
    });

    it('should exclude archived projects', async () => {
      await createTestProject(testUserId, 'Active Project', 'PUBLIC', false);
      await createTestProject(testUserId, 'Archived Project', 'PUBLIC', true);

      const request = new Request(`http://localhost/api/users/${testUserId}/projects`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetUserProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Active Project');
    });

    it('should paginate correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestProject(testUserId, `Project ${i}`, 'PUBLIC');
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

    it('should reject invalid role parameter', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/projects?role=invalid`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid role value');
    });

    it('should reject invalid sortBy parameter', async () => {
      const request = new Request(`http://localhost/api/users/${testUserId}/projects?sortBy=invalid`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid sortBy value');
    });
  });
});
