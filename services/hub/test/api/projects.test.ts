import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ListProjectsResponse,
  ProjectDetail,
  ApiError,
  CreateProjectResponse,
  ProjectPageDetail,
} from '@pubwiki/api';
import {
  getTestDb,
  clearDatabase,
  sendRequest,
  createTestUser,
  registerUser,
  projects,
  resourceAcl,
  projectArtifacts,
  projectRoles,
  projectPages,
  artifacts,
  resourceDiscoveryControl,
  PUBLIC_USER_ID,
  user,
  eq,
  type TestDb,
} from './helpers';

describe('Projects API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/projects', () => {
    let testUserId: string;

    async function createTestProject(
      ownerId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {},
      isArchived: boolean = false
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
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

    async function addCollaborator(projectId: string, userId: string): Promise<void> {
      // 添加 ACL 写权限作为协作者
      await db.insert(resourceAcl).values({
        resourceType: 'project',
        resourceId: projectId,
        userId,
        canRead: true,
        canWrite: true,
        canManage: false,
        grantedBy: userId,
      });
    }

    async function createTestArtifact(authorId: string, name: string): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed: true,
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
      
      // Create public read ACL
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy: authorId,
      });
      
      return artifact.id;
    }

    async function addArtifactToProject(projectId: string, artifactId: string): Promise<void> {
      await db.insert(projectArtifacts).values({ projectId, artifactId });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'projectuser');
    });

    it('should return empty list when no projects exist', async () => {
      const request = new Request('http://localhost/api/projects');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectsResponse>();
      expect(data.projects).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return only public projects', async () => {
      await createTestProject(testUserId, 'Public Project', { isListed: true });
      await createTestProject(testUserId, 'Private Project', { isPrivate: true, isListed: false });
      await createTestProject(testUserId, 'Unlisted Project', { isListed: false });

      const request = new Request('http://localhost/api/projects');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Public Project');
      expect(data.pagination.total).toBe(1);
    });

    it('should exclude archived projects', async () => {
      await createTestProject(testUserId, 'Active Project', { isListed: true }, false);
      await createTestProject(testUserId, 'Archived Project', { isListed: true }, true);

      const request = new Request('http://localhost/api/projects');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].name).toBe('Active Project');
    });

    it('should include artifact count', async () => {
      const projectId = await createTestProject(testUserId, 'Project with artifacts');
      const artifactId = await createTestArtifact(testUserId, 'Test Artifact');
      await addArtifactToProject(projectId, artifactId);

      const request = new Request('http://localhost/api/projects');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectsResponse>();
      expect(data.projects).toHaveLength(1);
      expect(data.projects[0].artifactCount).toBe(1);
    });

    it('should paginate correctly', async () => {
      for (let i = 1; i <= 5; i++) {
        await createTestProject(testUserId, `Project ${i}`);
      }

      const request = new Request('http://localhost/api/projects?page=1&limit=2');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListProjectsResponse>();
      expect(data.projects).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });
  });

  describe('GET /api/projects/:projectId', () => {
    let testUserId: string;

    async function createTestProject(
      ownerId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const [project] = await db.insert(projects).values({
        ownerId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        topic: `Topic for ${name}`,
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

    async function addCollaborator(projectId: string, userId: string): Promise<void> {
      await db.insert(resourceAcl).values({
        resourceType: 'project',
        resourceId: projectId,
        userId,
        canRead: true,
        canWrite: true,
        canManage: false,
        grantedBy: userId,
      });
    }

    async function createTestRole(projectId: string, name: string, parentRoleId?: string): Promise<string> {
      const [role] = await db.insert(projectRoles).values({
        projectId,
        name,
        description: `Description for ${name}`,
        parentRoleId,
      }).returning();
      return role.id;
    }

    async function createTestArtifact(authorId: string, name: string): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed: true,
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
      
      // Create public read ACL
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy: authorId,
      });
      
      return artifact.id;
    }

    async function addArtifactToProject(projectId: string, artifactId: string, roleId?: string, isOfficial: boolean = false): Promise<void> {
      await db.insert(projectArtifacts).values({ projectId, artifactId, roleId, isOfficial });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'projectdetailuser');
    });

    it('should return project detail for public project', async () => {
      const projectId = await createTestProject(testUserId, 'Public Project Detail');

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectDetail>();
      expect(data.id).toBe(projectId);
      expect(data.name).toBe('Public Project Detail');
      expect(data.owner.username).toBe('projectdetailuser');
      expect(data.artifacts).toHaveLength(0);
      expect(data.roles).toHaveLength(0);
      expect(data.pages).toHaveLength(0);
      expect(data.homepageId).toBeNull();
    });

    it('should include roles in detail', async () => {
      const projectId = await createTestProject(testUserId, 'Project with roles');
      await createTestRole(projectId, 'Main Role');

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectDetail>();
      expect(data.roles).toHaveLength(1);
      expect(data.roles[0].name).toBe('Main Role');
    });

    it('should include role hierarchy in detail', async () => {
      const projectId = await createTestProject(testUserId, 'Project with role tree');
      const parentRoleId = await createTestRole(projectId, 'Parent Role');
      await createTestRole(projectId, 'Child Role', parentRoleId);

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectDetail>();
      expect(data.roles).toHaveLength(2);
      
      const parentRole = data.roles.find(r => r.name === 'Parent Role');
      const childRole = data.roles.find(r => r.name === 'Child Role');
      
      expect(parentRole).toBeDefined();
      expect(parentRole!.parentRoleId).toBeNull();
      
      expect(childRole).toBeDefined();
      expect(childRole!.parentRoleId).toBe(parentRoleId);
    });

    it('should include artifacts with ArtifactListItem format', async () => {
      const projectId = await createTestProject(testUserId, 'Project with artifacts');
      const roleId = await createTestRole(projectId, 'Main Role');
      const artifactId = await createTestArtifact(testUserId, 'Test Artifact');
      await addArtifactToProject(projectId, artifactId, roleId, true);

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectDetail>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].artifact.name).toBe('Test Artifact');
      expect(data.artifacts[0].artifact.author.username).toBe('projectdetailuser');
      expect(data.artifacts[0].role?.name).toBe('Main Role');
      expect(data.artifacts[0].isOfficial).toBe(true);
    });

    it('should distinguish official and non-official artifacts', async () => {
      const projectId = await createTestProject(testUserId, 'Project with mixed artifacts');
      const officialArtifactId = await createTestArtifact(testUserId, 'Official Artifact');
      const nonOfficialArtifactId = await createTestArtifact(testUserId, 'Non-Official Artifact');
      await addArtifactToProject(projectId, officialArtifactId, undefined, true);
      await addArtifactToProject(projectId, nonOfficialArtifactId, undefined, false);

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectDetail>();
      expect(data.artifacts).toHaveLength(2);
      
      const officialArtifact = data.artifacts.find(a => a.artifact.name === 'Official Artifact');
      const nonOfficialArtifact = data.artifacts.find(a => a.artifact.name === 'Non-Official Artifact');
      
      expect(officialArtifact!.isOfficial).toBe(true);
      expect(nonOfficialArtifact!.isOfficial).toBe(false);
    });

    it('should return 404 for non-existent project', async () => {
      const request = new Request('http://localhost/api/projects/non-existent-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('project not found');
    });

    it('should return unlisted project without auth (unlisted but not private)', async () => {
      const projectId = await createTestProject(testUserId, 'Unlisted Project', { isPrivate: false, isListed: false });

      const request = new Request(`http://localhost/api/projects/${projectId}`);
      const response = await sendRequest(request);

      // Unlisted but not private resources are publicly accessible via direct link
      expect(response.status).toBe(200);
    });

    it('should return unlisted project with auth', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('unlistedprojectuser');
      const projectId = await createTestProject(userId, 'Unlisted Project', { isPrivate: false, isListed: false });

      const request = new Request(`http://localhost/api/projects/${projectId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return 403 for private project with non-owner auth', async () => {
      const projectId = await createTestProject(testUserId, 'Private Project', { isPrivate: true, isListed: false });
      const { sessionCookie } = await registerUser('otheruser');

      const request = new Request(`http://localhost/api/projects/${projectId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return private project for owner', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('privateprojectowner');
      const projectId = await createTestProject(userId, 'Private Project', { isPrivate: true, isListed: false });

      const request = new Request(`http://localhost/api/projects/${projectId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return private project for user with ACL read permission', async () => {
      const projectId = await createTestProject(testUserId, 'Private Project', { isPrivate: true, isListed: false });
      
      // Create user with ACL access
      const { sessionCookie, userId: collaboratorId } = await registerUser('collaboratoruser');
      await addCollaborator(projectId, collaboratorId);

      const request = new Request(`http://localhost/api/projects/${projectId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/projects', () => {
    async function createTestArtifact(authorId: string, name: string): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        name,
      }).returning();
      
      // Create discovery control record
      await db.insert(resourceDiscoveryControl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        isListed: true,
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
      
      // Create public read ACL
      await db.insert(resourceAcl).values({
        resourceType: 'artifact',
        resourceId: artifact.id,
        userId: PUBLIC_USER_ID,
        canRead: true,
        canWrite: false,
        canManage: false,
        grantedBy: authorId,
      });
      
      return artifact.id;
    }

    it('should return 401 when not authenticated', async () => {
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Project',
          slug: 'test-project',
          topic: 'test-topic',
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should create a project with basic metadata', async () => {
      const { sessionCookie } = await registerUser('projectcreator');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Project',
          slug: 'test-project',
          topic: 'test-topic',
          description: 'A test project',
          license: 'MIT',
          isListed: true,
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectResponse>();
      expect(data.message).toBe('Project created successfully');
      expect(data.project.name).toBe('Test Project');
      expect(data.project.slug).toBe('test-project');
      expect(data.project.topic).toBe('test-topic');
      expect(data.project.description).toBe('A test project');
      expect(data.project.license).toBe('MIT');
      expect(data.project.isListed).toBe(true);
      expect(data.project.pages).toHaveLength(0);
      expect(data.project.homepageId).toBeNull();
    });

    it('should create a project with specified visibility', async () => {
      const { sessionCookie } = await registerUser('projectcreator2');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Unlisted Project',
          slug: 'unlisted-project',
          topic: 'test-topic',
          isListed: false,
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectResponse>();
      expect(data.project.isListed).toBe(false);
    });

    it('should create a project with linked artifacts', async () => {
      const { sessionCookie, userId } = await registerUser('projectcreator3');
      const artifactId = await createTestArtifact(userId, 'Test Artifact');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Artifact',
          slug: 'project-with-artifact',
          topic: 'test-topic',
          artifacts: [
            { artifactId, roleName: 'Default Role' }
          ],
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectResponse>();
      expect(data.project.artifacts).toHaveLength(1);
      expect(data.project.artifacts[0].artifact.name).toBe('Test Artifact');
      expect(data.project.artifacts[0].isOfficial).toBe(true);
    });

    it('should create a project with roles', async () => {
      const { sessionCookie } = await registerUser('projectcreatorwithroles');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Roles',
          slug: 'project-with-roles',
          topic: 'test-topic',
          roles: [
            { name: 'Main Role', description: 'The main role' },
            { name: 'Sub Role', parentName: 'Main Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectResponse>();
      expect(data.project.roles).toHaveLength(2);
      
      const mainRole = data.project.roles.find(r => r.name === 'Main Role');
      const subRole = data.project.roles.find(r => r.name === 'Sub Role');
      
      expect(mainRole).toBeDefined();
      expect(mainRole!.description).toBe('The main role');
      expect(mainRole!.parentRoleId).toBeNull();
      
      expect(subRole).toBeDefined();
      expect(subRole!.parentRoleId).toBe(mainRole!.id);
    });

    it('should return 400 when role parentName is invalid', async () => {
      const { sessionCookie } = await registerUser('projectcreatorinvalidrole');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Invalid Role',
          slug: 'project-with-invalid-role',
          topic: 'test-topic',
          roles: [
            { name: 'Child Role', parentName: 'non-existent-parent' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('non-existent-parent');
    });

    it('should create a project with pages', async () => {
      const { sessionCookie } = await registerUser('projectcreatorwithpages');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Pages',
          slug: 'project-with-pages',
          topic: 'test-topic',
          roles: [
            { name: 'Default Role' },
          ],
          pages: [
            { name: 'Home', icon: '🏠', content: '<h1>Welcome</h1>' },
            { name: 'About', icon: '📖', content: '<p>About us</p>' },
          ],
          homepageIndex: 0,
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(201);
      const data = await response.json<CreateProjectResponse>();
      expect(data.project.pages).toHaveLength(2);
      
      const homePage = data.project.pages.find(p => p.name === 'Home');
      const aboutPage = data.project.pages.find(p => p.name === 'About');
      
      expect(homePage).toBeDefined();
      expect(homePage!.icon).toBe('🏠');
      expect(homePage!.order).toBe(0);
      
      expect(aboutPage).toBeDefined();
      expect(aboutPage!.icon).toBe('📖');
      expect(aboutPage!.order).toBe(1);
      
      // Check homepage is set correctly
      expect(data.project.homepageId).toBe(homePage!.id);
    });

    it('should return 400 when homepageIndex is out of range', async () => {
      const { sessionCookie } = await registerUser('projectcreatorinvalidhomepage');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Invalid Homepage',
          slug: 'project-invalid-homepage',
          topic: 'test-topic',
          roles: [
            { tempId: 'role-1', name: 'Default Role' },
          ],
          pages: [
            { name: 'Home 1' },
            { name: 'Home 2' },
          ],
          homepageIndex: 5, // Out of range
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('homepageIndex');
    });

    it('should return 400 when required fields are missing', async () => {
      const { sessionCookie } = await registerUser('projectcreator6');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Project',
          // missing slug and topic
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('slug');
    });

    it('should return 400 for invalid slug format', async () => {
      const { sessionCookie } = await registerUser('projectcreator7');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Test Project',
          slug: 'Invalid Slug!',
          topic: 'test-topic',
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('slug');
    });

    it('should return 409 when slug already exists', async () => {
      const { sessionCookie } = await registerUser('projectcreator8');

      // Create first project
      await sendRequest(new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'First Project',
          slug: 'duplicate-slug',
          topic: 'test-topic',
          roles: [
            { name: 'Default Role' },
          ],
        }),
      }));

      // Try to create second project with same slug
      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Second Project',
          slug: 'duplicate-slug',
          topic: 'test-topic',
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(409);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('slug');
    });

    it('should return 400 when artifact not found', async () => {
      const { sessionCookie } = await registerUser('projectcreator9');

      const request = new Request('http://localhost/api/projects', {
        method: 'POST',
        headers: {
          Cookie: sessionCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Project with Invalid Artifact',
          slug: 'project-invalid-artifact',
          topic: 'test-topic',
          artifacts: [
            { artifactId: '00000000-0000-0000-0000-000000000000', roleName: 'Default Role' }
          ],
          roles: [
            { name: 'Default Role' },
          ],
        }),
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Artifacts not found');
    });
  });

  describe('GET /api/projects/:projectId/pages/:pageId', () => {
    let testUserId: string;

    async function createTestProject(
      ownerId: string,
      name: string,
      options: { isPrivate?: boolean; isListed?: boolean } = {}
    ): Promise<string> {
      const { isPrivate = false, isListed = true } = options;
      const [project] = await db.insert(projects).values({
        ownerId,
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        topic: `Topic for ${name}`,
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

    async function createTestPage(projectId: string, name: string, content: string, order: number = 0): Promise<string> {
      const [page] = await db.insert(projectPages).values({
        projectId,
        name,
        content,
        order,
      }).returning();
      return page.id;
    }

    async function addCollaborator(projectId: string, userId: string): Promise<void> {
      await db.insert(resourceAcl).values({
        resourceType: 'project',
        resourceId: projectId,
        userId,
        canRead: true,
        canWrite: true,
        canManage: false,
        grantedBy: userId,
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'pageuser');
    });

    it('should return page detail for public project', async () => {
      const projectId = await createTestProject(testUserId, 'Public Project with Page');
      const pageId = await createTestPage(projectId, 'Test Page', '<h1>Test Content</h1>');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ProjectPageDetail>();
      expect(data.id).toBe(pageId);
      expect(data.name).toBe('Test Page');
      expect(data.content).toBe('<h1>Test Content</h1>');
    });

    it('should return 404 for non-existent page', async () => {
      const projectId = await createTestProject(testUserId, 'Project without this page');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/non-existent-page-id`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Page not found');
    });

    it('should return 404 for non-existent project', async () => {
      const request = new Request('http://localhost/api/projects/non-existent-project/pages/some-page-id');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('project not found');
    });

    it('should return unlisted project page without auth (unlisted but not private)', async () => {
      const projectId = await createTestProject(testUserId, 'Unlisted Project', { isPrivate: false, isListed: false });
      const pageId = await createTestPage(projectId, 'Page', '<p>Content</p>');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`);
      const response = await sendRequest(request);

      // Unlisted but not private resources are publicly accessible
      expect(response.status).toBe(200);
    });

    it('should return page for unlisted project with auth', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('unlistedpageuser');
      const projectId = await createTestProject(userId, 'Unlisted Project', { isPrivate: false, isListed: false });
      const pageId = await createTestPage(projectId, 'Page', '<p>Content</p>');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return 403 for private project page with non-owner auth', async () => {
      const projectId = await createTestProject(testUserId, 'Private Project', { isPrivate: true, isListed: false });
      const pageId = await createTestPage(projectId, 'Page', '<p>Content</p>');
      const { sessionCookie } = await registerUser('otheruser');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return private project page for owner', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('privatepageowner');
      const projectId = await createTestProject(userId, 'Private Project', { isPrivate: true, isListed: false });
      const pageId = await createTestPage(projectId, 'Page', '<p>Content</p>');

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return private project page for user with ACL permission', async () => {
      const projectId = await createTestProject(testUserId, 'Private Project', { isPrivate: true, isListed: false });
      const pageId = await createTestPage(projectId, 'Page', '<p>Content</p>');
      
      const { sessionCookie, userId: collaboratorId } = await registerUser('collaboratoruser');
      await addCollaborator(projectId, collaboratorId);

      const request = new Request(`http://localhost/api/projects/${projectId}/pages/${pageId}`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });
  });
});
