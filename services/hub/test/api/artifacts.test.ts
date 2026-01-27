import { describe, it, expect, beforeEach } from 'vitest';
import type {
  RegisterResponse,
  ListArtifactsResponse,
  GetArtifactLineageResponse,
  CreateArtifactResponse,
  ApiError,
} from '@pubwiki/api';
import {
  getTestDb,
  getTestR2Bucket,
  clearDatabase,
  sendRequest,
  registerUser,
  createTestUser,
  createVfsTarGz,
  user,
  artifacts,
  tags,
  artifactTags,
  artifactStats,
  artifactVersions,
  artifactNodes,
  artifactNodeVersions,
  artifactLineage,
  eq,
  type TestDb,
} from './helpers';

describe('Artifacts API', () => {
  let db: TestDb;

  beforeEach(async () => {
    db = getTestDb();
    await clearDatabase(db);
  });

  describe('GET /api/artifacts', () => {
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

    async function createTestTag(name: string): Promise<string> {
      const [tag] = await db.insert(tags).values({
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
      }).returning();
      return tag.id;
    }

    async function addTagToArtifact(artifactId: string, tagId: string): Promise<void> {
      await db.insert(artifactTags).values({ artifactId, tagId });
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
      testUserId = await createTestUser(db, 'artifactuser');
    });

    it('should return empty list when no artifacts exist', async () => {
      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(0);
      expect(data.pagination.total).toBe(0);
    });

    it('should return only public artifacts', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Public Recipe', 'PUBLIC');
      await createTestArtifact(testUserId, 'GAME', 'Private Game', 'PRIVATE');
      await createTestArtifact(testUserId, 'ASSET_PACK', 'Unlisted Pack', 'UNLISTED');

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Public Recipe');
      expect(data.pagination.total).toBe(1);
    });

    it('should exclude archived artifacts', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Active Recipe', 'PUBLIC', false);
      await createTestArtifact(testUserId, 'GAME', 'Archived Game', 'PUBLIC', true);

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Active Recipe');
    });

    it('should filter by type.include', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Recipe 1');
      await createTestArtifact(testUserId, 'GAME', 'Game 1');
      await createTestArtifact(testUserId, 'ASSET_PACK', 'Asset Pack 1');

      const request = new Request('http://localhost/api/artifacts?type.include=RECIPE&type.include=GAME');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      const types = data.artifacts.map(a => a.type);
      expect(types).toContain('RECIPE');
      expect(types).toContain('GAME');
      expect(types).not.toContain('ASSET_PACK');
    });

    it('should filter by type.exclude', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Recipe 1');
      await createTestArtifact(testUserId, 'GAME', 'Game 1');
      await createTestArtifact(testUserId, 'PROMPT', 'Prompt 1');

      const request = new Request('http://localhost/api/artifacts?type.exclude=GAME');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      const types = data.artifacts.map(a => a.type);
      expect(types).not.toContain('GAME');
    });

    it('should filter by tag.include (AND logic)', async () => {
      const artifactId1 = await createTestArtifact(testUserId, 'RECIPE', 'Recipe with both tags');
      const artifactId2 = await createTestArtifact(testUserId, 'GAME', 'Game with one tag');
      const artifactId3 = await createTestArtifact(testUserId, 'PROMPT', 'Prompt with no tags');

      const tag1Id = await createTestTag('javascript');
      const tag2Id = await createTestTag('tutorial');

      await addTagToArtifact(artifactId1, tag1Id);
      await addTagToArtifact(artifactId1, tag2Id);
      await addTagToArtifact(artifactId2, tag1Id);

      const request = new Request('http://localhost/api/artifacts?tag.include=javascript&tag.include=tutorial');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Recipe with both tags');
    });

    it('should filter by tag.exclude', async () => {
      const artifactId1 = await createTestArtifact(testUserId, 'RECIPE', 'Recipe to keep');
      const artifactId2 = await createTestArtifact(testUserId, 'GAME', 'Game to exclude');

      const tagId = await createTestTag('deprecated');
      await addTagToArtifact(artifactId2, tagId);

      const request = new Request('http://localhost/api/artifacts?tag.exclude=deprecated');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(1);
      expect(data.artifacts[0].name).toBe('Recipe to keep');
    });

    it('should sort by createdAt desc by default', async () => {
      // 直接设置不同的时间戳来测试排序
      await db.insert(artifacts).values({
        authorId: testUserId,
        type: 'RECIPE',
        name: 'First',
        slug: 'first',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });
      
      await db.insert(artifacts).values({
        authorId: testUserId,
        type: 'GAME',
        name: 'Second',
        slug: 'second',
        createdAt: '2024-01-02T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      });
      
      await db.insert(artifacts).values({
        authorId: testUserId,
        type: 'PROMPT',
        name: 'Third',
        slug: 'third',
        createdAt: '2024-01-03T00:00:00Z',
        updatedAt: '2024-01-03T00:00:00Z',
      });

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(3);
      expect(data.artifacts[0].name).toBe('Third');
      expect(data.artifacts[2].name).toBe('First');
    });

    it('should sort by viewCount', async () => {
      const id1 = await createTestArtifact(testUserId, 'RECIPE', 'Low views');
      const id2 = await createTestArtifact(testUserId, 'GAME', 'High views');
      const id3 = await createTestArtifact(testUserId, 'PROMPT', 'Medium views');

      await createArtifactStats(id1, 10, 0);
      await createArtifactStats(id2, 100, 0);
      await createArtifactStats(id3, 50, 0);

      const request = new Request('http://localhost/api/artifacts?sortBy=viewCount&sortOrder=desc');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0].name).toBe('High views');
      expect(data.artifacts[1].name).toBe('Medium views');
      expect(data.artifacts[2].name).toBe('Low views');
    });

    it('should paginate correctly', async () => {
      // Create 5 artifacts
      for (let i = 1; i <= 5; i++) {
        await createTestArtifact(testUserId, 'RECIPE', `Recipe ${i}`);
      }

      const request = new Request('http://localhost/api/artifacts?page=1&limit=2');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts).toHaveLength(2);
      expect(data.pagination.page).toBe(1);
      expect(data.pagination.limit).toBe(2);
      expect(data.pagination.total).toBe(5);
      expect(data.pagination.totalPages).toBe(3);
    });

    it('should include author info', async () => {
      await createTestArtifact(testUserId, 'RECIPE', 'Test Recipe');

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0].author).toBeDefined();
      expect(data.artifacts[0].author.username).toBe('artifactuser');
    });

    it('should include tags', async () => {
      const artifactId = await createTestArtifact(testUserId, 'RECIPE', 'Tagged Recipe');
      const tagId = await createTestTag('awesome');
      await addTagToArtifact(artifactId, tagId);

      const request = new Request('http://localhost/api/artifacts');
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<ListArtifactsResponse>();
      expect(data.artifacts[0]!.tags!).toHaveLength(1);
      expect(data.artifacts[0]!.tags![0]!.slug).toBe('awesome');
    });

    it('should return 400 for invalid sortBy', async () => {
      const request = new Request('http://localhost/api/artifacts?sortBy=invalid');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid sortBy');
    });

    it('should return 400 for invalid type', async () => {
      const request = new Request('http://localhost/api/artifacts?type.include=INVALID');
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid type');
    });
  });

  describe('GET /api/artifacts/:artifactId/lineage', () => {
    let testUserId: string;

    async function createTestArtifact(
      authorId: string,
      name: string,
      visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC'
    ): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        type: 'RECIPE',
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        visibility,
      }).returning();
      return artifact.id;
    }

    async function createLineage(
      childId: string,
      parentId: string,
      type: 'DEPENDS_ON' | 'FORKED_FROM' | 'INSPIRED_BY' | 'GENERATED_BY' = 'DEPENDS_ON'
    ): Promise<void> {
      await db.insert(artifactLineage).values({
        childArtifactId: childId,
        parentArtifactId: parentId,
        lineageType: type,
        description: `${type} relationship`,
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'lineageuser');
    });

    it('should return empty lineage for artifact with no relationships', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Solo Artifact');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      expect(data.parents).toHaveLength(0);
      expect(data.children).toHaveLength(0);
    });

    it('should return parent artifacts', async () => {
      const parentId = await createTestArtifact(testUserId, 'Parent Artifact');
      const childId = await createTestArtifact(testUserId, 'Child Artifact');
      await createLineage(childId, parentId, 'DEPENDS_ON');

      const request = new Request(`http://localhost/api/artifacts/${childId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      expect(data.parents).toHaveLength(1);
      expect(data.parents[0].artifact.name).toBe('Parent Artifact');
      expect(data.parents[0].lineageType).toBe('DEPENDS_ON');
      expect(data.parents[0].parentId).toBeNull(); // First level has null parentId
      expect(data.children).toHaveLength(0);
    });

    it('should return child artifacts', async () => {
      const parentId = await createTestArtifact(testUserId, 'Parent Artifact');
      const childId = await createTestArtifact(testUserId, 'Child Artifact');
      await createLineage(childId, parentId, 'FORKED_FROM');

      const request = new Request(`http://localhost/api/artifacts/${parentId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      expect(data.parents).toHaveLength(0);
      expect(data.children).toHaveLength(1);
      expect(data.children[0].artifact.name).toBe('Child Artifact');
      expect(data.children[0].lineageType).toBe('FORKED_FROM');
      expect(data.children[0].parentId).toBeNull(); // First level has null parentId
    });

    it('should return both parents and children', async () => {
      const grandparentId = await createTestArtifact(testUserId, 'Grandparent');
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const childId = await createTestArtifact(testUserId, 'Child');
      
      await createLineage(parentId, grandparentId, 'DEPENDS_ON');
      await createLineage(childId, parentId, 'FORKED_FROM');

      const request = new Request(`http://localhost/api/artifacts/${parentId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      expect(data.parents).toHaveLength(1);
      expect(data.parents[0].artifact.name).toBe('Grandparent');
      expect(data.children).toHaveLength(1);
      expect(data.children[0].artifact.name).toBe('Child');
    });

    it('should recursively fetch multi-generation parents with parentId for tree building', async () => {
      // Create a 4-level lineage: greatgrandparent -> grandparent -> parent -> child
      const greatgrandparentId = await createTestArtifact(testUserId, 'GreatGrandparent');
      const grandparentId = await createTestArtifact(testUserId, 'Grandparent');
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const childId = await createTestArtifact(testUserId, 'Child');
      
      await createLineage(grandparentId, greatgrandparentId, 'DEPENDS_ON');
      await createLineage(parentId, grandparentId, 'DEPENDS_ON');
      await createLineage(childId, parentId, 'DEPENDS_ON');

      // Query from child - should get all 3 ancestors
      const request = new Request(`http://localhost/api/artifacts/${childId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should have 3 parents (parent, grandparent, greatgrandparent)
      expect(data.parents).toHaveLength(3);
      
      // Find each level
      const parent = data.parents.find(p => p.artifact.name === 'Parent');
      const grandparent = data.parents.find(p => p.artifact.name === 'Grandparent');
      const greatgrandparent = data.parents.find(p => p.artifact.name === 'GreatGrandparent');
      
      expect(parent).toBeDefined();
      expect(grandparent).toBeDefined();
      expect(greatgrandparent).toBeDefined();
      
      // Check parentId for tree building
      // Parent's parentId should be null (first level from query artifact)
      expect(parent!.parentId).toBeNull();
      // Grandparent's parentId should point to Parent artifact
      expect(grandparent!.parentId).toBe(parentId);
      // GreatGrandparent's parentId should point to Grandparent artifact
      expect(greatgrandparent!.parentId).toBe(grandparentId);
    });

    it('should recursively fetch multi-generation children with parentId for tree building', async () => {
      // Create a 4-level lineage: parent -> child -> grandchild -> greatgrandchild
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const childId = await createTestArtifact(testUserId, 'Child');
      const grandchildId = await createTestArtifact(testUserId, 'Grandchild');
      const greatgrandchildId = await createTestArtifact(testUserId, 'GreatGrandchild');
      
      await createLineage(childId, parentId, 'FORKED_FROM');
      await createLineage(grandchildId, childId, 'FORKED_FROM');
      await createLineage(greatgrandchildId, grandchildId, 'FORKED_FROM');

      // Query from parent - should get all 3 descendants
      const request = new Request(`http://localhost/api/artifacts/${parentId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should have 3 children (child, grandchild, greatgrandchild)
      expect(data.children).toHaveLength(3);
      
      // Find each level
      const child = data.children.find(c => c.artifact.name === 'Child');
      const grandchild = data.children.find(c => c.artifact.name === 'Grandchild');
      const greatgrandchild = data.children.find(c => c.artifact.name === 'GreatGrandchild');
      
      expect(child).toBeDefined();
      expect(grandchild).toBeDefined();
      expect(greatgrandchild).toBeDefined();
      
      // Check parentId for tree building (in children context, parentId means "derived from")
      expect(child!.parentId).toBeNull();
      expect(grandchild!.parentId).toBe(childId);
      expect(greatgrandchild!.parentId).toBe(grandchildId);
    });

    it('should limit parent depth with parentDepth parameter', async () => {
      // Create 3-level lineage
      const greatgrandparentId = await createTestArtifact(testUserId, 'GreatGrandparent');
      const grandparentId = await createTestArtifact(testUserId, 'Grandparent');
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const childId = await createTestArtifact(testUserId, 'Child');
      
      await createLineage(grandparentId, greatgrandparentId, 'DEPENDS_ON');
      await createLineage(parentId, grandparentId, 'DEPENDS_ON');
      await createLineage(childId, parentId, 'DEPENDS_ON');

      // Query with parentDepth=2 - should only get parent and grandparent
      const request = new Request(`http://localhost/api/artifacts/${childId}/lineage?parentDepth=2`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should only have 2 parents
      expect(data.parents).toHaveLength(2);
      
      const names = data.parents.map(p => p.artifact.name);
      expect(names).toContain('Parent');
      expect(names).toContain('Grandparent');
      expect(names).not.toContain('GreatGrandparent');
    });

    it('should limit child depth with childDepth parameter', async () => {
      // Create 3-level descendant lineage
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const childId = await createTestArtifact(testUserId, 'Child');
      const grandchildId = await createTestArtifact(testUserId, 'Grandchild');
      const greatgrandchildId = await createTestArtifact(testUserId, 'GreatGrandchild');
      
      await createLineage(childId, parentId, 'FORKED_FROM');
      await createLineage(grandchildId, childId, 'FORKED_FROM');
      await createLineage(greatgrandchildId, grandchildId, 'FORKED_FROM');

      // Query with childDepth=1 - should only get direct child
      const request = new Request(`http://localhost/api/artifacts/${parentId}/lineage?childDepth=1`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should only have 1 child
      expect(data.children).toHaveLength(1);
      expect(data.children[0].artifact.name).toBe('Child');
    });

    it('should support both parentDepth and childDepth together', async () => {
      // Create lineage with middle artifact having both ancestors and descendants
      const grandparentId = await createTestArtifact(testUserId, 'Grandparent');
      const parentId = await createTestArtifact(testUserId, 'Parent');
      const middleId = await createTestArtifact(testUserId, 'Middle');
      const childId = await createTestArtifact(testUserId, 'Child');
      const grandchildId = await createTestArtifact(testUserId, 'Grandchild');
      
      await createLineage(parentId, grandparentId, 'DEPENDS_ON');
      await createLineage(middleId, parentId, 'DEPENDS_ON');
      await createLineage(childId, middleId, 'FORKED_FROM');
      await createLineage(grandchildId, childId, 'FORKED_FROM');

      // Query from middle with parentDepth=1 and childDepth=1
      const request = new Request(`http://localhost/api/artifacts/${middleId}/lineage?parentDepth=1&childDepth=1`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should only have 1 parent (Parent, not Grandparent)
      expect(data.parents).toHaveLength(1);
      expect(data.parents[0].artifact.name).toBe('Parent');
      
      // Should only have 1 child (Child, not Grandchild)
      expect(data.children).toHaveLength(1);
      expect(data.children[0].artifact.name).toBe('Child');
    });

    it('should return 400 for invalid parentDepth parameter', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Test');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage?parentDepth=0`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid childDepth parameter', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Test');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage?childDepth=-1`);
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
    });

    it('should handle circular references gracefully', async () => {
      // Create a circular dependency: A -> B -> C -> A
      const artifactA = await createTestArtifact(testUserId, 'Artifact A');
      const artifactB = await createTestArtifact(testUserId, 'Artifact B');
      const artifactC = await createTestArtifact(testUserId, 'Artifact C');
      
      await createLineage(artifactB, artifactA, 'DEPENDS_ON');
      await createLineage(artifactC, artifactB, 'DEPENDS_ON');
      await createLineage(artifactA, artifactC, 'DEPENDS_ON'); // Creates cycle

      // Query should not infinite loop
      const request = new Request(`http://localhost/api/artifacts/${artifactA}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      
      // Should return parents without infinite loop
      expect(data.parents.length).toBeLessThanOrEqual(3);
    });

    it('should return 404 for non-existent artifact', async () => {
      const request = new Request('http://localhost/api/artifacts/non-existent-id/lineage');
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
    });

    it('should return 401 for unlisted artifact without auth', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Unlisted', 'UNLISTED');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return lineage for unlisted artifact with auth', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('unlistedlineage');
      
      const artifactId = await createTestArtifact(userId, 'Unlisted', 'UNLISTED');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should return 403 for private artifact with non-owner auth', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Private', 'PRIVATE');
      
      const { sessionCookie } = await registerUser('otherlineageuser');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return lineage for private artifact with owner auth', async () => {
      await db.delete(user);
      const { sessionCookie, userId } = await registerUser('privatelineage');
      
      const artifactId = await createTestArtifact(userId, 'Private', 'PRIVATE');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/lineage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
    });

    it('should include author info in lineage', async () => {
      const parentId = await createTestArtifact(testUserId, 'Parent With Author');
      const childId = await createTestArtifact(testUserId, 'Child');
      await createLineage(childId, parentId, 'DEPENDS_ON');

      const request = new Request(`http://localhost/api/artifacts/${childId}/lineage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<GetArtifactLineageResponse>();
      expect(data.parents[0].artifact.author).toBeDefined();
      expect(data.parents[0]!.artifact!.author!.username).toBe('lineageuser');
    });
  });

  describe('POST /api/artifacts', () => {
    let sessionCookie: string;

    beforeEach(async () => {
      const result = await registerUser('createartifactuser');
      sessionCookie = result.sessionCookie;
    });

    // 创建 VFS 类型的节点 FormData（多文件，使用 tar.gz 归档）
    async function createVfsFormData(
      metadata: Record<string, unknown>,
      files?: { name: string; content: string | Uint8Array; type?: string }[]
    ): Promise<FormData> {
      const formData = new FormData();
      // 如果未提供 artifactId，则自动生成一个
      const metadataWithId = {
        artifactId: crypto.randomUUID(),
        ...metadata,
      };
      formData.append('metadata', JSON.stringify(metadataWithId));

      const nodeId = crypto.randomUUID();
      const descriptor = {
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: files && files.length > 0 ? [{ 
          id: nodeId, 
          type: 'VFS', 
          name: 'files',
          content: { files: files.map(f => ({ path: f.name })) }
        }] : [],
        edges: [],
      };
      formData.append('descriptor', JSON.stringify(descriptor));

      if (files && files.length > 0) {
        // 创建 tar.gz 归档
        const tarGz = await createVfsTarGz(files.map(f => ({ 
          name: f.name, 
          content: f.content 
        })));
        const blob = new Blob([tarGz], { type: 'application/gzip' });
        formData.append(`vfs[${nodeId}]`, blob, 'archive.tar.gz');
      }

      return formData;
    }

    // 创建 PROMPT 类型的节点 FormData（单文件 node.json）
    function createPromptFormData(
      metadata: Record<string, unknown>,
      content?: string
    ): FormData {
      const formData = new FormData();
      // 如果未提供 artifactId，则自动生成一个
      const metadataWithId = {
        artifactId: crypto.randomUUID(),
        ...metadata,
      };
      formData.append('metadata', JSON.stringify(metadataWithId));

      const nodeId = crypto.randomUUID();
      const hasContent = content !== undefined;
      const descriptor = {
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: hasContent ? [{ 
          id: nodeId, 
          type: 'PROMPT', 
          name: 'prompt',
          content: { blocks: [] }
        }] : [],
        edges: [],
      };
      formData.append('descriptor', JSON.stringify(descriptor));

      if (hasContent) {
        const blob = new Blob([content], { type: 'application/json' });
        formData.append(`nodes[${nodeId}]`, blob, 'node.json');
      }

      return formData;
    }

    // 创建 GENERATED 类型的节点 FormData（单文件 node.json）
    function createGeneratedFormData(
      metadata: Record<string, unknown>,
      content?: string
    ): FormData {
      const formData = new FormData();
      // 如果未提供 artifactId，则自动生成一个
      const metadataWithId = {
        artifactId: crypto.randomUUID(),
        ...metadata,
      };
      formData.append('metadata', JSON.stringify(metadataWithId));

      const nodeId = crypto.randomUUID();
      const hasContent = content !== undefined;
      const descriptor = {
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: hasContent ? [{ 
          id: nodeId, 
          type: 'GENERATED', 
          name: 'output',
          content: { blocks: [], inputRef: { nodeId: crypto.randomUUID(), version: 'latest' } }
        }] : [],
        edges: [],
      };
      formData.append('descriptor', JSON.stringify(descriptor));

      if (hasContent) {
        const blob = new Blob([content], { type: 'application/json' });
        formData.append(`nodes[${nodeId}]`, blob, 'node.json');
      }

      return formData;
    }

    // 创建自定义 descriptor 的 FormData
    function createCustomFormData(
      metadata: Record<string, unknown>,
      descriptor: { version: number; nodes: { id: string; type?: string; name?: string; external?: boolean; content?: unknown }[]; edges: { source: string; target: string }[]; exportedAt?: string },
      nodeFiles?: Map<string, { name: string; content: string | Uint8Array; type?: string }[]>
    ): FormData {
      const formData = new FormData();
      // 如果未提供 artifactId，则自动生成一个
      const metadataWithId = {
        artifactId: crypto.randomUUID(),
        ...metadata,
      };
      formData.append('metadata', JSON.stringify(metadataWithId));
      formData.append('descriptor', JSON.stringify({
        ...descriptor,
        exportedAt: descriptor.exportedAt || new Date().toISOString(),
      }));

      if (nodeFiles) {
        for (const [nodeId, files] of nodeFiles) {
          for (const file of files) {
            const blob = new Blob([file.content], { type: file.type || 'text/plain' });
            formData.append(`nodes[${nodeId}]`, blob, file.name);
          }
        }
      }

      return formData;
    }

    it('should return 401 when not authenticated', async () => {
      const formData = await createVfsFormData({
        type: 'RECIPE',
        name: 'Test Recipe',
        slug: 'test-recipe',
        version: '1.0.0',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should create artifact successfully without files', async () => {
      const formData = await createVfsFormData({
        type: 'RECIPE',
        name: 'My Recipe',
        slug: 'my-recipe',
        version: '1.0.0',
        description: 'A test recipe',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.message).toBe('Artifact saved successfully');
      expect(data.artifact.name).toBe('My Recipe');
      expect(data.artifact.slug).toBe('my-recipe');
      expect(data.artifact.type).toBe('RECIPE');
      expect(data.artifact.description).toBe('A test recipe');
    });

    it('should create artifact with VFS files', async () => {
      const formData = await createVfsFormData(
        {
          type: 'PROMPT',
          name: 'Prompt Pack',
          slug: 'prompt-pack',
          version: '1.0.0',
        },
        [
          { name: 'prompt1.md', content: '# Prompt 1\nContent here' },
          { name: 'prompt2.md', content: '# Prompt 2\nMore content' },
        ]
      );

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.name).toBe('Prompt Pack');

      // Verify VFS archive is uploaded to R2
      const r2Bucket = getTestR2Bucket();
      
      // Get node info from database to construct R2 path
      const nodes = await db.select().from(artifactNodes).where(eq(artifactNodes.artifactId, data.artifact.id));
      expect(nodes.length).toBeGreaterThan(0);
      
      const node = nodes[0];
      const nodeVersions = await db.select().from(artifactNodeVersions).where(eq(artifactNodeVersions.nodeId, node.id));
      expect(nodeVersions.length).toBeGreaterThan(0);
      
      const versionHash = nodeVersions[0].commitHash;
      
      // VFS archives are stored as a single tar.gz file
      const archiveKey = `${data.artifact.id}/nodes/${node.id}/${versionHash}/files.tar.gz`;
      const archive = await r2Bucket.get(archiveKey);
      
      expect(archive).not.toBeNull();
      expect(archive!.httpMetadata?.contentType).toBe('application/gzip');
    });

    it('should create artifact with tags', async () => {
      // Create existing tag
      await db.insert(tags).values({
        name: 'existing-tag',
        slug: 'existing-tag',
        usageCount: 5,
      });

      const formData = await createVfsFormData({
        type: 'GAME',
        name: 'Tagged Game',
        slug: 'tagged-game',
        version: '1.0.0',
        tags: ['existing-tag', 'new-tag'],
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.tags).toHaveLength(2);
      
      const tagSlugs = data.artifact.tags!.map(t => t.slug);
      expect(tagSlugs).toContain('existing-tag');
      expect(tagSlugs).toContain('new-tag');

      // Verify tag usage count was incremented
      const [existingTag] = await db.select().from(tags).where(eq(tags.slug, 'existing-tag'));
      expect(existingTag.usageCount).toBe(6);
    });

    // 节点文件验证测试
    describe('Node file validation', () => {
      it('should create artifact with valid PROMPT node', async () => {
        const formData = createPromptFormData(
          { type: 'RECIPE', name: 'Prompt Test', slug: 'prompt-test', version: '1.0.0' },
          'This is my prompt content'
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('Prompt Test');
      });

      it('should create artifact with valid GENERATED node', async () => {
        const formData = createGeneratedFormData(
          { type: 'RECIPE', name: 'Generated Test', slug: 'generated-test', version: '1.0.0' },
          '# Generated Content\n\nThis is generated markdown.'
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('Generated Test');
      });

      it('should create artifact with valid VFS node with multiple files', async () => {
        const formData = await createVfsFormData(
          { type: 'ASSET_PACK', name: 'VFS Test', slug: 'vfs-test', version: '1.0.0' },
          [
            { name: 'file1.txt', content: 'content 1' },
            { name: 'file2.json', content: '{"key": "value"}' },
            { name: 'subfolder/file3.md', content: '# Title' },
          ]
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.name).toBe('VFS Test');
      });

      it('should return 400 when internal node missing type', async () => {
        const nodeId = crypto.randomUUID();
        const nodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles.set(nodeId, [{ name: 'node.json', content: 'test' }]);

        const formData = createCustomFormData(
          { type: 'RECIPE', name: 'Test', slug: 'test', version: '1.0.0' },
          { version: 1, nodes: [{ id: nodeId }], edges: [] }, // 没有 type
          nodeFiles
        );

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(400);
        const data = await response.json<ApiError>();
        expect(data.error).toContain('must have a type');
      });
    });

    it('should return 400 for missing required fields', async () => {
      const formData = await createVfsFormData({
        type: 'RECIPE',
        name: 'Incomplete',
        // Missing slug and version
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('required');
    });

    it('should return 400 for invalid type', async () => {
      const formData = await createVfsFormData({
        type: 'INVALID_TYPE',
        name: 'Invalid',
        slug: 'invalid',
        version: '1.0.0',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid type');
    });

    it('should return 400 for invalid slug format', async () => {
      const formData = await createVfsFormData({
        type: 'RECIPE',
        name: 'Bad Slug',
        slug: 'BAD SLUG WITH SPACES!',
        version: '1.0.0',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('slug');
    });

    it('should return 400 for invalid version format', async () => {
      const formData = await createVfsFormData({
        type: 'RECIPE',
        name: 'Bad Version',
        slug: 'bad-version',
        version: 'not-semver',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('semver');
    });

    it('should return 400 for invalid JSON in metadata', async () => {
      const formData = new FormData();
      formData.append('metadata', 'not valid json {');

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(400);
      const data = await response.json<ApiError>();
      expect(data.error).toContain('Invalid JSON');
    });

    it('should return 409 for duplicate slug', async () => {
      // Create first artifact
      const formData1 = await createVfsFormData({
        type: 'RECIPE',
        name: 'First',
        slug: 'duplicate-slug',
        version: '1.0.0',
      });

      const request1 = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData1,
      });
      const response1 = await sendRequest(request1);
      expect(response1.status).toBe(200);

      // Try to create second artifact with same slug
      const formData2 = await createVfsFormData({
        type: 'GAME',
        name: 'Second',
        slug: 'duplicate-slug',
        version: '1.0.0',
      });

      const request2 = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData2,
      });
      const response2 = await sendRequest(request2);

      expect(response2.status).toBe(409);
      const data = await response2.json<ApiError>();
      expect(data.error).toContain('slug already exists');
    });

    it('should allow same slug for different users', async () => {
      // Create artifact with first user
      const formData1 = await createVfsFormData({
        type: 'RECIPE',
        name: 'User1 Recipe',
        slug: 'shared-slug',
        version: '1.0.0',
      });

      const request1 = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData1,
      });
      const response1 = await sendRequest(request1);
      expect(response1.status).toBe(200);

      // Create artifact with second user using same slug
      const { sessionCookie: sessionCookie2 } = await registerUser('createartifactuser2');
      const formData2 = await createVfsFormData({
        type: 'RECIPE',
        name: 'User2 Recipe',
        slug: 'shared-slug',
        version: '1.0.0',
      });

      const request2 = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie2 },
        body: formData2,
      });
      const response2 = await sendRequest(request2);

      expect(response2.status).toBe(200);
      const data = await response2.json<CreateArtifactResponse>();
      expect(data.artifact.slug).toBe('shared-slug');
    });

    it('should create artifact with all optional fields', async () => {
      const formData = await createVfsFormData({
        type: 'ASSET_PACK',
        name: 'Full Asset Pack',
        slug: 'full-asset-pack',
        version: '2.0.0-beta',
        description: 'A complete asset pack',
        visibility: 'PRIVATE',
        thumbnailUrl: 'https://example.com/thumb.png',
        license: 'MIT',
        repositoryUrl: 'https://github.com/example/repo',
        changelog: 'Initial release',
        isPrerelease: true,
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.type).toBe('ASSET_PACK');
      expect(data.artifact.name).toBe('Full Asset Pack');
      expect(data.artifact.description).toBe('A complete asset pack');
      expect(data.artifact.visibility).toBe('PRIVATE');
      expect(data.artifact.thumbnailUrl).toBe('https://example.com/thumb.png');
      expect(data.artifact.license).toBe('MIT');
    });

    it('should create version record correctly', async () => {
      const formData = await createVfsFormData({
        type: 'PROMPT',
        name: 'Versioned Prompt',
        slug: 'versioned-prompt',
        version: '1.2.3',
        changelog: 'Added new features',
        isPrerelease: false,
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify version record in database
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, data.artifact.id));
      expect(artifact.currentVersionId).not.toBeNull();

      const [version] = await db.select().from(artifactVersions).where(eq(artifactVersions.id, artifact.currentVersionId!));
      expect(version.version).toBe('1.2.3');
      expect(version.changelog).toBe('Added new features');
      expect(version.isPrerelease).toBe(false);
    });

    it('should create file records correctly', async () => {
      const formData = await createVfsFormData(
        {
          type: 'RECIPE',
          name: 'Recipe with Files',
          slug: 'recipe-with-files',
          version: '1.0.0',
        },
        [
          { name: 'recipe.json', content: '{"ingredients": []}', type: 'application/json' },
          { name: 'README.md', content: '# Recipe', type: 'text/markdown' },
        ]
      );

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify file records in database through node version content
      const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, data.artifact.id));
      
      // Get all nodes for this artifact
      const nodes = await db.select().from(artifactNodes).where(eq(artifactNodes.artifactId, artifact.id));
      expect(nodes.length).toBeGreaterThan(0);

      // Get all files from node version content field
      const allFiles: { path: string }[] = [];
      for (const node of nodes) {
        const nodeVersions = await db.select().from(artifactNodeVersions).where(eq(artifactNodeVersions.nodeId, node.id));
        for (const nv of nodeVersions) {
          if (nv.content) {
            const content = JSON.parse(nv.content);
            if (content.files && Array.isArray(content.files)) {
              allFiles.push(...content.files);
            }
          }
        }
      }

      expect(allFiles).toHaveLength(2);
      const filenames = allFiles.map(f => f.path);
      expect(filenames).toContain('recipe.json');
      expect(filenames).toContain('README.md');
    });

    it('should create stats record', async () => {
      const formData = await createVfsFormData({
        type: 'GAME',
        name: 'Stats Game',
        slug: 'stats-game',
        version: '1.0.0',
      });

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();

      // Verify stats record in database
      const [stats] = await db.select().from(artifactStats).where(eq(artifactStats.artifactId, data.artifact.id));
      expect(stats).toBeDefined();
      expect(stats.viewCount).toBe(0);
      expect(stats.starCount).toBe(0);
      expect(stats.forkCount).toBe(0);
      expect(stats.downloadCount).toBe(0);
    });

    it('should create artifact with homepage markdown', async () => {
      const formData = new FormData();
      formData.append('metadata', JSON.stringify({
        artifactId: crypto.randomUUID(),
        type: 'RECIPE',
        name: 'Recipe With Homepage',
        slug: 'recipe-with-homepage',
        version: '1.0.0',
      }));
      formData.append('descriptor', JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      }));
      
      // Add homepage markdown
      const markdownContent = '# Welcome\n\nThis is the **homepage** for this artifact.';
      const blob = new Blob([markdownContent], { type: 'text/markdown' });
      formData.append('homepage', blob, 'homepage.md');

      const request = new Request('http://localhost/api/artifacts', {
        method: 'POST',
        headers: { Cookie: sessionCookie },
        body: formData,
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json<CreateArtifactResponse>();
      expect(data.artifact.id).toBeDefined();

      // Verify homepage was stored in R2
      const r2 = getTestR2Bucket();
      const homepageKey = `artifacts/${data.artifact.id}/homepage.html`;
      const object = await r2.get(homepageKey);
      expect(object).not.toBeNull();
      
      const html = await object!.text();
      expect(html).toContain('<h1>Welcome</h1>');
      expect(html).toContain('<strong>homepage</strong>');
    });

    // 更新 Artifact 测试
    describe('Update artifact (with artifactId in metadata)', () => {
      it('should update artifact successfully when artifactId is provided', async () => {
        // 首先创建一个 artifact
        const createFormData = await createVfsFormData({
          type: 'RECIPE',
          name: 'Original Recipe',
          slug: 'original-recipe',
          version: '1.0.0',
          description: 'Original description',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 更新这个 artifact
        const updateFormData = await createVfsFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Recipe',
          slug: 'updated-recipe',
          version: '2.0.0',
          description: 'Updated description',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.message).toBe('Artifact saved successfully');
        expect(updateData.artifact.id).toBe(artifactId);
        expect(updateData.artifact.name).toBe('Updated Recipe');
        expect(updateData.artifact.slug).toBe('updated-recipe');
        expect(updateData.artifact.description).toBe('Updated description');
      });

      it('should preserve stats when updating artifact', async () => {
        // 首先创建一个 artifact
        const createFormData = await createVfsFormData({
          type: 'RECIPE',
          name: 'Recipe for Stats',
          slug: 'recipe-stats',
          version: '1.0.0',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 模拟一些 stats 更新
        await db.update(artifactStats)
          .set({ viewCount: 100, starCount: 50 })
          .where(eq(artifactStats.artifactId, artifactId));

        // 更新这个 artifact
        const updateFormData = await createVfsFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Recipe Stats',
          slug: 'updated-recipe-stats',
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.artifact.stats?.viewCount).toBe(100);
        expect(updateData.artifact.stats?.starCount).toBe(50);
      });

      it('should create new artifact when artifactId does not exist in database', async () => {
        const newId = crypto.randomUUID();
        const formData = await createVfsFormData({
          artifactId: newId,
          type: 'RECIPE',
          name: 'New Artifact',
          slug: 'new-artifact-with-id',
          version: '1.0.0',
        });

        const request = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: formData,
        });
        const response = await sendRequest(request);

        expect(response.status).toBe(200);
        const data = await response.json<CreateArtifactResponse>();
        expect(data.artifact.id).toBe(newId);
        expect(data.artifact.name).toBe('New Artifact');
      });

      it('should return 403 when trying to update artifact owned by another user', async () => {
        // 创建另一个用户的 artifact
        const { sessionCookie: otherUserSessionCookie } = await registerUser('otheruser');
        const createFormData = await createVfsFormData({
          type: 'RECIPE',
          name: 'Other User Recipe',
          slug: 'other-user-recipe',
          version: '1.0.0',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: otherUserSessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 尝试用当前用户更新
        const updateFormData = await createVfsFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Hijacked Recipe',
          slug: 'hijacked-recipe',
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(403);
        const updateData = await updateResponse.json<ApiError>();
        expect(updateData.error).toBe('You do not have permission to update this artifact');
      });

      it('should return 409 when updated slug conflicts with another artifact', async () => {
        // 创建第一个 artifact
        const createFormData1 = await createVfsFormData({
          type: 'RECIPE',
          name: 'First Recipe',
          slug: 'first-recipe',
          version: '1.0.0',
        });

        const createRequest1 = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData1,
        });
        await sendRequest(createRequest1);

        // 创建第二个 artifact
        const createFormData2 = await createVfsFormData({
          type: 'RECIPE',
          name: 'Second Recipe',
          slug: 'second-recipe',
          version: '1.0.0',
        });

        const createRequest2 = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData2,
        });
        const createResponse2 = await sendRequest(createRequest2);
        expect(createResponse2.status).toBe(200);
        const createData2 = await createResponse2.json<CreateArtifactResponse>();
        const artifactId2 = createData2.artifact.id;

        // 尝试将第二个 artifact 的 slug 更新为第一个的
        const updateFormData = await createVfsFormData({
          artifactId: artifactId2,
          type: 'RECIPE',
          name: 'Updated Recipe',
          slug: 'first-recipe', // 与第一个 artifact 冲突
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(409);
        const updateData = await updateResponse.json<ApiError>();
        expect(updateData.error).toBe('Artifact with this slug already exists');
      });

      it('should allow updating slug to the same value', async () => {
        // 创建一个 artifact
        const createFormData = await createVfsFormData({
          type: 'RECIPE',
          name: 'Same Slug Recipe',
          slug: 'same-slug',
          version: '1.0.0',
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 更新，保持相同的 slug
        const updateFormData = await createVfsFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Same Slug',
          slug: 'same-slug', // 相同的 slug
          version: '2.0.0',
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.artifact.name).toBe('Updated Same Slug');
        expect(updateData.artifact.slug).toBe('same-slug');
      });

      it('should update tags correctly', async () => {
        // 创建一些标签
        await db.insert(tags).values([
          { name: 'tag-a', slug: 'tag-a', usageCount: 10 },
          { name: 'tag-b', slug: 'tag-b', usageCount: 5 },
        ]);

        // 创建带标签的 artifact
        const createFormData = await createVfsFormData({
          type: 'RECIPE',
          name: 'Tagged Recipe',
          slug: 'tagged-recipe',
          version: '1.0.0',
          tags: ['tag-a'],
        });

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;
        expect(createData.artifact.tags).toHaveLength(1);

        // 检查 tag-a 的使用计数增加了
        const [tagA1] = await db.select().from(tags).where(eq(tags.slug, 'tag-a'));
        expect(tagA1.usageCount).toBe(11);

        // 更新，移除 tag-a，添加 tag-b
        const updateFormData = await createVfsFormData({
          artifactId,
          type: 'RECIPE',
          name: 'Updated Tagged Recipe',
          slug: 'updated-tagged-recipe',
          version: '2.0.0',
          tags: ['tag-b'],
        });

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);

        expect(updateResponse.status).toBe(200);
        const updateData = await updateResponse.json<CreateArtifactResponse>();
        expect(updateData.artifact.tags).toHaveLength(1);
        expect(updateData.artifact.tags![0].slug).toBe('tag-b');

        // 检查 tag-a 的使用计数减少了，tag-b 的增加了
        const [tagA2] = await db.select().from(tags).where(eq(tags.slug, 'tag-a'));
        const [tagB2] = await db.select().from(tags).where(eq(tags.slug, 'tag-b'));
        expect(tagA2.usageCount).toBe(10);
        expect(tagB2.usageCount).toBe(6);
      });

      it('should update nodes and files correctly', async () => {
        // 创建带节点的 artifact
        const nodeId1 = crypto.randomUUID();
        const nodeFiles1 = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles1.set(nodeId1, [{ name: 'node.json', content: 'original content' }]);

        const createFormData = createCustomFormData(
          { type: 'RECIPE', name: 'Node Recipe', slug: 'node-recipe', version: '1.0.0' },
          { version: 1, nodes: [{ id: nodeId1, type: 'PROMPT', name: 'original-node', content: { blocks: [] } }], edges: [] },
          nodeFiles1
        );

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 获取旧的节点
        const oldNodes = await db.select().from(artifactNodes).where(eq(artifactNodes.artifactId, artifactId));
        expect(oldNodes).toHaveLength(1);
        const oldNodeId = oldNodes[0].id;

        // 更新，用新节点替换
        const nodeId2 = crypto.randomUUID();
        const nodeFiles2 = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles2.set(nodeId2, [{ name: 'node.json', content: 'updated content' }]);

        const updateFormData = createCustomFormData(
          { artifactId, type: 'RECIPE', name: 'Updated Node Recipe', slug: 'updated-node-recipe', version: '2.0.0' },
          { version: 1, nodes: [{ id: nodeId2, type: 'PROMPT', name: 'new-node', content: { blocks: [] } }], edges: [] },
          nodeFiles2
        );

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);
        expect(updateResponse.status).toBe(200);

        // 检查旧节点被删除，新节点被创建
        const newNodes = await db.select().from(artifactNodes).where(eq(artifactNodes.artifactId, artifactId));
        expect(newNodes).toHaveLength(1);
        expect(newNodes[0].id).not.toBe(oldNodeId);
        expect(newNodes[0].name).toBe('new-node');
      });

      it('should allow reusing same node ID when updating artifact', async () => {
        // 创建带节点的 artifact
        const nodeId = crypto.randomUUID();
        const nodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles.set(nodeId, [{ name: 'node.json', content: 'original content' }]);

        const createFormData = createCustomFormData(
          { type: 'RECIPE', name: 'Reuse Node Recipe', slug: 'reuse-node-recipe', version: '1.0.0' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'my-node', content: { blocks: [] } }], edges: [] },
          nodeFiles
        );

        const createRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData,
        });
        const createResponse = await sendRequest(createRequest);
        expect(createResponse.status).toBe(200);
        const createData = await createResponse.json<CreateArtifactResponse>();
        const artifactId = createData.artifact.id;

        // 更新，复用相同的 node ID
        const updatedNodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        updatedNodeFiles.set(nodeId, [{ name: 'node.json', content: 'updated content' }]);

        const updateFormData = createCustomFormData(
          { artifactId, type: 'RECIPE', name: 'Updated Reuse Recipe', slug: 'reuse-node-recipe', version: '2.0.0' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'my-node-updated', content: { blocks: [] } }], edges: [] },
          updatedNodeFiles
        );

        const updateRequest = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: updateFormData,
        });
        const updateResponse = await sendRequest(updateRequest);
        expect(updateResponse.status).toBe(200);

        // 检查节点被更新（相同 ID，新内容）
        const nodes = await db.select().from(artifactNodes).where(eq(artifactNodes.artifactId, artifactId));
        expect(nodes).toHaveLength(1);
        expect(nodes[0].id).toBe(nodeId);
        expect(nodes[0].name).toBe('my-node-updated');
      });

      it('should return 409 when using node ID that belongs to another artifact', async () => {
        // 创建第一个 artifact，带有节点
        const nodeId = crypto.randomUUID();
        const nodeFiles = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles.set(nodeId, [{ name: 'node.json', content: 'content' }]);

        const createFormData1 = createCustomFormData(
          { type: 'RECIPE', name: 'First Artifact', slug: 'first-artifact', version: '1.0.0' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'shared-node', content: { blocks: [] } }], edges: [] },
          nodeFiles
        );

        const createRequest1 = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData1,
        });
        const createResponse1 = await sendRequest(createRequest1);
        expect(createResponse1.status).toBe(200);

        // 尝试创建第二个 artifact，使用相同的 node ID（应该失败）
        const nodeFiles2 = new Map<string, { name: string; content: string; type?: string }[]>();
        nodeFiles2.set(nodeId, [{ name: 'node.json', content: 'different content' }]);

        const createFormData2 = createCustomFormData(
          { type: 'RECIPE', name: 'Second Artifact', slug: 'second-artifact', version: '1.0.0' },
          { version: 1, nodes: [{ id: nodeId, type: 'PROMPT', name: 'stolen-node', content: { blocks: [] } }], edges: [] },
          nodeFiles2
        );

        const createRequest2 = new Request('http://localhost/api/artifacts', {
          method: 'POST',
          headers: { Cookie: sessionCookie },
          body: createFormData2,
        });
        const createResponse2 = await sendRequest(createRequest2);
        expect(createResponse2.status).toBe(409);
        const errorData = await createResponse2.json<ApiError>();
        expect(errorData.error).toContain('Node IDs already exist in other artifacts');
      });
    });
  });

  describe('GET /api/artifacts/:artifactId/homepage', () => {
    let testUserId: string;

    async function createTestArtifact(
      authorId: string,
      name: string,
      visibility: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' = 'PUBLIC'
    ): Promise<string> {
      const [artifact] = await db.insert(artifacts).values({
        authorId,
        type: 'RECIPE',
        name,
        slug: name.toLowerCase().replace(/\s+/g, '-'),
        visibility,
      }).returning();
      return artifact.id;
    }

    async function storeHomepage(artifactId: string, html: string): Promise<void> {
      const r2 = getTestR2Bucket();
      const key = `artifacts/${artifactId}/homepage.html`;
      await r2.put(key, html, {
        httpMetadata: {
          contentType: 'text/html; charset=utf-8',
        },
      });
    }

    beforeEach(async () => {
      testUserId = await createTestUser(db, 'homepageuser');
    });

    it('should return homepage HTML for public artifact', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Public Artifact');
      await storeHomepage(artifactId, '<h1>Hello World</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      const html = await response.text();
      expect(html).toBe('<h1>Hello World</h1>');
    });

    it('should return 404 for non-existent artifact', async () => {
      const fakeId = '00000000-0000-0000-0000-000000000000';
      const request = new Request(`http://localhost/api/artifacts/${fakeId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Artifact not found');
    });

    it('should return 404 when homepage not created', async () => {
      const artifactId = await createTestArtifact(testUserId, 'No Homepage');
      
      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json<ApiError>();
      expect(data.error).toBe('Artifact homepage not found');
    });

    it('should return 401 for unlisted artifact without auth', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Unlisted Artifact', 'UNLISTED');
      await storeHomepage(artifactId, '<h1>Secret</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return homepage for unlisted artifact with auth', async () => {
      const { sessionCookie } = await registerUser('autheduser');
      const artifactId = await createTestArtifact(testUserId, 'Unlisted Artifact', 'UNLISTED');
      await storeHomepage(artifactId, '<h1>Unlisted Content</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toBe('<h1>Unlisted Content</h1>');
    });

    it('should return 401 for private artifact without auth', async () => {
      const artifactId = await createTestArtifact(testUserId, 'Private Artifact', 'PRIVATE');
      await storeHomepage(artifactId, '<h1>Private</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`);
      const response = await sendRequest(request);

      expect(response.status).toBe(401);
    });

    it('should return 403 for private artifact from different user', async () => {
      const { sessionCookie } = await registerUser('differentuser');
      const artifactId = await createTestArtifact(testUserId, 'Private Artifact', 'PRIVATE');
      await storeHomepage(artifactId, '<h1>Private</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(403);
    });

    it('should return homepage for private artifact owned by user', async () => {
      // Register user and get their ID
      const { sessionCookie, userId: ownerId } = await registerUser('owneruser');
      
      const artifactId = await createTestArtifact(ownerId, 'My Private Artifact', 'PRIVATE');
      await storeHomepage(artifactId, '<h1>My Private Content</h1>');

      const request = new Request(`http://localhost/api/artifacts/${artifactId}/homepage`, {
        headers: { Cookie: sessionCookie },
      });
      const response = await sendRequest(request);

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toBe('<h1>My Private Content</h1>');
    });
  });
});
